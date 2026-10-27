"""Triagem de notícia: o único lugar onde um modelo toca a recomendação.

A [spec 003](../../../specs/003-recomendacao/spec.md) decidiu que seleção, nota,
peso e cota são cálculo, sempre. A revisão de 27/10/2026 abriu **uma** porta: o
modelo pode **tirar** um ativo da seleção por notícia grave, com o motivo
gravado. Não pode pôr ativo nenhum, nem mexer em nota, peso ou cota.

O motivo de a porta existir: o filtro quantitativo é cego para fraude contábil,
recuperação judicial, intervenção de regulador, saída de bolsa e catástrofe
operacional. Esses eventos aparecem em texto antes de aparecerem em preço ou
volatilidade — e quando aparecem no número, já custaram.

O motivo de a porta ser estreita: este é o quarto caminho pago do produto, e o
primeiro fora de briefing, análise de ativo e `/pergunta`. `consultar_modelo` é
a única função que gasta crédito aqui, e é ela que está minada na fixture
`ambiente` de `tests/test_server.py`.
"""

from __future__ import annotations

import hashlib
import json
import logging
from dataclasses import dataclass, field
from typing import Any

from investai.analysis.screener import Candidate
from investai.config import (
    LLM_EFFORT,
    LLM_MAX_TOKENS,
    LLM_MODEL,
    LLM_TIMEOUT,
    NEWS_DAYS,
    anthropic_key,
)
from investai.data.news_fetcher import fetch_financial_news
from investai.utils.cache import cache

logger = logging.getLogger(__name__)

#: Os únicos motivos que derrubam um ativo. A lista é **código, não prompt**:
#: um veto com critério fora daqui é descartado por mais convincente que a
#: justificativa pareça. Queda de lucro, downgrade de analista, preço caindo e
#: "clima ruim para o setor" não estão aqui de propósito — isso é número, e o
#: filtro quantitativo já os vê melhor que qualquer manchete.
CRITERIOS: dict[str, str] = {
    "fraude": "fraude ou erro contábil",
    "recuperacao_judicial": "pedido de recuperação judicial ou falência",
    "intervencao_regulatoria": "intervenção de órgão regulador",
    "saida_de_bolsa": "saída de bolsa ou fechamento de capital",
    "catastrofe_operacional": "evento operacional catastrófico",
}

SYSTEM_PROMPT = """Você faz a triagem de risco grave de ativos da B3 a partir de notícias recentes.

Sua única saída possível é uma lista de VETOS. Você não escolhe ativo, não dá nota e não
sugere peso: isso é feito por cálculo, antes de você.

Vete um ativo SOMENTE quando a notícia indicar, de forma inequívoca, um destes eventos:
- fraude: fraude ou erro contábil na empresa
- recuperacao_judicial: pedido de recuperação judicial ou falência
- intervencao_regulatoria: intervenção de órgão regulador na empresa
- saida_de_bolsa: saída de bolsa ou fechamento de capital
- catastrofe_operacional: evento operacional catastrófico (desastre, paralisação grave)

NÃO vete por: queda de lucro ou receita, resultado abaixo do esperado, downgrade de
analista, preço em queda, "momento ruim do setor", disputa comercial comum, multa de
rotina, troca de executivo, ou qualquer leitura de tendência. Tudo isso é número, e o
número já foi avaliado.

O ônus é do veto, não do ativo: na dúvida, NÃO vete. Uma lista vazia é a resposta
correta e esperada na maioria das vezes.

Para cada veto, cite a frase da notícia que o justifica — copiada, não parafraseada — e
a fonte dela. Nunca vete um ticker que não esteja na lista recebida.
"""

RESPONSE_SCHEMA: dict[str, Any] = {
    "type": "object",
    "additionalProperties": False,
    "required": ["vetos"],
    "properties": {
        "vetos": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": ["ticker", "criterio", "frase", "fonte"],
                "properties": {
                    "ticker": {"type": "string"},
                    "criterio": {"type": "string", "enum": sorted(CRITERIOS)},
                    "frase": {"type": "string", "description": "A frase da notícia, copiada"},
                    "fonte": {"type": "string"},
                    "url": {"type": "string"},
                },
            },
        },
    },
}


@dataclass(frozen=True)
class Veto:
    """Um ativo derrubado por notícia, com tudo que explica a decisão.

    A spec aceita que a seleção deixe de ser **reproduzível** — a notícia de
    amanhã é outra — em troca de a decisão continuar **explicável**. É este
    registro que paga essa troca: dá para ler, meses depois, por que um ativo
    ficou fora naquele dia.
    """

    ticker: str
    criterio: str
    frase: str
    fonte: str = ""
    url: str = ""
    data: str = ""

    @property
    def motivo(self) -> str:
        return CRITERIOS.get(self.criterio, self.criterio)

    def to_dict(self) -> dict[str, str]:
        return {
            "ticker": self.ticker, "criterio": self.criterio, "motivo": self.motivo,
            "frase": self.frase, "fonte": self.fonte, "url": self.url, "data": self.data,
        }


@dataclass
class Triagem:
    """Resultado da triagem. `ok=False` significa *sem triagem*, não *sem veto*."""

    vetos: dict[str, Veto] = field(default_factory=dict)
    ok: bool = False
    motivo: str = ""


def _chave(ticker: str, artigos: list[dict[str, str]]) -> str:
    """Chave de cache por ativo **e por janela de notícia**.

    O hash é das manchetes: notícia nova muda a chave e paga de novo; reabrir a
    tela com a mesma notícia não paga nada.
    """
    bruto = "|".join(sorted(a.get("title", "") for a in artigos))
    digest = hashlib.sha256(bruto.encode("utf-8")).hexdigest()[:16]
    return f"triagem:{ticker}:{digest}"


def consultar_modelo(manchetes: dict[str, list[dict[str, str]]]) -> list[dict[str, Any]]:
    """A chamada paga. **Única** função deste módulo que gasta crédito.

    É esta que está na mina de `pytest.fail` da fixture `ambiente`: nenhum teste
    deve chegar aqui, e nenhum caminho novo deve escapar sem ser notado.
    """
    linhas: list[str] = []
    for ticker, artigos in manchetes.items():
        linhas.append(f"\n## {ticker}")
        for artigo in artigos:
            fonte = artigo.get("source") or "fonte não identificada"
            publicado = artigo.get("published") or ""
            linhas.append(f"- [{fonte} {publicado}] {artigo.get('title', '')}")
            descricao = (artigo.get("description") or "").strip()
            if descricao:
                linhas.append(f"  {descricao}")

    import anthropic

    client = anthropic.Anthropic(api_key=anthropic_key(), timeout=LLM_TIMEOUT, max_retries=2)
    with client.messages.stream(
        model=LLM_MODEL,
        max_tokens=LLM_MAX_TOKENS,
        system=SYSTEM_PROMPT,
        thinking={"type": "adaptive"},
        output_config={
            "effort": LLM_EFFORT,
            "format": {"type": "json_schema", "schema": RESPONSE_SCHEMA},
        },
        messages=[{"role": "user", "content":
                   "Faça a triagem destes ativos. Tickers permitidos: "
                   + ", ".join(manchetes)
                   + "\n" + "\n".join(linhas)}],
    ) as stream:
        mensagem = stream.get_final_message()

    texto = "".join(b.text for b in mensagem.content if b.type == "text").strip()
    payload = json.loads(texto)
    vetos = payload.get("vetos")
    return vetos if isinstance(vetos, list) else []


def _validar(bruto: dict[str, Any], permitidos: dict[str, str]) -> Veto | None:
    """Converte a resposta do modelo em `Veto`, ou descarta.

    Três recusas, todas em código: ticker fora da lista recebida, critério fora
    de `CRITERIOS`, e veto sem a frase que o justifica. Um veto sem frase não é
    explicável, e a spec exige que ele seja.
    """
    ticker = str(bruto.get("ticker", "")).strip().upper()
    if ticker not in permitidos:
        logger.warning("Triagem vetou ticker fora dos candidatos: %s", ticker or "(vazio)")
        return None
    criterio = str(bruto.get("criterio", "")).strip()
    if criterio not in CRITERIOS:
        logger.warning("Triagem usou critério não previsto em %s: %s", ticker, criterio)
        return None
    frase = str(bruto.get("frase", "")).strip()
    if not frase:
        logger.warning("Triagem vetou %s sem citar a notícia; descartado", ticker)
        return None
    return Veto(
        ticker=permitidos[ticker], criterio=criterio, frase=frase,
        fonte=str(bruto.get("fonte", "")).strip(),
        url=str(bruto.get("url", "")).strip(),
        data=str(bruto.get("data", "")).strip(),
    )


def triar(candidatos: list[Candidate], *, dias: int = NEWS_DAYS,
          usar_cache: bool = True) -> Triagem:
    """Veta ativos aprovados por notícia grave. Nunca levanta exceção.

    Roda sobre os **aprovados** (~10 a 15 ativos), nunca sobre o universo: a
    triagem é a última peneira, não a primeira.
    """
    if not candidatos:
        return Triagem(ok=False, motivo="nenhum candidato aprovado para triar")
    if not anthropic_key():
        return Triagem(ok=False, motivo="sem chave da Anthropic configurada")

    # O ticker do catálogo tem sufixo `.SA`; o modelo responde do jeito que leu.
    # Este mapa traduz de volta, e é ele que define a lista permitida.
    permitidos = {c.asset.ticker.upper(): c.asset.ticker for c in candidatos}
    permitidos.update({
        c.asset.ticker.upper().removesuffix(".SA"): c.asset.ticker for c in candidatos
    })

    try:
        noticias = fetch_financial_news([c.asset.ticker for c in candidatos], days=dias)
    except Exception as exc:  # noqa: BLE001 — fronteira: sem notícia, sem triagem
        logger.warning("Triagem sem notícia (%s)", exc)
        return Triagem(ok=False, motivo=f"notícias indisponíveis ({exc})")

    vetos: dict[str, Veto] = {}
    a_consultar: dict[str, list[dict[str, str]]] = {}
    for candidato in candidatos:
        ticker = candidato.asset.ticker
        artigos = noticias.get(ticker) or noticias.get(ticker.upper()) or []
        if not artigos:
            continue  # sem matéria-prima: não há o que triar, e não se paga por isso
        if usar_cache:
            guardado = cache.get(_chave(ticker, artigos))
            if isinstance(guardado, dict):
                if guardado.get("criterio"):
                    vetos[ticker] = Veto(
                        ticker=ticker, criterio=str(guardado["criterio"]),
                        frase=str(guardado.get("frase", "")),
                        fonte=str(guardado.get("fonte", "")),
                        url=str(guardado.get("url", "")),
                        data=str(guardado.get("data", "")),
                    )
                continue
        a_consultar[ticker] = artigos

    if not a_consultar:
        if vetos or any(noticias.get(c.asset.ticker) for c in candidatos):
            # Tudo veio do cache: a triagem valeu, e não custou nada.
            return Triagem(vetos=vetos, ok=True, motivo="triagem servida do cache")
        return Triagem(ok=False, motivo="nenhuma notícia encontrada na janela")

    try:
        resposta = consultar_modelo(a_consultar)
    except Exception as exc:  # noqa: BLE001 — fronteira: a carteira sai sem veto
        logger.warning("Triagem de notícia indisponível (%s)", exc)
        return Triagem(vetos=vetos, ok=False, motivo=f"triagem indisponível ({exc})")

    novos: dict[str, Veto] = {}
    for bruto in resposta:
        if not isinstance(bruto, dict):
            continue
        veto = _validar(bruto, permitidos)
        if veto is not None and veto.ticker in a_consultar:
            novos[veto.ticker] = veto

    # Grava no cache também o "nenhum veto": é a resposta mais comum, e é a que
    # mais vale não pagar de novo.
    if usar_cache:
        for ticker, artigos in a_consultar.items():
            veto = novos.get(ticker)
            cache.set(_chave(ticker, artigos), veto.to_dict() if veto else {"criterio": ""})

    vetos.update(novos)
    return Triagem(vetos=vetos, ok=True, motivo="")
