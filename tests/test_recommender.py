"""Testes do screener e do recomendador.

O screener roda contra dados reais do yfinance (é o ponto do sistema), e as
regras de rateio e validação da resposta do LLM são testadas offline — elas são
lógica nossa, não dado de mercado.
"""

from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from investai.analysis.recommender import (
    MIN_POSITION_BRL,
    RENDA_FIXA_LABEL,
    Recommendation,
    RecommendedPosition,
    _merge_llm_positions,
    build_recommendation_context,
    distribute,
    recommend,
)
from investai.analysis.screener import (
    ACAO,
    ETF,
    FII,
    MIN_DAILY_VOLUME_BRL,
    PROFILE_CRITERIA,
    UNIVERSE,
    Asset,
    evaluate,
    screen_detailed,
    universe_for,
)
from investai.onboarding.profile import ARROJADO, CONSERVADOR, MODERADO, build_profile
from tests.test_onboarding import answers


def synthetic_prices(close: float, rows: int = 260, drift: float = 0.0,
                     volume: float = 1_000_000) -> pd.DataFrame:
    closes = np.linspace(close - drift, close, rows)
    return pd.DataFrame({
        "Date": pd.bdate_range(end="2026-10-09", periods=rows),
        "Open": closes, "High": closes * 1.01, "Low": closes * 0.99,
        "Close": closes, "Volume": np.full(rows, volume),
    })


# --- Universo ---------------------------------------------------------------
def test_universo_sem_duplicatas_e_com_classes_validas():
    tickers = [a.ticker for a in UNIVERSE]
    assert len(tickers) == len(set(tickers)), "ticker duplicado no universo"
    assert {a.asset_class for a in UNIVERSE} <= {ACAO, ETF, FII}
    for asset_class in (ACAO, ETF, FII):
        assert sum(1 for a in UNIVERSE if a.asset_class == asset_class) >= 3


def test_universe_for_respeita_as_classes_com_peso():
    conservador = universe_for({"renda_fixa": 70, "etf": 20, "fii": 10, "acao": 0})
    assert {a.asset_class for a in conservador} == {ETF, FII}
    assert universe_for({}) == []


# --- Critérios do screener (offline, dados sintéticos) ---------------------
def test_criterios_ficam_mais_permissivos_conforme_o_perfil():
    conservador = PROFILE_CRITERIA[CONSERVADOR]
    arrojado = PROFILE_CRITERIA[ARROJADO]
    assert conservador["max_volatility"] < arrojado["max_volatility"]
    assert conservador["max_pe"] < arrojado["max_pe"]
    assert conservador["reject_downtrend"] and not arrojado["reject_downtrend"]


def test_ativo_sem_preco_e_reprovado_com_motivo():
    candidate = evaluate(Asset("XXXX3.SA", "Fantasma", ACAO, "Setor"),
                         pd.DataFrame(), {}, PROFILE_CRITERIA[MODERADO])
    assert not candidate.approved
    assert "sem dados de preço" in candidate.rejections[0]


def test_liquidez_baixa_reprova():
    asset = Asset("ILIQ3.SA", "Ilíquida", ACAO, "Setor")
    prices = synthetic_prices(10.0, volume=1_000)  # 10 × 1.000 = R$ 10 mil/dia
    candidate = evaluate(asset, prices, {"pe_ratio": 8.0}, PROFILE_CRITERIA[MODERADO])
    assert not candidate.approved
    assert any("liquidez" in r for r in candidate.rejections)
    assert MIN_DAILY_VOLUME_BRL > 10_000


def test_pl_negativo_e_divida_alta_reprovam_acao():
    asset = Asset("RUIM3.SA", "Ruim", ACAO, "Setor")
    prices = synthetic_prices(50.0)
    candidate = evaluate(asset, prices, {"pe_ratio": -3.0, "debt_to_equity": 900.0},
                         PROFILE_CRITERIA[MODERADO])
    assert not candidate.approved
    assert any("P/L negativo" in r for r in candidate.rejections)
    assert any("dívida/patrimônio" in r for r in candidate.rejections)


def test_fundamentos_nao_reprovam_etf():
    """ETF não tem P/L comparável a ação — o critério não deve ser aplicado."""
    etf = evaluate(Asset("BOVA11.SA", "Ibovespa", ETF, "Índice"), synthetic_prices(130.0),
                   {"pe_ratio": -1.0}, PROFILE_CRITERIA[CONSERVADOR])
    assert etf.approved


def test_conservador_exige_dividend_yield_minimo():
    asset = Asset("SEMDY3.SA", "Sem DY", ACAO, "Setor")
    prices = synthetic_prices(30.0)
    candidate = evaluate(asset, prices, {"pe_ratio": 10.0}, PROFILE_CRITERIA[CONSERVADOR])
    assert any("dividend yield" in r for r in candidate.rejections)


def test_score_premia_multiplo_baixo_e_dividendo():
    asset = Asset("BOA3.SA", "Boa", ACAO, "Setor")
    prices = synthetic_prices(30.0, drift=5.0)
    barata = evaluate(asset, prices, {"pe_ratio": 6.0, "dividend_yield": 7.0,
                                      "debt_to_equity": 30.0}, PROFILE_CRITERIA[ARROJADO])
    cara = evaluate(asset, prices, {"pe_ratio": 40.0, "dividend_yield": 0.5,
                                    "debt_to_equity": 250.0}, PROFILE_CRITERIA[ARROJADO])
    assert barata.score > cara.score
    assert any("múltiplo baixo" in r for r in barata.reasons)


# --- Rateio -----------------------------------------------------------------
@pytest.fixture
def fake_market_data() -> dict:
    data = {}
    for asset in UNIVERSE:
        preco = 100.0 if asset.asset_class != FII else 10.0
        data[asset.ticker] = {
            "prices": synthetic_prices(preco, drift=10.0, volume=500_000),
            "fundamentals": {"pe_ratio": 9.0, "dividend_yield": 6.0, "debt_to_equity": 40.0,
                             "name": asset.name},
        }
    return data


def test_distribuicao_respeita_pesos_das_classes(fake_market_data):
    profile = build_profile(answers(emergency_fund="acima_6m", initial_amount=100_000))
    approved, _ = screen_detailed(profile.profile, fake_market_data, profile.allocation)
    positions = distribute(profile, approved)

    assert positions
    por_classe: dict[str, float] = {}
    for position in positions:
        por_classe[position.asset_class] = por_classe.get(position.asset_class, 0) + position.weight_pct
    for asset_class, target in profile.allocation.items():
        if target > 0:
            assert por_classe.get(asset_class, 0) == pytest.approx(target, abs=0.5)

    # A reserva aparece como linha de renda fixa, sem cotação.
    renda_fixa = [p for p in positions if p.asset_class == "renda_fixa"]
    assert len(renda_fixa) == 1 and renda_fixa[0].ticker == RENDA_FIXA_LABEL
    assert renda_fixa[0].price is None


def test_cotas_sao_inteiras_e_a_sobra_fica_em_caixa(fake_market_data):
    profile = build_profile(answers(emergency_fund="acima_6m", initial_amount=20_000))
    approved, _ = screen_detailed(profile.profile, fake_market_data, profile.allocation)
    positions = distribute(profile, approved)

    for position in positions:
        if position.price:
            assert position.shares == int(position.shares), "não existe fração de cota"
            assert position.shares * position.price <= position.amount + 0.01

    recommendation = Recommendation(positions=positions)
    assert recommendation.leftover >= 0


def test_pouco_dinheiro_gera_menos_posicoes_em_vez_de_posicoes_minusculas(fake_market_data):
    rico = build_profile(answers(emergency_fund="acima_6m", initial_amount=200_000))
    pobre = build_profile(answers(emergency_fund="acima_6m", initial_amount=2_000))

    approved_rico, _ = screen_detailed(rico.profile, fake_market_data, rico.allocation)
    approved_pobre, _ = screen_detailed(pobre.profile, fake_market_data, pobre.allocation)

    acoes_rico = [p for p in distribute(rico, approved_rico) if p.asset_class == ACAO]
    acoes_pobre = [p for p in distribute(pobre, approved_pobre) if p.asset_class == ACAO]

    assert len(acoes_pobre) < len(acoes_rico)
    for position in acoes_pobre:
        assert position.amount >= MIN_POSITION_BRL * 0.9


def test_diversificacao_setorial_na_escolha(fake_market_data):
    profile = build_profile(answers(knowledge="profissionalizar", experience=["acoes", "fiis"],
                                    drawdown_reaction="aporto_mais",
                                    volatility_preference="agressivo",
                                    emergency_fund="acima_6m", initial_amount=100_000))
    approved, _ = screen_detailed(profile.profile, fake_market_data, profile.allocation)
    acoes = [p for p in distribute(profile, approved) if p.asset_class == ACAO]
    setores = [p.sector for p in acoes]
    assert len(set(setores)) == len(setores), f"setor repetido: {setores}"


# --- Validação da resposta do LLM -------------------------------------------
def _positions() -> list[RecommendedPosition]:
    return [
        RecommendedPosition(RENDA_FIXA_LABEL, "Renda fixa", "renda_fixa", 40.0, 4_000, None, 1.0),
        RecommendedPosition("BOVA11.SA", "Ibovespa", ETF, 30.0, 3_000, 100.0, 30),
        RecommendedPosition("PETR4.SA", "Petrobras", ACAO, 30.0, 3_000, 50.0, 60),
    ]


ALLOCATION = {"renda_fixa": 40.0, "etf": 30.0, "acao": 30.0}


def test_merge_aplica_pesos_e_justificativas_do_llm():
    merged = _merge_llm_positions(
        _positions(),
        [{"ticker": "BOVA11.SA", "weight_pct": 30.0, "rationale": "diversificação ampla"},
         {"ticker": "PETR4.SA", "weight_pct": 30.0, "rationale": "P/L de 5,3"}],
        ALLOCATION, investable=10_000,
    )
    assert merged is not None
    bova = next(p for p in merged if p.ticker == "BOVA11.SA")
    assert bova.rationale == "diversificação ampla"
    assert bova.amount == 3_000
    assert bova.shares == 30
    # A linha de renda fixa é preservada mesmo sem o LLM mencioná-la.
    assert any(p.asset_class == "renda_fixa" for p in merged)


def test_merge_ignora_renda_fixa_devolvida_pelo_llm():
    """O rótulo tem caixa mista; não pode ser lido como ticker desconhecido."""
    merged = _merge_llm_positions(
        _positions(),
        [{"ticker": RENDA_FIXA_LABEL.upper(), "weight_pct": 40.0, "rationale": "reserva"},
         {"ticker": "BOVA11.SA", "weight_pct": 30.0, "rationale": "x"},
         {"ticker": "PETR4.SA", "weight_pct": 30.0, "rationale": "y"}],
        ALLOCATION, investable=10_000,
    )
    assert merged is not None


def test_merge_rejeita_ticker_fora_dos_candidatos():
    assert _merge_llm_positions(
        _positions(),
        [{"ticker": "MGLU3.SA", "weight_pct": 30.0, "rationale": "chute"}],
        ALLOCATION, investable=10_000,
    ) is None


def test_merge_rejeita_peso_de_classe_divergente():
    """O LLM não pode mudar a alocação definida por regra."""
    assert _merge_llm_positions(
        _positions(),
        [{"ticker": "BOVA11.SA", "weight_pct": 10.0, "rationale": "x"},
         {"ticker": "PETR4.SA", "weight_pct": 30.0, "rationale": "y"}],
        ALLOCATION, investable=10_000,
    ) is None


def test_merge_rejeita_peso_invalido():
    assert _merge_llm_positions(
        _positions(),
        [{"ticker": "BOVA11.SA", "weight_pct": "muito", "rationale": "x"}],
        ALLOCATION, investable=10_000,
    ) is None


# --- Recomendação completa --------------------------------------------------
def test_recomendacao_sem_llm_funciona_e_virou_carteira_planejada(fake_market_data):
    profile = build_profile(answers(emergency_fund="acima_6m", initial_amount=50_000))
    recommendation = recommend(profile, fake_market_data, use_llm=False)

    assert recommendation.ok
    assert recommendation.source == "quantitativo"
    portfolio = recommendation.to_portfolio()
    assert portfolio.planned
    assert all(p.is_planned for p in portfolio.positions), "nada foi comprado ainda"
    # Renda fixa não entra na lista de tickers de mercado.
    assert RENDA_FIXA_LABEL not in portfolio.tickers
    assert RENDA_FIXA_LABEL in portfolio.all_tickers


def test_sem_dados_de_mercado_sai_so_a_renda_fixa_com_aviso():
    """A reserva não depende de cotação; o resto precisa, e o usuário tem de saber."""
    profile = build_profile(answers(emergency_fund="acima_6m", initial_amount=50_000))
    recommendation = recommend(profile, {}, use_llm=False)

    assert [p.asset_class for p in recommendation.positions] == ["renda_fixa"]
    assert recommendation.error and "nenhum ativo de bolsa" in recommendation.error


def test_sem_alocacao_em_renda_fixa_e_sem_dados_nao_ha_recomendacao():
    profile = build_profile(answers(horizon="acima_10a", knowledge="profissionalizar",
                                    experience=["acoes", "fiis", "exterior"],
                                    drawdown_reaction="aporto_mais",
                                    volatility_preference="agressivo",
                                    emergency_fund="acima_6m", initial_amount=50_000))
    profile.allocation = {"acao": 100.0}   # perfil hipotético 100% ações
    recommendation = recommend(profile, {}, use_llm=False)

    assert not recommendation.ok
    assert recommendation.error and "Nenhum ativo passou" in recommendation.error


def test_contexto_do_llm_tem_perfil_alocacao_e_candidatos(fake_market_data):
    profile = build_profile(answers(emergency_fund="acima_6m", initial_amount=50_000))
    approved, _ = screen_detailed(profile.profile, fake_market_data, profile.allocation)
    context = build_recommendation_context(profile, approved, distribute(profile, approved))

    for esperado in ("PERFIL DO INVESTIDOR", "ALOCAÇÃO POR CLASSE", "CANDIDATOS APROVADOS",
                     "RATEIO PADRÃO", profile.profile):
        assert esperado in context
    assert "BOVA11.SA" in context


# --- Com dados reais --------------------------------------------------------
@pytest.mark.network
def test_screener_com_dados_reais_diferencia_perfis(require_internet):
    from investai.data import market_data

    tickers = [a.ticker for a in UNIVERSE]
    data = market_data.get_portfolio_data(tickers, period="1y")
    if not any(not p["prices"].empty for p in data.values()):
        pytest.skip("yfinance indisponível agora")

    conservador, _ = screen_detailed(CONSERVADOR, data)
    arrojado, _ = screen_detailed(ARROJADO, data)

    aprovados_cons = sum(len(v) for v in conservador.values())
    aprovados_arroj = sum(len(v) for v in arrojado.values())
    assert aprovados_cons <= aprovados_arroj, "perfil conservador não pode ser mais permissivo"

    for candidates in conservador.values():
        for candidate in candidates:
            volatility = candidate.indicators.get("volatility_30d")
            if volatility is not None:
                assert volatility <= PROFILE_CRITERIA[CONSERVADOR]["max_volatility"]
