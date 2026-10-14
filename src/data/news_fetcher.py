"""Notícias financeiras por ativo.

Duas fontes, escolhidas por `INVESTAI_NEWS_PROVIDER`:

**Google Notícias (RSS, padrão, sem chave)** — a busca é feita pelo *ticker*
(`VALE3 when:7d`), que é inambíguo: a imprensa financeira brasileira sempre
escreve o código do papel. Resultado medido em 12/10/2026: 62 itens para VALE3,
todos de veículos financeiros (Valor, Seu Dinheiro, InfoMoney, Estadão).

**Currents API (fallback, exige chave)** — casa palavra solta e, em português,
devolve muito ruído: buscar "Vale" trouxe futebol, gastronomia e política, e
buscas de duas palavras ("Vale mineração") devolvem zero. Por isso os resultados
dela passam por um filtro de relevância antes de chegar ao LLM.

Degradação graciosa é requisito: se tudo falhar, devolve `{}` e o briefing sai
apenas com os dados quantitativos.
"""

from __future__ import annotations

import logging
import re
import unicodedata
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from typing import Any, Callable, Iterable

import requests

from src.config import (
    CURRENTS_ENDPOINT,
    GOOGLE_NEWS_ENDPOINT,
    HTTP_TIMEOUT,
    NEWS_DAYS,
    NEWS_MIN_INTERVAL,
    NEWS_PER_TICKER,
    NEWS_PROVIDER,
    currents_key,
)
from src.utils.cache import cache
from src.utils.resilience import PermanentError, Throttle, retry, safe

logger = logging.getLogger(__name__)

#: Contrato de um artigo entregue ao dashboard e ao prompt.
ARTICLE_FIELDS = ("title", "description", "url", "published", "source")

#: Ticker da B3 → nome da empresa. Usado pela Currents (que busca por palavra)
#: e para dar contexto ao LLM; o Google busca pelo próprio ticker.
COMPANY_NAMES: dict[str, str] = {
    "PETR3": "Petrobras", "PETR4": "Petrobras",
    "VALE3": "Vale", "ITUB3": "Itaú Unibanco", "ITUB4": "Itaú Unibanco",
    "BBAS3": "Banco do Brasil", "BBDC3": "Bradesco", "BBDC4": "Bradesco",
    "ABEV3": "Ambev", "WEGE3": "WEG", "B3SA3": "B3 bolsa",
    "MGLU3": "Magazine Luiza", "RENT3": "Localiza", "SUZB3": "Suzano",
    "PRIO3": "PRIO petróleo", "RADL3": "Raia Drogasil", "EQTL3": "Equatorial Energia",
    "ELET3": "Eletrobras", "ELET6": "Eletrobras", "GGBR4": "Gerdau",
    "CSNA3": "CSN Siderúrgica", "LREN3": "Lojas Renner", "VIVT3": "Vivo Telefônica",
    "JBSS3": "JBS", "EMBR3": "Embraer", "CSAN3": "Cosan", "KLBN11": "Klabin",
    "SBSP3": "Sabesp", "BPAC11": "BTG Pactual", "HAPV3": "Hapvida",
    "RDOR3": "Rede D'Or", "TOTS3": "Totvs", "CPLE6": "Copel", "TAEE11": "Taesa",
}

#: Termos que indicam contexto financeiro/corporativo. Separam uma notícia sobre
#: a empresa de outra que só usa a mesma palavra ("vale a pena", "Itaú da favela").
FINANCE_CONTEXT_TERMS = frozenset({
    "acao", "acoes", "acionista", "acionistas", "adr", "adrs", "analista", "analistas",
    "aquisicao", "balanco", "banco", "barril", "bolsa", "b3", "bilhao", "bilhoes",
    "combustivel", "combustiveis", "companhia", "conselho", "conselheiro",
    "cvm", "diesel", "dividendo", "dividendos", "ebitda", "empresa", "exportacao",
    "faturamento", "fusao", "gasolina", "guidance", "investidor", "investidores",
    "ibovespa", "juros", "lucro", "mercado", "mineracao", "mineradora", "minerio",
    "oferta", "papel", "papeis", "petroleo", "prejuizo", "producao", "receita",
    "refinaria", "resultado", "resultados", "siderurgica", "trimestre", "valor de mercado",
    # Termos regulatórios e operacionais do setor: é por aqui que chega boa parte
    # do fato relevante ("Vale fecha acordo com MPF", "leilão da ANP").
    "acordo", "anm", "anp", "barragem", "contrato", "estatal", "leilao", "mina",
    "minas", "mpf", "multa", "participacao", "privatizacao",
})

#: Pontuação mínima para um artigo da Currents entrar no contexto do LLM.
MIN_RELEVANCE_SCORE = 2

#: Páginas "perenes" de cotação que o Google indexa como notícia — não são fato novo.
JUNK_TITLE_PATTERNS = (
    re.compile(r"cotacao.*(hoje|tempo real)"),
    re.compile(r"precos?,? graficos?"),
    re.compile(r"preco-alvo e projecoes"),
    re.compile(r"^(acoes|cotacao|grafico)\b"),
)

#: A Currents recusa (HTTP 400, "Max range is 7 days") janelas que alcancem 7
#: dias exatos, e também `start_date` sem hora — verificado em 12/10/2026.
CURRENTS_MAX_DAYS = 7
CURRENTS_WINDOW_MARGIN = timedelta(hours=1)

_throttle = Throttle(NEWS_MIN_INTERVAL)
_SESSION_HEADERS = {"User-Agent": "InvestAI/1.0 (briefing semanal de carteira)"}


# --- Utilidades de texto ----------------------------------------------------
def _normalize(text: str) -> str:
    """Minúsculas sem acento, para comparar "Itaú" com "itau"."""
    decomposed = unicodedata.normalize("NFKD", text or "")
    return "".join(c for c in decomposed if not unicodedata.combining(c)).lower()


def _mentions(text: str, term: str) -> bool:
    """Casa o termo como palavra inteira (evita "vale" dentro de "valeu")."""
    pattern = r"\b" + r"\s+".join(re.escape(part) for part in _normalize(term).split()) + r"\b"
    return re.search(pattern, _normalize(text)) is not None


def company_name(ticker: str) -> str:
    """Nome da empresa quando conhecido; senão, o código sem o sufixo `.SA`."""
    base = ticker.upper().removesuffix(".SA")
    return COMPANY_NAMES.get(base, base)


def search_terms(ticker: str) -> str:
    """Termo de busca por palavra (usado pela Currents)."""
    return company_name(ticker)


def _is_junk(title: str) -> bool:
    normalized = _normalize(title)
    if len(normalized) < 25:  # "Vale (VALE3)" — página de cotação, não notícia
        return True
    return any(pattern.search(normalized) for pattern in JUNK_TITLE_PATTERNS)


def relevance_score(article: dict[str, Any], term: str) -> int:
    """Quão provável é que o artigo seja realmente sobre a empresa.

    O contexto financeiro é **obrigatório**, não um bônus: nomes como "Vale" e
    "Itaú" são palavras comuns em português, e citar a palavra no título não
    basta ("Vale dar uma chance ao bar das importadoras" cita, e não é sobre a
    mineradora). Pontuação: 3 = empresa no título, 2 = empresa na descrição,
    0 = descartar.
    """
    title = article.get("title") or ""
    description = article.get("description") or ""

    if _mentions(title, term):
        mention = 2
    elif _mentions(description, term):
        mention = 1
    else:
        return 0

    text = f"{title} {description}"
    if not any(_mentions(text, context) for context in FINANCE_CONTEXT_TERMS):
        return 0  # homônimo: cita a palavra, mas não fala de negócios

    return mention + 1


# --- Fonte 1: Google Notícias (RSS, sem chave) ------------------------------
def google_news_params(ticker: str, days: int) -> dict[str, str]:
    """Parâmetros da busca no RSS do Google Notícias.

    Busca pelo **ticker**, não pelo nome: "VALE3" é inambíguo, "Vale" não.
    """
    base = ticker.upper().removesuffix(".SA")
    if ticker.upper().endswith(".SA"):
        return {"q": f"{base} when:{days}d", "hl": "pt-BR", "gl": "BR", "ceid": "BR:pt-410"}
    return {"q": f"{base} stock when:{days}d", "hl": "en-US", "gl": "US", "ceid": "US:en"}


def _strip_source_suffix(title: str, source: str) -> str:
    """O Google anexa " - Veículo" ao título; o veículo já vem em campo próprio."""
    if source and title.endswith(f" - {source}"):
        return title[: -len(source) - 3].strip()
    return title


def _parse_pubdate(raw: str) -> str:
    """RFC-822 ("Wed, 07 Oct 2026 15:22:04 GMT") → ISO-8601."""
    if not raw:
        return ""
    try:
        return parsedate_to_datetime(raw).isoformat()
    except (TypeError, ValueError):
        return raw


def parse_google_rss(xml_text: str | bytes, limit: int) -> list[dict[str, str]]:
    """Converte o RSS do Google na nossa estrutura de artigo.

    O `description` do Google é só um link HTML, sem resumo — então fica vazio e
    o sinal é título + veículo + data.
    """
    try:
        root = ET.fromstring(xml_text)
    except ET.ParseError as exc:
        raise ValueError(f"RSS inválido: {exc}") from exc

    articles: list[dict[str, str]] = []
    seen: set[str] = set()

    for item in root.findall(".//item"):
        source_el = item.find("source")
        source = (source_el.text or "").strip() if source_el is not None else ""
        title = _strip_source_suffix((item.findtext("title") or "").strip(), source)

        key = _normalize(title)
        if not title or key in seen or _is_junk(title):
            continue
        seen.add(key)

        articles.append({
            "title": title,
            "description": "",  # o RSS do Google não traz resumo
            "url": (item.findtext("link") or "").strip(),
            "published": _parse_pubdate(item.findtext("pubDate") or ""),
            "source": source,
        })
        if len(articles) >= limit:
            break

    return articles


@retry(attempts=3)
def _request_google(params: dict[str, str]) -> bytes:
    _throttle.wait()
    response = requests.get(
        GOOGLE_NEWS_ENDPOINT, params=params, headers=_SESSION_HEADERS, timeout=HTTP_TIMEOUT
    )
    if response.status_code == 429:
        raise TimeoutError("Google Notícias: muitas requisições (HTTP 429)")
    if response.status_code >= 500:
        raise ConnectionError(f"Google Notícias indisponível (HTTP {response.status_code})")
    if response.status_code != 200:
        raise ValueError(f"Google Notícias respondeu HTTP {response.status_code}")
    return response.content


def fetch_google_news(ticker: str, days: int, limit: int) -> list[dict[str, str]]:
    return parse_google_rss(_request_google(google_news_params(ticker, days)), limit)


# --- Fonte 2: Currents API (fallback, exige chave) --------------------------
def start_date_for(days: int, now: datetime | None = None) -> str:
    """`start_date` aceito pela Currents para uma janela de `days` dias."""
    now = now or datetime.now(timezone.utc)
    window = timedelta(days=min(days, CURRENTS_MAX_DAYS)) - CURRENTS_WINDOW_MARGIN
    return (now - window).isoformat()


@retry(attempts=3)
def _request_currents(params: dict[str, Any]) -> dict:
    _throttle.wait()
    response = requests.get(CURRENTS_ENDPOINT, params=params, timeout=HTTP_TIMEOUT)

    # Erro de chave afeta todos os ativos → PermanentError (aborta a busca).
    if response.status_code in (401, 403):
        raise PermanentError(f"Currents API recusou a chave (HTTP {response.status_code})")
    if response.status_code == 429:
        raise TimeoutError("Currents API: rate limit (HTTP 429)")  # retryable
    if response.status_code >= 500:
        raise ConnectionError(f"Currents API indisponível (HTTP {response.status_code})")
    if response.status_code != 200:
        # Outro 4xx é problema da consulta deste ativo: não vale abortar os
        # demais nem re-tentar. `ValueError` não está em `retry_on`, então sobe
        # direto e o laço de busca segue para o próximo ticker.
        raise ValueError(
            f"Currents API respondeu HTTP {response.status_code}: {response.text[:200]}"
        )
    return response.json()


def parse_currents(payload: dict, limit: int, term: str = "",
                   min_score: int = MIN_RELEVANCE_SCORE) -> list[dict[str, str]]:
    """Normaliza, deduplica e ordena por relevância os artigos da Currents."""
    candidates: list[tuple[int, dict[str, str]]] = []
    seen: set[str] = set()

    for item in payload.get("news", []) or []:
        url = (item.get("url") or "").strip()
        title = (item.get("title") or "").strip()
        if not title or (url and url in seen):
            continue
        seen.add(url)

        description = (item.get("description") or "").strip()
        article = {
            "title": title,
            # Descrições longas inflam o contexto do LLM sem agregar.
            "description": description[:400],
            "url": url,
            "published": (item.get("published") or "").strip(),
            "source": (item.get("author") or "").strip(),
        }

        score = relevance_score(article, term) if term else min_score
        if score < min_score:
            logger.debug("Notícia descartada por irrelevância (%s): %s", term, title[:60])
            continue
        candidates.append((score, article))

    # Ordem estável: maior pontuação primeiro, preservando a ordem da API no empate.
    candidates.sort(key=lambda pair: pair[0], reverse=True)
    return [article for _score, article in candidates[:limit]]


def fetch_currents_news(ticker: str, days: int, limit: int) -> list[dict[str, str]]:
    api_key = currents_key()
    if not api_key:
        return []
    term = search_terms(ticker)
    payload = _request_currents({
        "keywords": term,
        "language": "pt" if ticker.upper().endswith(".SA") else "en",
        "start_date": start_date_for(days),
        "apiKey": api_key,
    })
    return parse_currents(payload, limit, term=term)


# --- Orquestração -----------------------------------------------------------
Provider = Callable[[str, int, int], list[dict[str, str]]]
PROVIDERS: dict[str, Provider] = {
    "google": fetch_google_news,
    "currents": fetch_currents_news,
}


def provider_chain(provider: str = NEWS_PROVIDER) -> list[str]:
    """Ordem das fontes a tentar. "auto" = Google e, se vier vazio, Currents."""
    if provider in PROVIDERS:
        return [provider]
    chain = ["google"]
    if currents_key():
        chain.append("currents")
    return chain


@safe(dict, message="Falha ao buscar notícias")
def fetch_financial_news(
    tickers: Iterable[str],
    days: int = NEWS_DAYS,
    limit_per_ticker: int = NEWS_PER_TICKER,
    use_cache: bool = True,
    provider: str = NEWS_PROVIDER,
) -> dict[str, list[dict[str, str]]]:
    """Notícias dos últimos `days` dias, agrupadas por ticker.

    Retorna `{ticker: [{title, description, url, published, source}]}` —
    agrupado por ativo porque tanto o dashboard quanto o prompt precisam dessa
    divisão (use `flatten_news` para a lista corrida). Qualquer falha devolve o
    que deu para coletar, sem levantar exceção.
    """
    tickers = [t for t in dict.fromkeys(str(t).upper() for t in tickers) if t]
    if not tickers:
        return {}

    chain = provider_chain(provider)
    news: dict[str, list[dict[str, str]]] = {}
    blocked: set[str] = set()  # fontes que falharam de forma definitiva

    for ticker in tickers:
        key = f"news:{'-'.join(chain)}:{ticker}:{days}"
        if use_cache:
            cached = cache.get(key)
            if isinstance(cached, list):
                news[ticker] = cached
                continue

        articles: list[dict[str, str]] = []
        for name in chain:
            if name in blocked:
                continue
            try:
                articles = PROVIDERS[name](ticker, days, limit_per_ticker)
            except PermanentError as exc:
                # Chave inválida afeta todos os tickers: para de tentar esta fonte.
                logger.error("%s — desabilitando a fonte '%s'", exc, name)
                blocked.add(name)
                continue
            except Exception as exc:  # noqa: BLE001
                logger.warning("Notícias de %s via '%s' indisponíveis: %s", ticker, name, exc)
                continue
            if articles:
                if name != chain[0]:
                    logger.info("Notícias de %s vieram da fonte de reserva '%s'", ticker, name)
                break

        news[ticker] = articles
        cache.set(key, articles)

    return news


def flatten_news(news: dict[str, list[dict[str, str]]]) -> list[dict[str, str]]:
    """Versão em lista corrida, com o ticker anexado a cada artigo."""
    return [
        {**article, "ticker": ticker}
        for ticker, articles in news.items()
        for article in articles
    ]


def probe(provider: str = NEWS_PROVIDER) -> bool:
    """Checagem de disponibilidade da fonte de notícias (status na sidebar)."""
    for name in provider_chain(provider):
        try:
            if name == "google":
                if parse_google_rss(_request_google(google_news_params("PETR4.SA", 7)), 1):
                    return True
            elif fetch_currents_news("PETR4.SA", NEWS_DAYS, 1):
                return True
        except Exception:  # noqa: BLE001
            continue
    return False
