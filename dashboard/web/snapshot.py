"""Monta o snapshot que a interface web consome.

Era um script (`scripts/export_snapshot.py`) com uma carteira de demonstração
fixa no código. Virou módulo importável lendo a carteira **real** porque agora
dois consumidores precisam dele: o CLI, que grava `data.js` para abrir o
dashboard sem servidor, e o cron da VM, que publica no Postgres para a Vercel
ler.

Por que a web não calcula nada disso: indicadores e notícias exigem pandas,
yfinance e requisições a APIs externas. Fazer isso numa função serverless a cada
carregamento de página seria lento, caro em tempo de execução e sujeito a
bloqueio por IP. A VM calcula uma vez a cada 30 minutos e publica; a web lê uma
linha de JSON.
"""

from __future__ import annotations

import logging
from datetime import datetime
from typing import Any

import pandas as pd

from src.analysis.quantitative import (
    calculate_all_indicators,
    calculate_portfolio_metrics,
    portfolio_totals,
    rsi_series,
)
from src.analysis.screener import UNIVERSE
from src.config import Portfolio, load_portfolio
from src.data import market_data, news_fetcher

logger = logging.getLogger(__name__)

#: Nome e setor dos ativos conhecidos, para a tela não mostrar só o ticker.
CATALOGO: dict[str, tuple[str, str]] = {
    a.ticker: (a.name, a.sector) for a in UNIVERSE
}


def _arredondar(valores: Any, casas: int = 2) -> list:
    return [None if pd.isna(v) else round(float(v), casas) for v in valores]


def _limpar(valor: Any) -> Any:
    """`NaN` → `None`. JSON não tem NaN, e `NaN` virando `null` é o que a tela
    já sabe exibir como N/D."""
    if valor is None:
        return None
    try:
        if pd.isna(valor):
            return None
    except (TypeError, ValueError):
        return valor
    return round(float(valor), 2) if isinstance(valor, (int, float)) else valor


def _nome_e_setor(ticker: str, fundamentals: dict[str, Any]) -> tuple[str, str]:
    nome, setor = CATALOGO.get(ticker, ("", ""))
    return (nome or fundamentals.get("name") or ticker,
            setor or fundamentals.get("sector") or "")


def _ativo(ticker: str, payload: dict, indicadores: dict) -> dict[str, Any]:
    """Série histórica de um ativo, no formato que os gráficos em SVG esperam."""
    precos: pd.DataFrame = payload["prices"]
    fechamentos = pd.to_numeric(precos["Close"], errors="coerce")

    rsi = rsi_series(fechamentos, 14)
    rsi_alinhado: list = [None] * len(precos)
    for posicao, valor in rsi.items():
        if 0 <= posicao < len(rsi_alinhado):
            rsi_alinhado[posicao] = None if pd.isna(valor) else round(float(valor), 2)

    nome, setor = _nome_e_setor(ticker, payload.get("fundamentals") or {})
    return {
        "ticker": ticker,
        "name": nome,
        "sector": setor,
        "dates": [d.strftime("%Y-%m-%d") for d in precos["Date"]],
        "open": _arredondar(precos["Open"]),
        "high": _arredondar(precos["High"]),
        "low": _arredondar(precos["Low"]),
        "close": _arredondar(precos["Close"]),
        "volume": [int(v) for v in precos["Volume"].fillna(0)],
        "ma20": _arredondar(fechamentos.rolling(20).mean()),
        "ma50": _arredondar(fechamentos.rolling(50).mean()),
        "ma200": _arredondar(fechamentos.rolling(200).mean()),
        "rsi": rsi_alinhado,
        "indicators": indicadores,
        "fundamentals": payload.get("fundamentals", {}),
    }


def _evolucao(carteira: Portfolio, bundle: dict) -> list[dict[str, Any]]:
    """Valor da carteira dia a dia: cotas × fechamento, somado.

    Usa as cotas de **hoje** para toda a série, o que responde "quanto valeria a
    carteira atual naquele dia" — não é o histórico real de patrimônio, que
    exigiria replay do ledger contra o preço de cada dia. Fica assim porque é o
    que a tela precisa (comparar valor contra custo) e é honesto: a linha de
    custo também é a de hoje.
    """
    series = []
    for posicao in carteira.positions:
        precos = (bundle.get(posicao.ticker) or {}).get("prices")
        if precos is None or precos.empty:
            continue
        series.append(pd.Series(
            pd.to_numeric(precos["Close"], errors="coerce").to_numpy() * posicao.shares,
            index=pd.to_datetime(precos["Date"]).to_numpy(),
            name=posicao.ticker,
        ))
    if not series:
        return []

    total = pd.concat(series, axis=1).sort_index().ffill().dropna().sum(axis=1)
    custo = sum(p.shares * (p.avg_price or 0) for p in carteira.positions)
    return [
        {"date": dia.strftime("%Y-%m-%d"), "value": round(float(valor), 2),
         "cost": round(custo, 2)}
        for dia, valor in total.items()
    ]


def construir(carteira: Portfolio | None = None, *, com_noticias: bool = True,
              briefing: str = "", use_cache: bool = True) -> dict[str, Any]:
    """O snapshot completo. Carteira vazia devolve um snapshot válido e vazio."""
    carteira = carteira if carteira is not None else load_portfolio()
    tickers = list(carteira.tickers)

    base: dict[str, Any] = {
        "generatedAt": datetime.now().isoformat(timespec="seconds"),
        "currency": carteira.currency,
        "totals": {}, "positions": [], "evolution": [], "assets": {},
        "news": {}, "briefing": briefing,
    }
    if not tickers:
        logger.info("carteira vazia — snapshot sem ativos")
        return base

    bundle = market_data.get_portfolio_data(tickers, use_cache=use_cache)
    indicadores = calculate_all_indicators(bundle)
    metricas = calculate_portfolio_metrics(carteira, bundle, indicadores)
    totais = portfolio_totals(metricas)

    classes = {p.ticker: p.asset_class for p in carteira.positions}
    posicoes = []
    for linha in metricas.to_dict("records"):
        ticker = linha["ticker"]
        nome, setor = _nome_e_setor(
            ticker, (bundle.get(ticker) or {}).get("fundamentals") or {})
        ind = indicadores.get(ticker) or {}
        posicoes.append({
            "ticker": ticker, "name": nome, "sector": setor,
            "assetClass": classes.get(ticker, "acao"),
            "shares": _limpar(linha["shares"]),
            "avgPrice": _limpar(linha["avg_price"]),
            "price": _limpar(linha["current_price"]),
            "value": _limpar(linha["position_value"]),
            "pnl": _limpar(linha["pnl_abs"]),
            "pnlPct": _limpar(linha["pnl_pct"]),
            "weight": _limpar(linha["weight_pct"]),
            "change7d": _limpar(linha["change_7d"]),
            "trend": ind.get("trend_signal"),
            "rsi": _limpar(ind.get("rsi_14")),
        })

    base.update({
        "totals": {k: _limpar(v) for k, v in totais.items()},
        "positions": posicoes,
        "evolution": _evolucao(carteira, bundle),
        "assets": {t: _ativo(t, bundle[t], indicadores.get(t, {}))
                   for t in tickers
                   if (bundle.get(t) or {}).get("prices") is not None
                   and not bundle[t]["prices"].empty},
        "news": news_fetcher.fetch_financial_news(tickers, use_cache=use_cache)
                if com_noticias else {},
    })
    return base
