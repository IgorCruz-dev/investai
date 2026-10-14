"""Aba 2 — análise técnica: candlestick com médias móveis e RSI."""

from __future__ import annotations

from typing import Any

import pandas as pd
import plotly.graph_objects as go
import streamlit as st
from plotly.subplots import make_subplots

from src.analysis.quantitative import rsi_series
from src.utils.formatters import number, percent

SIGNAL_STYLE = {
    "ALTA": ("🟢", "#16a34a"),
    "BAIXA": ("🔴", "#dc2626"),
    "NEUTRO": ("⚪", "#6b7280"),
}
MA_COLORS = {20: "#2563eb", 50: "#f59e0b", 200: "#7c3aed"}


def price_figure(prices: pd.DataFrame, ticker: str) -> go.Figure:
    """Candlestick + MM20/50/200 em cima, RSI(14) embaixo."""
    figure = make_subplots(
        rows=2, cols=1, shared_xaxes=True, vertical_spacing=0.06, row_heights=[0.72, 0.28],
        subplot_titles=(f"{ticker} — preço e médias móveis", "RSI (14)"),
    )

    figure.add_trace(
        go.Candlestick(
            x=prices["Date"], open=prices["Open"], high=prices["High"],
            low=prices["Low"], close=prices["Close"], name="OHLC",
            increasing_line_color="#16a34a", decreasing_line_color="#dc2626",
        ),
        row=1, col=1,
    )

    closes = pd.to_numeric(prices["Close"], errors="coerce")
    for window, color in MA_COLORS.items():
        if len(closes) >= window:
            figure.add_trace(
                go.Scatter(
                    x=prices["Date"], y=closes.rolling(window).mean(),
                    name=f"MM{window}", line=dict(color=color, width=1.4),
                ),
                row=1, col=1,
            )

    rsi = rsi_series(closes, 14)
    if not rsi.empty:
        # O índice do RSI é posicional sobre os fechamentos válidos.
        figure.add_trace(
            go.Scatter(
                x=prices["Date"].iloc[rsi.index], y=rsi.to_numpy(),
                name="RSI(14)", line=dict(color="#0ea5e9", width=1.4),
            ),
            row=2, col=1,
        )
        for level, dash, label in ((70, "dash", "sobrecomprado"), (30, "dash", "sobrevendido")):
            figure.add_hline(
                y=level, line=dict(color="#9ca3af", width=1, dash=dash),
                annotation_text=f"{level} — {label}", annotation_position="top left",
                row=2, col=1,
            )
        figure.update_yaxes(range=[0, 100], row=2, col=1)

    figure.update_layout(
        height=620, margin=dict(t=60, b=30, l=40, r=20),
        xaxis_rangeslider_visible=False, hovermode="x unified",
        legend=dict(orientation="h", yanchor="bottom", y=1.04, x=0),
    )
    return figure


def render_signal(indicators: dict[str, Any]) -> None:
    signal = indicators.get("trend_signal", "NEUTRO")
    icon, color = SIGNAL_STYLE.get(signal, SIGNAL_STYLE["NEUTRO"])
    st.markdown(
        f"**Tendência:** <span style='color:{color};font-weight:700'>{icon} {signal}</span>",
        unsafe_allow_html=True,
    )
    col1, col2, col3, col4 = st.columns(4)
    col1.metric("RSI (14)", number(indicators.get("rsi_14")))
    col2.metric("MM20", number(indicators.get("ma_20")))
    col3.metric("MM50", number(indicators.get("ma_50")))
    col4.metric("MM200", number(indicators.get("ma_200")))
    col1, col2, col3, col4 = st.columns(4)
    col1.metric("7 dias", percent(indicators.get("price_change_7d")))
    col2.metric("30 dias", percent(indicators.get("price_change_30d")))
    col3.metric("90 dias", percent(indicators.get("price_change_90d")))
    col4.metric("Volatilidade anual.", percent(indicators.get("volatility_30d"), signed=False))


def render(market_data: dict[str, dict[str, Any]], indicators: dict[str, dict[str, Any]]) -> None:
    if not market_data:
        st.info("Nenhum dado carregado. Use **Atualizar Dados** na barra lateral.")
        return

    for ticker, payload in market_data.items():
        st.subheader(ticker)
        prices = payload.get("prices")
        if prices is None or prices.empty:
            st.warning(f"Sem histórico de preços para {ticker} — ticker inválido ou API indisponível.")
            st.divider()
            continue

        render_signal(indicators.get(ticker, {}))
        st.plotly_chart(price_figure(prices, ticker), key=f"chart-{ticker}")
        st.divider()
