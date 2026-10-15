"""Montagem do briefing semanal: busca os dados e chama o analista.

Extraído de `src/agent/tools.py` por um motivo concreto: a ferramenta devolvia
só o texto e jogava fora o `usage` da resposta. Sem ele, o briefing — a operação
mais cara do sistema — não entrava na conta do teto de gasto mensal, e o teto
protegia tudo menos o que mais custa.

Aqui o `BriefingResult` sai inteiro, com tokens de entrada e saída.
"""

from __future__ import annotations

from src.analysis.llm_analyst import BriefingResult, generate_briefing
from src.analysis.quantitative import calculate_all_indicators, calculate_portfolio_metrics
from src.config import load_portfolio
from src.data import market_data, news_fetcher


def montar() -> BriefingResult:
    """Briefing da carteira atual. Erros chegam em `BriefingResult.error`."""
    portfolio = load_portfolio()
    if not portfolio.positions:
        return BriefingResult(error="A carteira está vazia — não há o que analisar.")

    bundle = market_data.get_portfolio_data(portfolio.tickers)
    indicators = calculate_all_indicators(bundle)
    metrics = calculate_portfolio_metrics(portfolio, bundle, indicators)
    news = news_fetcher.fetch_financial_news(portfolio.tickers)
    fundamentals = {t: p.get("fundamentals", {}) for t, p in bundle.items()}

    return generate_briefing(metrics, indicators, news, fundamentals,
                             currency=portfolio.currency)


def custo_estimado(resultado: BriefingResult) -> float:
    """Opus 5: US$ 5/M de entrada, US$ 25/M de saída."""
    uso = resultado.usage or {}
    return ((uso.get("input_tokens") or 0) / 1e6 * 5
            + (uso.get("output_tokens") or 0) / 1e6 * 25)
