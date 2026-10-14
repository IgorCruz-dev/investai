"""Aba 1 — visualização da carteira: tabela colorida + composição."""

from __future__ import annotations

import pandas as pd
import plotly.graph_objects as go
import streamlit as st

from src.analysis.quantitative import portfolio_totals
from src.utils.formatters import money, number, percent

POSITIVE = "#16a34a"
NEGATIVE = "#dc2626"

COLUMN_LABELS = {
    "ticker": "Ticker",
    "shares": "Cotas",
    "avg_price": "Preço Médio",
    "current_price": "Preço Atual",
    "position_value": "Valor Total",
    "pnl_abs": "P&L",
    "pnl_pct": "P&L (%)",
    "change_7d": "Variação 7d",
    "weight_pct": "Peso",
}

#: Carteira planejada não tem preço de compra — as colunas de P&L sairiam todas
#: "N/D" e só poluiriam a tabela.
PLANNED_COLUMN_LABELS = {
    "ticker": "Ticker",
    "asset_class": "Classe",
    "shares": "Cotas",
    "current_price": "Preço Atual",
    "position_value": "Valor",
    "weight_pct": "Peso",
    "target_weight": "Peso-alvo",
    "change_7d": "Variação 7d",
}

CLASS_LABELS = {
    "renda_fixa": "Renda fixa",
    "etf": "ETF",
    "fii": "FII",
    "acao": "Ação",
}


def _color_by_sign(value: object) -> str:
    if value is None or pd.isna(value):
        return ""
    return f"color: {POSITIVE}" if float(value) > 0 else (f"color: {NEGATIVE}" if float(value) < 0 else "")


def render_planned_table(metrics: pd.DataFrame, currency: str = "BRL") -> None:
    """Tabela de carteira planejada: sem P&L, com peso-alvo."""
    display = metrics[list(PLANNED_COLUMN_LABELS)].rename(columns=PLANNED_COLUMN_LABELS)
    display["Classe"] = display["Classe"].map(lambda c: CLASS_LABELS.get(c, c))
    # Renda fixa não tem cota: o valor em reais já está na coluna Valor.
    renda_fixa = metrics["asset_class"].eq("renda_fixa").to_numpy()
    display.loc[renda_fixa, "Cotas"] = float("nan")

    styler = (
        display.style
        .format({
            "Cotas": lambda v: number(v, 0),
            "Preço Atual": lambda v: money(v, currency),
            "Valor": lambda v: money(v, currency),
            "Peso": lambda v: percent(v, signed=False),
            "Peso-alvo": lambda v: percent(v, signed=False),
            "Variação 7d": percent,
        })
        .map(_color_by_sign, subset=["Variação 7d"])
    )
    st.dataframe(styler, hide_index=True)


def render_table(metrics: pd.DataFrame, currency: str = "BRL", planned: bool = False) -> None:
    if metrics is None or metrics.empty:
        st.info("Carteira vazia. Edite `config/portfolio.json` para adicionar posições.")
        return

    if planned:
        render_planned_table(metrics, currency)
        return

    display = metrics[list(COLUMN_LABELS)].rename(columns=COLUMN_LABELS)
    signed_columns = ["P&L", "P&L (%)", "Variação 7d"]

    styler = (
        display.style
        .format({
            "Cotas": lambda v: number(v, 0),
            "Preço Médio": lambda v: money(v, currency),
            "Preço Atual": lambda v: money(v, currency),
            "Valor Total": lambda v: money(v, currency),
            "P&L": lambda v: money(v, currency),
            "P&L (%)": percent,
            "Variação 7d": percent,
            "Peso": lambda v: percent(v, signed=False),
        })
        .map(_color_by_sign, subset=signed_columns)
    )
    st.dataframe(styler, hide_index=True)


def render_totals(metrics: pd.DataFrame, currency: str = "BRL", planned: bool = False) -> None:
    totals = portfolio_totals(metrics)
    if planned:
        col1, col2 = st.columns(2)
        col1.metric("Valor planejado", money(totals["total_value"], currency))
        col2.metric("Posições", f"{len(metrics)}")
        return

    col1, col2, col3 = st.columns(3)
    col1.metric("Valor da carteira", money(totals["total_value"], currency))
    col2.metric("Custo total", money(totals["total_cost"], currency))
    col3.metric(
        "Resultado",
        money(totals["pnl_abs"], currency),
        delta=percent(totals["pnl_pct"]) if totals["pnl_pct"] is not None else None,
    )


def render_composition(metrics: pd.DataFrame) -> None:
    valid = metrics.dropna(subset=["position_value"]) if metrics is not None else pd.DataFrame()
    if valid.empty:
        st.caption("Sem preços atuais para calcular a composição.")
        return

    figure = go.Figure(
        go.Pie(
            labels=valid["ticker"],
            values=valid["position_value"],
            hole=0.45,
            textinfo="label+percent",
            hovertemplate="%{label}: %{percent}<extra></extra>",
        )
    )
    figure.update_layout(
        title="Composição da carteira (peso %)",
        margin=dict(t=60, b=20, l=20, r=20),
        height=380,
        showlegend=True,
    )
    st.plotly_chart(figure)


def render(metrics: pd.DataFrame, currency: str = "BRL", planned: bool = False) -> None:
    if planned:
        st.info(
            "Esta é uma **carteira planejada**: os ativos foram recomendados pelo onboarding, "
            "mas nada foi comprado ainda — por isso não há P&L. Quando executar as compras, "
            "refaça o onboarding informando as cotas e o preço médio pago.",
            icon="🗺️",
        )
    render_totals(metrics, currency, planned)
    st.divider()
    render_table(metrics, currency, planned)
    st.divider()
    render_composition(metrics)
