"""Testes de `investai.analysis.quantitative` — matemática, sem rede."""

from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from investai.analysis.quantitative import (
    INDICATOR_FIELDS,
    TREND_SIGNALS,
    calculate_indicators,
    calculate_portfolio_metrics,
    calculate_rsi,
    portfolio_totals,
    rsi_series,
)
from investai.config import Portfolio, Position

# Série de referência de Wilder (o mesmo exemplo usado para validar ta-lib).
WILDER_CLOSES = [
    44.34, 44.09, 44.15, 43.61, 44.33, 44.83, 45.10, 45.42, 45.84, 46.08,
    45.89, 46.03, 45.61, 46.28, 46.28, 46.00, 46.03, 46.41, 46.22, 45.64,
]


def synthetic_prices(closes: list[float], start: str = "2024-01-01") -> pd.DataFrame:
    dates = pd.bdate_range(start=start, periods=len(closes))
    closes_series = pd.Series(closes, dtype="float64")
    return pd.DataFrame({
        "Date": dates,
        "Open": closes_series * 0.99,
        "High": closes_series * 1.01,
        "Low": closes_series * 0.98,
        "Close": closes_series,
        "Volume": np.full(len(closes), 1_000_000, dtype="int64"),
    })


# --- RSI --------------------------------------------------------------------
def test_rsi_bate_com_a_serie_de_referencia_de_wilder():
    # Valores publicados para esta série: 70,46 no 15º fechamento e 57,92 no 20º.
    assert calculate_rsi(WILDER_CLOSES[:15]) == pytest.approx(70.46, abs=0.05)
    assert calculate_rsi(WILDER_CLOSES) == pytest.approx(57.92, abs=0.05)


def test_rsi_extremos():
    assert calculate_rsi(list(range(1, 40))) == 100.0      # só ganhos
    assert calculate_rsi(list(range(40, 1, -1))) == 0.0     # só perdas
    assert calculate_rsi([10.0] * 30) == 50.0               # sem variação


def test_rsi_devolve_none_com_dados_insuficientes():
    assert calculate_rsi([1, 2, 3]) is None
    assert calculate_rsi(list(range(14)), period=14) is None   # precisa de 15
    assert calculate_rsi([]) is None


def test_rsi_sempre_entre_zero_e_cem():
    rng = np.random.default_rng(42)
    closes = 100 + np.cumsum(rng.normal(0, 2, 500))
    series = rsi_series(closes)
    assert not series.empty
    assert series.between(0, 100).all()


def test_rsi_series_indice_alinha_com_os_fechamentos():
    series = rsi_series(WILDER_CLOSES, period=14)
    # Primeiro RSI disponível é o do 15º fechamento (índice 14).
    assert series.index[0] == 14
    assert series.index[-1] == len(WILDER_CLOSES) - 1


# --- Indicadores ------------------------------------------------------------
def test_calculate_indicators_com_250_linhas_preenche_tudo():
    rng = np.random.default_rng(7)
    closes = list(100 + np.cumsum(rng.normal(0.05, 1.0, 250)))
    indicators = calculate_indicators(synthetic_prices(closes))

    assert set(indicators) == set(INDICATOR_FIELDS)
    for field in INDICATOR_FIELDS:
        assert indicators[field] is not None, f"{field} deveria ser calculável com 250 linhas"
    assert 0 <= indicators["rsi_14"] <= 100
    assert indicators["volatility_30d"] > 0
    assert indicators["volume_avg_30d"] == pytest.approx(1_000_000)
    assert indicators["price_current"] == pytest.approx(closes[-1], abs=1e-4)


def test_calculate_indicators_com_dados_curtos_devolve_none_sem_estourar():
    indicators = calculate_indicators(synthetic_prices([100.0 + i for i in range(30)]))

    assert set(indicators) == set(INDICATOR_FIELDS)
    assert indicators["ma_20"] is not None       # cabe em 30 linhas
    assert indicators["ma_50"] is None           # não cabe
    assert indicators["ma_200"] is None
    assert indicators["price_change_1y"] is None  # sem histórico suficiente
    assert indicators["trend_signal"] == "NEUTRO"


def test_calculate_indicators_tolera_entradas_degeneradas():
    for entrada in (None, pd.DataFrame(), pd.DataFrame({"Close": []}), pd.DataFrame({"X": [1]})):
        indicators = calculate_indicators(entrada)
        assert set(indicators) == set(INDICATOR_FIELDS)
        assert indicators["price_current"] is None
        assert indicators["trend_signal"] == "NEUTRO"


def test_trend_signal_so_assume_tres_valores():
    rng = np.random.default_rng(0)
    cenarios = {
        "alta": list(np.linspace(50, 150, 260)),
        "baixa": list(np.linspace(150, 50, 260)),
        "lateral": list(100 + rng.normal(0, 1, 260)),
        "curto": [100.0, 101.0, 102.0],
    }
    for nome, closes in cenarios.items():
        signal = calculate_indicators(synthetic_prices(closes))["trend_signal"]
        assert signal in TREND_SIGNALS, f"{nome} devolveu {signal!r}"

    assert calculate_indicators(synthetic_prices(cenarios["alta"]))["trend_signal"] == "ALTA"
    assert calculate_indicators(synthetic_prices(cenarios["baixa"]))["trend_signal"] == "BAIXA"


def test_variacoes_percentuais_usam_dias_corridos():
    # 300 dias úteis de alta linear cobrem ~419 dias corridos, então todas as
    # janelas existem e crescem com o prazo.
    closes = list(np.linspace(100, 200, 300))
    indicators = calculate_indicators(synthetic_prices(closes))

    assert 0 < indicators["price_change_7d"] < indicators["price_change_30d"]
    assert indicators["price_change_30d"] < indicators["price_change_90d"]
    assert indicators["price_change_90d"] < indicators["price_change_1y"]

    # A janela é de dias CORRIDOS: 365 dias antes do fim, o preço da rampa estava
    # em ~112,8, o que dá ~77% — e não os 100% do intervalo inteiro da série.
    assert indicators["price_change_1y"] == pytest.approx(77.4, abs=1.0)


def test_variacao_longa_aceita_serie_que_cobre_quase_toda_a_janela():
    # `period="1y"` costuma devolver ~365 dias corridos: a variação de 1 ano usa
    # o ponto mais antigo quando a série cobre ao menos 90% da janela.
    dates = pd.bdate_range(end="2026-10-09", periods=250)
    frame = pd.DataFrame({
        "Date": dates,
        "Open": 100.0, "High": 100.0, "Low": 100.0,
        "Close": np.linspace(100, 150, 250),
        "Volume": 1_000,
    })
    assert calculate_indicators(frame)["price_change_1y"] == pytest.approx(50.0, abs=5.0)


def test_variacao_longa_devolve_none_quando_a_serie_e_curta_demais():
    frame = synthetic_prices(list(np.linspace(100, 110, 40)))
    assert calculate_indicators(frame)["price_change_1y"] is None


# --- Carteira ---------------------------------------------------------------
@pytest.fixture
def carteira() -> Portfolio:
    return Portfolio(
        positions=(
            Position("AAA", 100, 10.0),
            Position("BBB", 50, 20.0),
            Position("CCC", 10, 5.0),   # sem dados de mercado
        ),
        currency="BRL",
    )


@pytest.fixture
def market_data_fake() -> dict:
    return {
        "AAA": {"prices": synthetic_prices([10.0] * 10 + [12.0]), "fundamentals": {}},
        "BBB": {"prices": synthetic_prices([20.0] * 10 + [18.0]), "fundamentals": {}},
        "CCC": {"prices": pd.DataFrame(columns=["Date", "Close"]), "fundamentals": {}},
    }


def test_calculate_portfolio_metrics_pnl_e_pesos(carteira, market_data_fake):
    metrics = calculate_portfolio_metrics(carteira, market_data_fake)

    assert list(metrics["ticker"]) == ["AAA", "BBB", "CCC"]

    aaa = metrics.set_index("ticker").loc["AAA"]
    assert aaa["position_value"] == pytest.approx(1200.0)   # 100 × 12
    assert aaa["pnl_abs"] == pytest.approx(200.0)           # 1200 − 1000
    assert aaa["pnl_pct"] == pytest.approx(20.0)

    bbb = metrics.set_index("ticker").loc["BBB"]
    assert bbb["pnl_abs"] == pytest.approx(-100.0)          # 900 − 1000
    assert bbb["pnl_pct"] == pytest.approx(-10.0)

    # Posição sem preço vira NaN (exibida como N/D), sem contaminar os pesos.
    ccc = metrics.set_index("ticker").loc["CCC"]
    assert pd.isna(ccc["current_price"]) and pd.isna(ccc["pnl_abs"])
    assert metrics["weight_pct"].sum(skipna=True) == pytest.approx(100.0)


def test_portfolio_totals(carteira, market_data_fake):
    totals = portfolio_totals(calculate_portfolio_metrics(carteira, market_data_fake))
    assert totals["total_value"] == pytest.approx(2100.0)    # 1200 + 900
    assert totals["total_cost"] == pytest.approx(2050.0)     # 1000 + 1000 + 50
    assert totals["pnl_abs"] == pytest.approx(50.0)
    assert totals["pnl_pct"] == pytest.approx(50 / 2050 * 100)


def test_calculate_portfolio_metrics_carteira_vazia():
    metrics = calculate_portfolio_metrics(Portfolio(), {})
    assert metrics.empty
    assert portfolio_totals(metrics)["total_value"] is None
