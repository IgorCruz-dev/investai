"""Gera `dashboard/web/data.js` com um snapshot real para o dashboard web.

O dashboard em HTML/CSS/JS é estático: em vez de inventar dados, este script
busca preços, fundamentals e notícias de verdade, calcula os indicadores com os
mesmos módulos do sistema e grava tudo como um objeto JS.

Uso:
    .venv/bin/python dashboard/web/scripts/export_snapshot.py
"""

from __future__ import annotations

import json
import logging
import sys
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT))

import pandas as pd  # noqa: E402

from src.analysis.quantitative import (  # noqa: E402
    calculate_all_indicators,
    calculate_portfolio_metrics,
    portfolio_totals,
    rsi_series,
)
from src.config import Portfolio, Position  # noqa: E402
from src.data import market_data, news_fetcher  # noqa: E402

logging.basicConfig(level=logging.WARNING)

OUTPUT = ROOT / "dashboard" / "web" / "data.js"
BRIEFING_FILE = ROOT / "dashboard" / "web" / "scripts" / "briefing.md"

#: Carteira de demonstração do design — as mesmas posições do exemplo.
DEMO = Portfolio(
    positions=(
        Position("PETR4.SA", 100, 35.50, "acao"),
        Position("VALE3.SA", 50, 68.00, "acao"),
        Position("ITUB4.SA", 200, 25.00, "acao"),
    ),
    currency="BRL",
)

NAMES = {"PETR4.SA": "Petrobras PN", "VALE3.SA": "Vale ON", "ITUB4.SA": "Itaú Unibanco PN"}
SECTORS = {"PETR4.SA": "Petróleo e gás", "VALE3.SA": "Mineração", "ITUB4.SA": "Financeiro"}


def round_series(values, digits: int = 2) -> list:
    return [None if pd.isna(v) else round(float(v), digits) for v in values]


def build_asset(ticker: str, payload: dict, indicators: dict) -> dict:
    prices: pd.DataFrame = payload["prices"]
    closes = pd.to_numeric(prices["Close"], errors="coerce")

    rsi = rsi_series(closes, 14)
    rsi_aligned = [None] * len(prices)
    for position, value in rsi.items():
        if 0 <= position < len(rsi_aligned):
            rsi_aligned[position] = None if pd.isna(value) else round(float(value), 2)

    return {
        "ticker": ticker,
        "name": NAMES.get(ticker, ticker),
        "sector": SECTORS.get(ticker, ""),
        "dates": [d.strftime("%Y-%m-%d") for d in prices["Date"]],
        "open": round_series(prices["Open"]),
        "high": round_series(prices["High"]),
        "low": round_series(prices["Low"]),
        "close": round_series(prices["Close"]),
        "volume": [int(v) for v in prices["Volume"].fillna(0)],
        "ma20": round_series(closes.rolling(20).mean()),
        "ma50": round_series(closes.rolling(50).mean()),
        "ma200": round_series(closes.rolling(200).mean()),
        "rsi": rsi_aligned,
        "indicators": indicators,
        "fundamentals": payload.get("fundamentals", {}),
    }


def build_evolution(bundle: dict) -> list[dict]:
    """Valor da carteira ao longo de 12 meses: cotas × fechamento de cada dia."""
    frames = []
    for position in DEMO.positions:
        prices = bundle[position.ticker]["prices"]
        if prices.empty:
            continue
        series = pd.Series(
            pd.to_numeric(prices["Close"], errors="coerce").to_numpy() * position.shares,
            index=pd.to_datetime(prices["Date"]).to_numpy(),
            name=position.ticker,
        )
        frames.append(series)

    if not frames:
        return []

    total = pd.concat(frames, axis=1).sort_index().ffill().dropna().sum(axis=1)
    cost = sum(p.shares * (p.avg_price or 0) for p in DEMO.positions)
    return [
        {"date": date.strftime("%Y-%m-%d"), "value": round(float(value), 2),
         "cost": round(cost, 2)}
        for date, value in total.items()
    ]


def main() -> None:
    tickers = list(DEMO.tickers)
    print(f"buscando dados de {len(tickers)} ativos…")
    bundle = market_data.get_portfolio_data(tickers, period="1y", use_cache=False)
    indicators = calculate_all_indicators(bundle)
    metrics = calculate_portfolio_metrics(DEMO, bundle, indicators)
    totals = portfolio_totals(metrics)

    print("buscando notícias…")
    news = news_fetcher.fetch_financial_news(tickers, days=7, use_cache=False)

    positions = []
    for row in metrics.to_dict("records"):
        ticker = row["ticker"]
        positions.append({
            "ticker": ticker,
            "name": NAMES.get(ticker, ticker),
            "sector": SECTORS.get(ticker, ""),
            "shares": row["shares"],
            "avgPrice": row["avg_price"],
            "price": row["current_price"],
            "value": row["position_value"],
            "pnl": row["pnl_abs"],
            "pnlPct": row["pnl_pct"],
            "weight": row["weight_pct"],
            "change7d": row["change_7d"],
            "trend": (indicators.get(ticker) or {}).get("trend_signal"),
            "rsi": (indicators.get(ticker) or {}).get("rsi_14"),
        })

    briefing = BRIEFING_FILE.read_text(encoding="utf-8") if BRIEFING_FILE.exists() else ""

    snapshot = {
        "generatedAt": datetime.now().isoformat(timespec="seconds"),
        "currency": DEMO.currency,
        "totals": {k: (None if v is None or pd.isna(v) else round(float(v), 2))
                   for k, v in totals.items()},
        "positions": positions,
        "evolution": build_evolution(bundle),
        "assets": {t: build_asset(t, bundle[t], indicators.get(t, {}))
                   for t in tickers if not bundle[t]["prices"].empty},
        "news": news,
        "briefing": briefing,
    }

    payload = json.dumps(snapshot, ensure_ascii=False, separators=(",", ":"), default=str)
    OUTPUT.write_text(
        "/* Gerado por dashboard/web/scripts/export_snapshot.py — dados reais de mercado. */\n"
        f"window.INVESTAI_DATA = {payload};\n",
        encoding="utf-8",
    )
    size_kb = OUTPUT.stat().st_size / 1024
    print(f"gravado {OUTPUT.relative_to(ROOT)} ({size_kb:.0f} KB)")
    print(f"  posições: {len(positions)} | evolução: {len(snapshot['evolution'])} dias "
          f"| notícias: {sum(len(v) for v in news.values())} | briefing: {len(briefing)} chars")


if __name__ == "__main__":
    main()
