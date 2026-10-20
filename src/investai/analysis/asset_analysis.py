"""Análise de um ativo pelo Claude — em **uma** chamada, sem ferramentas.

É aqui que a economia de custo acontece, e vale explicar por quê. O caminho
antigo mandava a pergunta para o agente, que carrega as definições das 8
ferramentas (~4 mil tokens) em cada requisição e faz de 2 a 4 idas à API: o
modelo pede a cotação, recebe, pede os indicadores, recebe, pede as notícias,
recebe, e só então escreve. Isso faz sentido quando não se sabe de que dado a
resposta vai precisar.

Para "analise a PETR4" nós sabemos exatamente: preço, variações, médias, RSI,
volatilidade, fundamentos e as notícias da semana. O Python busca tudo isso de
forma determinística — reusando `market_data`, `calculate_indicators` e
`news_fetcher` — e manda **uma** requisição com os dados já no prompt.

Resultado medido no plano: ~1,5 mil tokens de entrada em vez de ~5,5 mil,
nenhuma escrita de cache, nenhuma iteração. De ~US$ 0,03 para ~US$ 0,02, com
latência de uma chamada em vez de quatro.

O modelo aqui **interpreta**, não busca: todo número no prompt veio de API real
e já está calculado.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import datetime

from investai.analysis.quantitative import calculate_indicators
from investai.config import LLM_EFFORT, LLM_MODEL, LLM_TIMEOUT, anthropic_key
from investai.data import market_data, news_fetcher
from investai.utils.formatters import big_number, money, number, percent
from investai.utils.tickers import curto, normalizar

logger = logging.getLogger(__name__)

#: Resposta de WhatsApp: curta por natureza. Oito linhas de leitura, não um laudo.
MAX_TOKENS = 1200

#: Notícias no prompt. Cinco manchetes situam o movimento do preço; vinte só
#: gastam token e diluem o que importa.
MAX_NOTICIAS = 5

SYSTEM_PROMPT = """Você é o InvestAI, analista de investimentos do usuário, respondendo pelo WhatsApp.

Você recebe dados JÁ CALCULADOS de um ativo. Sua tarefa é interpretá-los, não buscar mais nada.

COMO RESPONDER
- Português do Brasil, direto. De 4 a 8 linhas, no formato de mensagem de celular.
- Use *negrito* do WhatsApp com moderação e listas com "-". Nunca tabela, "#" ou link em colchetes.
- Números em formato brasileiro (R$ 1.234,56 e 12,5%).

O QUE DIZER
- Abra com o preço e a leitura da tendência em uma linha.
- Dê de 2 a 4 observações, e CITE o número que embasa cada uma ("RSI em 74, acima de 70").
- Se as notícias explicam o movimento do preço, diga qual e como.
- Termine com o que observar daqui para frente — não com uma recomendação de compra ou venda.

RIGOR
- Use SOMENTE os dados fornecidos. Nunca invente preço, indicador, notícia ou fundamento.
- Dado marcado como N/D não existe: diga que não está disponível, não estime.
- Nunca prometa retorno nem garanta direção de preço. Você informa; a decisão é do usuário.
- Não é recomendação formal de investimento."""


@dataclass
class Analise:
    texto: str = ""
    erro: str = ""
    input_tokens: int = 0
    output_tokens: int = 0

    @property
    def ok(self) -> bool:
        return bool(self.texto) and not self.erro

    @property
    def custo_estimado(self) -> float:
        """Opus 5: US$ 5/M de entrada, US$ 25/M de saída. Sem cache nesta rota."""
        return self.input_tokens / 1e6 * 5 + self.output_tokens / 1e6 * 25


def montar_contexto(ticker: str) -> tuple[str, str]:
    """Busca tudo que a análise precisa e devolve `(contexto, erro)`.

    Determinístico e sem modelo. Indicador que não dá para calcular entra como
    N/D, nunca como número inventado — é a mesma regra do resto do sistema.
    """
    codigo = normalizar(ticker)
    if not codigo:
        return "", "Informe o código do ativo, por exemplo PETR4."

    precos = market_data.get_stock_data(codigo)
    if precos.empty:
        return "", (f"Não encontrei dados de {curto(codigo)}. Confira o código — papel "
                    "da B3 tem 4 letras e 1 ou 2 números (PETR4, KLBN11).")

    ind = calculate_indicators(precos)
    fund = market_data.get_fundamentals(codigo)
    nome = fund.get("name") or codigo

    linhas = [
        f"ATIVO: {codigo} ({nome})",
        f"Data de hoje: {datetime.now().strftime('%d/%m/%Y')}",
        "",
        "PREÇO E TENDÊNCIA",
        f"- Preço atual: {money(ind['price_current'])}",
        f"- Sinal de tendência: {ind['trend_signal']}",
        f"- Variação: 7d {percent(ind['price_change_7d'])} · "
        f"30d {percent(ind['price_change_30d'])} · "
        f"90d {percent(ind['price_change_90d'])} · "
        f"12m {percent(ind['price_change_1y'])}",
        "",
        "INDICADORES TÉCNICOS",
        f"- Médias móveis: MM20 {number(ind['ma_20'])} · MM50 {number(ind['ma_50'])} · "
        f"MM200 {number(ind['ma_200'])}",
        f"- RSI(14): {number(ind['rsi_14'], 1)} "
        "(acima de 70 = sobrecomprado; abaixo de 30 = sobrevendido)",
        f"- Volatilidade anualizada: {percent(ind['volatility_30d'], signed=False)}",
    ]

    if fund:
        disponiveis = [
            ("P/L", number(fund.get("pe_ratio"))),
            ("Dividend yield", percent(fund.get("dividend_yield"), signed=False)),
            ("Dívida/patrimônio", number(fund.get("debt_to_equity"), 0)),
            ("Valor de mercado", big_number(fund.get("market_cap"), "BRL")),
            ("Setor", fund.get("sector") or "N/D"),
        ]
        linhas += ["", "FUNDAMENTOS"]
        linhas += [f"- {rotulo}: {valor}" for rotulo, valor in disponiveis]

    artigos = (news_fetcher.fetch_financial_news([codigo]) or {}).get(codigo) or []
    if artigos:
        linhas += ["", f"NOTÍCIAS DOS ÚLTIMOS 7 DIAS ({len(artigos)} encontradas)"]
        for artigo in artigos[:MAX_NOTICIAS]:
            data = (artigo.get("published") or "")[:10]
            fonte = artigo.get("source") or ""
            linhas.append(f"- [{data}] {artigo['title']}" + (f" ({fonte})" if fonte else ""))
    else:
        linhas += ["", "NOTÍCIAS: nenhuma encontrada nos últimos 7 dias."]

    return "\n".join(linhas), ""


def analisar(ticker: str, model: str = LLM_MODEL) -> str:
    """Análise pronta para enviar no WhatsApp. Nunca levanta exceção."""
    resultado = gerar(ticker, model=model)
    if not resultado.ok:
        return resultado.erro or "Não consegui montar a análise agora."
    return resultado.texto


def gerar(ticker: str, model: str = LLM_MODEL) -> Analise:
    """Igual a `analisar()`, mas devolve o uso de tokens para registrar o gasto."""
    contexto, erro = montar_contexto(ticker)
    if erro:
        return Analise(erro=erro)

    if not anthropic_key():
        return Analise(erro="ANTHROPIC_API_KEY não configurada no servidor.")

    try:
        import anthropic
    except ImportError:
        return Analise(erro="Pacote `anthropic` não instalado.")

    client = anthropic.Anthropic(api_key=anthropic_key(), timeout=LLM_TIMEOUT, max_retries=2)
    try:
        mensagem = client.messages.create(
            model=model,
            max_tokens=MAX_TOKENS,
            system=SYSTEM_PROMPT,
            thinking={"type": "adaptive"},
            output_config={"effort": LLM_EFFORT},
            # Sem `tools`: é o que derruba ~4 mil tokens de entrada por chamada.
            messages=[{"role": "user", "content":
                       f"Analise este ativo para mim:\n\n{contexto}"}],
        )
    except anthropic.AuthenticationError:
        return Analise(erro="Chave da Anthropic inválida ou sem permissão.")
    except anthropic.RateLimitError:
        return Analise(erro="Limite de requisições da API atingido. "
                            "Tente de novo em alguns minutos.")
    except anthropic.APITimeoutError:
        return Analise(erro=f"A análise passou de {LLM_TIMEOUT:.0f}s e foi interrompida.")
    except anthropic.APIConnectionError:
        return Analise(erro="Não consegui falar com a API da Anthropic.")
    except anthropic.APIStatusError as exc:
        return Analise(erro=f"A API recusou a requisição (HTTP {exc.status_code}).")
    except Exception as exc:  # noqa: BLE001 — fronteira
        logger.exception("Falha inesperada na análise de %s", ticker)
        return Analise(erro=f"Falha inesperada: {exc.__class__.__name__}")

    if mensagem.stop_reason == "refusal":
        return Analise(erro="O modelo recusou a requisição por política de conteúdo.")

    texto = "\n".join(b.text for b in mensagem.content if b.type == "text").strip()
    if not texto:
        return Analise(erro="A API respondeu sem texto. Tente de novo.")

    return Analise(
        texto=texto,
        input_tokens=getattr(mensagem.usage, "input_tokens", 0) or 0,
        output_tokens=getattr(mensagem.usage, "output_tokens", 0) or 0,
    )
