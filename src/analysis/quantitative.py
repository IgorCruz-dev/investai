"""Análise quantitativa: médias móveis, RSI, variações, risco da carteira.

Puramente matemático — nenhuma chamada de rede e nenhum LLM. Indicador que não
pode ser calculado por falta de dados devolve `None` (o dashboard mostra "N/D")
em vez de um número inventado.
"""

from __future__ import annotations

import logging
from typing import Any, Sequence

import numpy as np
import pandas as pd

from src.config import Portfolio

logger = logging.getLogger(__name__)

TRADING_DAYS_PER_YEAR = 252
TREND_SIGNALS = ("ALTA", "BAIXA", "NEUTRO")

INDICATOR_FIELDS = (
    "price_current", "price_change_7d", "price_change_30d", "price_change_90d",
    "price_change_1y", "ma_20", "ma_50", "ma_200", "rsi_14",
    "volume_avg_30d", "volatility_30d", "trend_signal",
)


def _empty_indicators() -> dict[str, Any]:
    values: dict[str, Any] = {field: None for field in INDICATOR_FIELDS}
    values["trend_signal"] = "NEUTRO"
    return values


def _closes(prices_df: pd.DataFrame) -> pd.Series:
    return pd.to_numeric(prices_df["Close"], errors="coerce").dropna()


def rsi_series(prices: pd.Series | Sequence[float], period: int = 14) -> pd.Series:
    """Série histórica do RSI pela definição de Wilder — usada nos gráficos.

    Wilder inicializa com a **média simples** dos primeiros `period` ganhos e
    perdas e só então aplica a suavização recursiva; usar `ewm` desde o
    primeiro delta erra o valor em séries curtas (daria 50,7 onde a série de
    referência clássica vale 70,5). O índice devolvido é posicional sobre os
    fechamentos válidos, começando em `period`, para alinhar com as datas.
    """
    closes = pd.to_numeric(pd.Series(list(prices)), errors="coerce").dropna().reset_index(drop=True)
    if len(closes) < period + 1:
        return pd.Series(dtype="float64")

    delta = closes.diff().iloc[1:]
    gains = delta.clip(lower=0.0).to_numpy()
    losses = (-delta.clip(upper=0.0)).to_numpy()

    avg_gain = float(gains[:period].mean())
    avg_loss = float(losses[:period].mean())
    avg_gains = [avg_gain]
    avg_losses = [avg_loss]
    for i in range(period, len(gains)):
        avg_gain = (avg_gain * (period - 1) + gains[i]) / period
        avg_loss = (avg_loss * (period - 1) + losses[i]) / period
        avg_gains.append(avg_gain)
        avg_losses.append(avg_loss)

    up = np.asarray(avg_gains)
    down = np.asarray(avg_losses)
    with np.errstate(divide="ignore", invalid="ignore"):
        rsi = 100.0 - (100.0 / (1.0 + up / down))
    # Janela sem perda alguma: topo da escala, sem divisão por zero.
    rsi = np.where(down == 0, np.where(up > 0, 100.0, 50.0), rsi)

    return pd.Series(rsi, index=range(period, len(closes)), dtype="float64")


def calculate_rsi(prices: pd.Series | Sequence[float], period: int = 14) -> float | None:
    """RSI de `period` períodos, entre 0 e 100.

    `None` quando há menos de `period + 1` observações.
    RSI < 30 = sobrevendido; RSI > 70 = sobrecomprado.
    """
    series = rsi_series(prices, period)
    if series.empty or pd.isna(series.iloc[-1]):
        return None
    return float(round(series.iloc[-1], 2))


def _moving_average(closes: pd.Series, window: int) -> float | None:
    if len(closes) < window:
        return None
    return float(round(closes.tail(window).mean(), 4))


def _change_over_days(prices_df: pd.DataFrame, days: int) -> float | None:
    """Variação % entre o último fechamento e o de `days` dias corridos atrás.

    Se a série não alcança a data de corte mas cobre ao menos 90% da janela
    (caso típico de `period="1y"` para a variação de 1 ano), usa o ponto mais
    antigo disponível; abaixo disso devolve `None` em vez de extrapolar.
    """
    if prices_df.empty or "Date" not in prices_df.columns:
        return None

    frame = prices_df.dropna(subset=["Close"])
    if len(frame) < 2:
        return None

    dates = pd.to_datetime(frame["Date"])
    closes = pd.to_numeric(frame["Close"], errors="coerce")
    last_price = closes.iloc[-1]
    cutoff = dates.iloc[-1] - pd.Timedelta(days=days)

    eligible = closes[dates <= cutoff]
    if not eligible.empty:
        reference = eligible.iloc[-1]
    else:
        span_days = (dates.iloc[-1] - dates.iloc[0]).days
        if span_days < days * 0.9:
            return None
        reference = closes.iloc[0]

    if pd.isna(reference) or reference == 0:
        return None
    return float(round((last_price / reference - 1) * 100, 2))


def _trend_signal(ma_20: float | None, ma_50: float | None, ma_200: float | None) -> str:
    if None in (ma_20, ma_50, ma_200):
        return "NEUTRO"
    if ma_20 > ma_50 > ma_200:
        return "ALTA"
    if ma_20 < ma_50 < ma_200:
        return "BAIXA"
    return "NEUTRO"


def calculate_indicators(prices_df: pd.DataFrame | None) -> dict[str, Any]:
    """Indicadores técnicos a partir do histórico OHLCV.

    Sempre devolve todas as chaves de `INDICATOR_FIELDS`; as que não puderam
    ser calculadas vêm como `None` (`trend_signal` vem como "NEUTRO").
    """
    if prices_df is None or not isinstance(prices_df, pd.DataFrame) or prices_df.empty:
        return _empty_indicators()
    if "Close" not in prices_df.columns:
        logger.warning("Histórico sem coluna Close — indicadores indisponíveis")
        return _empty_indicators()

    closes = _closes(prices_df)
    if closes.empty:
        return _empty_indicators()

    ma_20 = _moving_average(closes, 20)
    ma_50 = _moving_average(closes, 50)
    ma_200 = _moving_average(closes, 200)

    daily_returns = closes.pct_change().dropna()
    volatility = None
    if len(daily_returns) >= 30:
        volatility = float(round(
            daily_returns.tail(30).std(ddof=1) * np.sqrt(TRADING_DAYS_PER_YEAR) * 100, 2
        ))

    volume_avg = None
    if "Volume" in prices_df.columns:
        volumes = pd.to_numeric(prices_df["Volume"], errors="coerce").dropna()
        if not volumes.empty:
            volume_avg = float(round(volumes.tail(30).mean(), 0))

    return {
        "price_current": float(round(closes.iloc[-1], 4)),
        "price_change_7d": _change_over_days(prices_df, 7),
        "price_change_30d": _change_over_days(prices_df, 30),
        "price_change_90d": _change_over_days(prices_df, 90),
        "price_change_1y": _change_over_days(prices_df, 365),
        "ma_20": ma_20,
        "ma_50": ma_50,
        "ma_200": ma_200,
        "rsi_14": calculate_rsi(closes, 14),
        "volume_avg_30d": volume_avg,
        "volatility_30d": volatility,
        "trend_signal": _trend_signal(ma_20, ma_50, ma_200),
    }


def calculate_all_indicators(market_data: dict[str, dict[str, Any]]) -> dict[str, dict[str, Any]]:
    """Aplica `calculate_indicators` em cada ativo do dicionário de market data."""
    return {
        ticker: calculate_indicators(payload.get("prices"))
        for ticker, payload in (market_data or {}).items()
    }


PORTFOLIO_COLUMNS = [
    "ticker", "asset_class", "shares", "avg_price", "current_price", "cost_basis",
    "position_value", "pnl_abs", "pnl_pct", "weight_pct", "target_weight", "change_7d",
]

#: Classe sem cotação de mercado: `shares` guarda o valor em reais.
CASH_LIKE_CLASSES = ("renda_fixa",)


def calculate_portfolio_metrics(
    portfolio: Portfolio | Sequence[dict],
    market_data: dict[str, dict[str, Any]],
    indicators: dict[str, dict[str, Any]] | None = None,
) -> pd.DataFrame:
    """Consolida a carteira: valor atual, P&L e peso de cada posição.

    Posições sem preço atual entram com `NaN` (viram "N/D" na interface) e são
    excluídas do cálculo de peso, para não distorcer os percentuais.
    """
    positions = portfolio.as_dicts() if isinstance(portfolio, Portfolio) else list(portfolio or [])
    if not positions:
        return pd.DataFrame(columns=PORTFOLIO_COLUMNS)

    indicators = indicators or {}
    rows: list[dict[str, Any]] = []

    for position in positions:
        ticker = str(position.get("ticker", "")).upper()
        shares = float(position.get("shares", 0) or 0)
        raw_avg = position.get("avg_price")
        # `None` = posição planejada (recomendada, ainda não comprada): sem
        # preço de compra não existe P&L, e usar o preço atual criaria um
        # resultado falso de 0%.
        avg_price = None if raw_avg in (None, "") else float(raw_avg)
        asset_class = str(position.get("asset_class", "acao") or "acao").lower()

        if asset_class in CASH_LIKE_CLASSES:
            # Renda fixa não tem cotação: `shares` já é o valor em reais.
            ticker_indicators = {}
            current_price = 1.0
            position_value = shares
        else:
            ticker_indicators = indicators.get(ticker) or calculate_indicators(
                (market_data or {}).get(ticker, {}).get("prices")
            )
            current_price = ticker_indicators.get("price_current")
            position_value = shares * current_price if current_price is not None else np.nan

        # O custo depende só do preço médio: numa posição real sem cotação
        # atual, o quanto foi pago continua sendo informação conhecida.
        cost_basis = shares * avg_price if avg_price is not None else np.nan
        if avg_price is None or pd.isna(position_value):
            pnl_abs = np.nan
            pnl_pct = np.nan
        else:
            pnl_abs = position_value - cost_basis
            pnl_pct = ((current_price / avg_price - 1) * 100) if avg_price else np.nan

        rows.append({
            "ticker": ticker,
            "asset_class": asset_class,
            "shares": shares,
            "avg_price": avg_price if avg_price is not None else np.nan,
            "current_price": current_price if current_price is not None else np.nan,
            "cost_basis": cost_basis,
            "position_value": position_value,
            "pnl_abs": pnl_abs,
            "pnl_pct": pnl_pct,
            "weight_pct": np.nan,
            "target_weight": position.get("target_weight"),
            "change_7d": ticker_indicators.get("price_change_7d"),
        })

    frame = pd.DataFrame(rows, columns=PORTFOLIO_COLUMNS)
    total_value = frame["position_value"].sum(skipna=True)
    if total_value and not pd.isna(total_value) and total_value != 0:
        frame["weight_pct"] = frame["position_value"] / total_value * 100

    return frame


def portfolio_totals(metrics: pd.DataFrame) -> dict[str, Any]:
    """Totais da carteira para os KPIs do topo do dashboard."""
    if metrics is None or metrics.empty:
        return {"total_value": None, "total_cost": None, "pnl_abs": None, "pnl_pct": None}

    total_value = float(metrics["position_value"].sum(skipna=True))
    total_cost = float(metrics["cost_basis"].sum(skipna=True))
    # Carteira planejada não tem custo: devolver P&L zero sugeriria que ela já
    # foi comprada e está empatada.
    if not total_cost:
        return {"total_value": total_value, "total_cost": None,
                "pnl_abs": None, "pnl_pct": None}

    pnl_abs = total_value - total_cost
    return {
        "total_value": total_value,
        "total_cost": total_cost,
        "pnl_abs": pnl_abs,
        "pnl_pct": (pnl_abs / total_cost * 100) if total_cost else None,
    }
