"""Análise qualitativa com a Claude API — geração do briefing semanal.

Decisões de API (geração Opus 5):
  - `temperature` **não existe mais** nesta geração (enviá-lo devolve HTTP 400).
    O rigor factual vem do system prompt + `output_config.effort`, não de
    amostragem baixa.
  - A chamada usa streaming (`messages.stream(...).get_final_message()`), que é
    o caminho recomendado quando `max_tokens` é alto — evita timeout de HTTP.
  - Nenhuma exceção escapa: falhas voltam em `BriefingResult.error` com texto
    amigável em português.
"""

from __future__ import annotations

import logging
import math
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

import pandas as pd

from src.config import (
    CONTEXT_TOKEN_BUDGET,
    LLM_EFFORT,
    LLM_MAX_TOKENS,
    LLM_MODEL,
    LLM_TIMEOUT,
    anthropic_key,
)
from src.utils.formatters import NA, big_number, money, number, percent

logger = logging.getLogger(__name__)

SYSTEM_PROMPT = """Você é um analista financeiro especializado em ações brasileiras e americanas.
Sua função é analisar dados quantitativos e qualitativos de uma carteira de investimentos
e gerar um briefing semanal claro, objetivo e fundamentado em dados reais.

IMPORTANTE:
- Baseie TODAS as recomendações nos dados fornecidos
- Sempre explique o raciocínio por trás de cada recomendação
- Mencione explicitamente qual dado embasou cada conclusão
- Use linguagem clara e acessível, não jargão excessivo
- Seja honesto sobre incertezas — nunca prometa retornos
- Sempre inclua: contexto macro, análise por ativo, recomendações e score de risco

Formato do briefing (use exatamente estas seções, em markdown):

## RESUMO EXECUTIVO
(3-4 linhas)

## CONTEXTO DE MERCADO
(o que está acontecendo que afeta a carteira)

## ANÁLISE POR ATIVO
(para cada ativo: situação atual, pontos de atenção, recomendação)

## RECOMENDAÇÕES DA SEMANA
(comprar mais, manter, reduzir — com justificativa)

## SCORE DE RISCO DA CARTEIRA
(1-10 com explicação)

## PRÓXIMOS EVENTOS A MONITORAR
"""

USER_INSTRUCTION = (
    "Gere o briefing semanal da carteira abaixo seguindo exatamente o formato de seções "
    "definido. Use apenas os dados fornecidos; quando um dado estiver como N/D, diga que "
    "ele não está disponível em vez de estimar."
)

#: Campos que o contexto sempre precisa carregar (verificado em teste).
REQUIRED_CONTEXT_FIELDS = (
    "DATA DE REFERÊNCIA", "CARTEIRA", "INDICADORES TÉCNICOS", "FUNDAMENTOS", "NOTÍCIAS",
)

_FUNDAMENTAL_LABELS = (
    ("pe_ratio", "P/L", "number"),
    ("eps", "LPA (EPS)", "number"),
    ("revenue", "Receita", "big"),
    ("net_income", "Lucro líquido", "big"),
    ("debt_to_equity", "Dívida/Patrimônio", "number"),
    ("market_cap", "Valor de mercado", "big"),
    ("dividend_yield", "Dividend yield", "percent"),
)


@dataclass
class BriefingResult:
    """Resultado da geração — sempre devolvido, com sucesso ou com `error`."""

    text: str = ""
    generated_at: datetime | None = None
    model: str = LLM_MODEL
    usage: dict[str, Any] = field(default_factory=dict)
    error: str | None = None
    context_tokens: int | None = None

    @property
    def ok(self) -> bool:
        return bool(self.text) and self.error is None


#: Caracteres por token neste conteúdo. Medido com `messages.count_tokens` em
#: 12/10/2026: 903 caracteres de contexto = 576 tokens (1,57 char/token). Valores
#: monetários e percentuais em pt-BR ("R$ 1.234,50") tokenizam muito pior que
#: prosa, então a régua genérica de ~4 chars/token subestimaria em ~2,5x — e
#: subestimar é o lado perigoso, porque libera contexto acima do orçamento.
CHARS_PER_TOKEN = 1.5


def estimate_tokens(text: str) -> int:
    """Estimativa local e conservadora de tokens.

    Serve para decidir a poda do contexto sem depender de rede; o teste marcado
    como `paid` confere a estimativa contra `messages.count_tokens`.
    """
    return math.ceil(len(text) / CHARS_PER_TOKEN)


# --- Construção do contexto -------------------------------------------------
def _portfolio_section(portfolio_data: Any, currency: str) -> list[str]:
    lines = ["## CARTEIRA"]
    frame = portfolio_data if isinstance(portfolio_data, pd.DataFrame) else pd.DataFrame(portfolio_data or [])
    if frame.empty:
        lines.append("- (carteira vazia)")
        return lines

    total_value = frame["position_value"].sum(skipna=True) if "position_value" in frame else None
    total_cost = frame["cost_basis"].sum(skipna=True) if "cost_basis" in frame else None

    for row in frame.to_dict("records"):
        lines.append(
            f"- {row.get('ticker', '?')}: {number(row.get('shares'), 0)} cotas | "
            f"preço médio {money(row.get('avg_price'), currency)} | "
            f"preço atual {money(row.get('current_price'), currency)} | "
            f"valor {money(row.get('position_value'), currency)} | "
            f"P&L {money(row.get('pnl_abs'), currency)} ({percent(row.get('pnl_pct'))}) | "
            f"peso {percent(row.get('weight_pct'), signed=False)}"
        )

    if total_value is not None and total_cost:
        pnl = total_value - total_cost
        lines.append(
            f"- TOTAL: valor {money(total_value, currency)} | custo {money(total_cost, currency)} | "
            f"P&L {money(pnl, currency)} ({percent(pnl / total_cost * 100)})"
        )
    return lines


def _indicators_section(indicators: dict[str, dict[str, Any]], currency: str) -> list[str]:
    lines = ["", "## INDICADORES TÉCNICOS (calculados localmente)"]
    if not indicators:
        lines.append("- (sem indicadores disponíveis)")
        return lines

    for ticker, values in indicators.items():
        values = values or {}
        lines.append(
            f"- {ticker}: preço {money(values.get('price_current'), currency)} | "
            f"7d {percent(values.get('price_change_7d'))} | 30d {percent(values.get('price_change_30d'))} | "
            f"90d {percent(values.get('price_change_90d'))} | 1a {percent(values.get('price_change_1y'))} | "
            f"MM20 {number(values.get('ma_20'))} | MM50 {number(values.get('ma_50'))} | "
            f"MM200 {number(values.get('ma_200'))} | RSI14 {number(values.get('rsi_14'))} | "
            f"volume médio 30d {big_number(values.get('volume_avg_30d'))} | "
            f"volatilidade anualizada {percent(values.get('volatility_30d'), signed=False)} | "
            f"tendência {values.get('trend_signal', NA)}"
        )
    lines.append(
        "Referência: RSI < 30 = sobrevendido, RSI > 70 = sobrecomprado; "
        "tendência ALTA = MM20 > MM50 > MM200."
    )
    return lines


def _fundamentals_section(fundamentals: dict[str, dict[str, Any]], include: bool) -> list[str]:
    lines = ["", "## FUNDAMENTOS"]
    if not include:
        lines.append("- (omitidos para caber no orçamento de contexto)")
        return lines
    if not fundamentals:
        lines.append("- (indisponíveis)")
        return lines

    for ticker, values in fundamentals.items():
        values = values or {}
        parts: list[str] = []
        for key, label, kind in _FUNDAMENTAL_LABELS:
            value = values.get(key)
            if value is None:
                continue  # só os campos realmente disponíveis entram no prompt
            if kind == "big":
                parts.append(f"{label} {big_number(value, values.get('currency'))}")
            elif kind == "percent":
                parts.append(f"{label} {percent(value, signed=False)}")
            else:
                parts.append(f"{label} {number(value)}")
        name = values.get("name") or ticker
        lines.append(f"- {ticker} ({name}): " + (" | ".join(parts) if parts else "sem dados disponíveis"))
    return lines


def _news_section(news: dict[str, list[dict[str, str]]], per_ticker: int) -> list[str]:
    lines = ["", "## NOTÍCIAS DOS ÚLTIMOS 7 DIAS (manchete + veículo; sem resumo do texto)"]
    if not news or per_ticker <= 0:
        lines.append("- (nenhuma notícia disponível — baseie-se apenas nos dados quantitativos)")
        return lines

    for ticker, articles in news.items():
        lines.append(f"### {ticker}")
        if not articles:
            lines.append("- (sem notícias)")
            continue
        for article in articles[:per_ticker]:
            title = article.get("title", "").strip()
            description = (article.get("description") or "").strip()
            published = (article.get("published") or "").strip()[:10]
            source = (article.get("source") or "").strip()
            # O veículo entra no contexto porque é sinal de credibilidade da
            # informação (Valor/InfoMoney vs. blog) — o LLM pondera com isso.
            suffix = f" (fonte: {source})" if source else ""
            lines.append(
                f"- [{published}] {title}{suffix}" + (f" — {description}" if description else "")
            )
    return lines


def build_briefing_context(
    portfolio_data: Any,
    indicators: dict[str, dict[str, Any]] | None = None,
    news: dict[str, list[dict[str, str]]] | None = None,
    fundamentals: dict[str, dict[str, Any]] | None = None,
    currency: str = "BRL",
    reference_date: datetime | None = None,
    token_budget: int = CONTEXT_TOKEN_BUDGET,
) -> str:
    """Monta o contexto enviado ao Claude — função pura, testável sem rede.

    Inclui apenas o que o spec autoriza: resumo da carteira, indicadores já
    calculados, fundamentals disponíveis, até 5 notícias por ativo e a data de
    referência. Se o resultado passar de `token_budget`, poda primeiro as
    notícias e, em último caso, os fundamentos.
    """
    reference_date = reference_date or datetime.now()
    indicators = indicators or {}
    news = news or {}
    fundamentals = fundamentals or {}

    header = [
        f"# DADOS DA CARTEIRA",
        f"DATA DE REFERÊNCIA: {reference_date.strftime('%d/%m/%Y')} (moeda: {currency})",
        "",
    ]

    def assemble(news_per_ticker: int, include_fundamentals: bool) -> str:
        return "\n".join(
            header
            + _portfolio_section(portfolio_data, currency)
            + _indicators_section(indicators, currency)
            + _fundamentals_section(fundamentals, include_fundamentals)
            + _news_section(news, news_per_ticker)
        )

    # O system prompt viaja na mesma requisição, então conta no orçamento.
    overhead = estimate_tokens(SYSTEM_PROMPT) + estimate_tokens(USER_INSTRUCTION)

    # Degraus de poda, do mais completo ao mínimo viável.
    for news_per_ticker, include_fundamentals in ((5, True), (3, True), (1, True), (0, True), (0, False)):
        context = assemble(news_per_ticker, include_fundamentals)
        if overhead + estimate_tokens(context) <= token_budget:
            if news_per_ticker < 5 or not include_fundamentals:
                logger.info(
                    "Contexto podado para caber no orçamento (%d notícias/ativo, fundamentos=%s)",
                    news_per_ticker, include_fundamentals,
                )
            return context

    logger.warning("Contexto acima do orçamento de %d tokens mesmo após a poda", token_budget)
    return context


# --- Chamada ao Claude ------------------------------------------------------
def generate_briefing(
    portfolio_data: Any,
    indicators: dict[str, dict[str, Any]] | None = None,
    news: dict[str, list[dict[str, str]]] | None = None,
    fundamentals: dict[str, dict[str, Any]] | None = None,
    currency: str = "BRL",
    model: str = LLM_MODEL,
    max_tokens: int = LLM_MAX_TOKENS,
    timeout: float = LLM_TIMEOUT,
    effort: str = LLM_EFFORT,
) -> BriefingResult:
    """Gera o briefing semanal em markdown (pt-BR).

    Tem custo de API — por isso o dashboard só chama sob clique explícito.
    """
    context = build_briefing_context(
        portfolio_data, indicators, news, fundamentals, currency=currency
    )
    context_tokens = estimate_tokens(context)

    if not anthropic_key():
        return BriefingResult(
            error="ANTHROPIC_API_KEY não configurada. Copie .env.example para .env e "
                  "preencha sua chave para gerar o briefing.",
            context_tokens=context_tokens,
            model=model,
        )

    try:
        import anthropic
    except ImportError:
        return BriefingResult(
            error="Pacote `anthropic` não instalado. Rode: pip install -r requirements.txt",
            context_tokens=context_tokens,
            model=model,
        )

    client = anthropic.Anthropic(timeout=timeout, max_retries=2)
    try:
        with client.messages.stream(
            model=model,
            max_tokens=max_tokens,
            system=SYSTEM_PROMPT,
            thinking={"type": "adaptive"},
            output_config={"effort": effort},
            messages=[{"role": "user", "content": f"{USER_INSTRUCTION}\n\n{context}"}],
        ) as stream:
            message = stream.get_final_message()
    except anthropic.AuthenticationError:
        return BriefingResult(error="Chave da Anthropic inválida ou sem permissão. "
                                    "Verifique ANTHROPIC_API_KEY no .env.",
                              context_tokens=context_tokens, model=model)
    except anthropic.RateLimitError as exc:
        retry_after = exc.response.headers.get("retry-after", "alguns segundos") if exc.response else "alguns segundos"
        return BriefingResult(error=f"Limite de requisições da API atingido. Tente novamente em {retry_after}.",
                              context_tokens=context_tokens, model=model)
    except anthropic.APITimeoutError:
        return BriefingResult(
            error=f"A geração do briefing passou de {timeout:.0f}s e foi interrompida. "
                  "Tente de novo ou aumente INVESTAI_LLM_TIMEOUT no .env.",
            context_tokens=context_tokens, model=model,
        )
    except anthropic.APIConnectionError:
        return BriefingResult(error="Não foi possível conectar à API da Anthropic. Verifique sua internet.",
                              context_tokens=context_tokens, model=model)
    except anthropic.APIStatusError as exc:
        detail = "Erro no servidor da Anthropic." if exc.status_code >= 500 else f"A API recusou a requisição: {exc.message}"
        return BriefingResult(error=f"{detail} (HTTP {exc.status_code})",
                              context_tokens=context_tokens, model=model)
    except Exception as exc:  # noqa: BLE001 — fronteira: nada escapa para o usuário
        logger.exception("Falha inesperada ao gerar o briefing")
        return BriefingResult(error=f"Falha inesperada ao gerar o briefing: {exc}",
                              context_tokens=context_tokens, model=model)

    if message.stop_reason == "refusal":
        return BriefingResult(error="O modelo recusou a requisição por política de conteúdo.",
                              context_tokens=context_tokens, model=model)

    text = "\n\n".join(block.text for block in message.content if block.type == "text").strip()
    if not text:
        return BriefingResult(error="A API respondeu sem conteúdo de texto. Tente novamente.",
                              context_tokens=context_tokens, model=model)

    if message.stop_reason == "max_tokens":
        text += ("\n\n> _Briefing truncado por limite de tokens. "
                 "Aumente INVESTAI_MAX_TOKENS no .env para um texto completo._")

    return BriefingResult(
        text=text,
        generated_at=datetime.now(),
        model=message.model or model,
        usage={
            "input_tokens": getattr(message.usage, "input_tokens", None),
            "output_tokens": getattr(message.usage, "output_tokens", None),
        },
        context_tokens=context_tokens,
    )


def probe() -> bool:
    """Indica se há chave configurada (status na sidebar) — não gasta chamada."""
    return bool(anthropic_key())
