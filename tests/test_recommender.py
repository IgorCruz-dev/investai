"""Testes do screener e do recomendador.

O screener roda contra dados reais do yfinance (é o ponto do sistema), e as
regras de rateio e do veto por notícia são testadas offline — elas são lógica
nossa, não dado de mercado.
"""

from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from investai.analysis.recommender import (
    MIN_POSITION_BRL,
    RENDA_FIXA_LABEL,
    Recommendation,
    _aplicar_vetos,
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
    Candidate,
    evaluate,
    screen_detailed,
    universe_for,
)
from investai.analysis.triagem_noticia import Veto, _validar, triar
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


# --- Recomendação completa --------------------------------------------------
def test_recomendacao_determinista_virou_carteira_planejada(fake_market_data):
    profile = build_profile(answers(emergency_fund="acima_6m", initial_amount=50_000))
    recommendation = recommend(profile, fake_market_data)

    assert recommendation.ok
    assert not recommendation.triagem_ok, "triagem não foi pedida"
    portfolio = recommendation.to_portfolio()
    assert portfolio.planned
    assert all(p.is_planned for p in portfolio.positions), "nada foi comprado ainda"
    # Renda fixa não entra na lista de tickers de mercado.
    assert RENDA_FIXA_LABEL not in portfolio.tickers
    assert RENDA_FIXA_LABEL in portfolio.all_tickers


def test_sem_dados_de_mercado_sai_so_a_renda_fixa_com_aviso():
    """A reserva não depende de cotação; o resto precisa, e o usuário tem de saber."""
    profile = build_profile(answers(emergency_fund="acima_6m", initial_amount=50_000))
    recommendation = recommend(profile, {})

    assert [p.asset_class for p in recommendation.positions] == ["renda_fixa"]
    assert recommendation.error and "nenhum ativo de bolsa" in recommendation.error


def test_sem_alocacao_em_renda_fixa_e_sem_dados_nao_ha_recomendacao():
    profile = build_profile(answers(horizon="acima_10a", knowledge="profissionalizar",
                                    experience=["acoes", "fiis", "exterior"],
                                    drawdown_reaction="aporto_mais",
                                    volatility_preference="agressivo",
                                    emergency_fund="acima_6m", initial_amount=50_000))
    profile.allocation = {"acao": 100.0}   # perfil hipotético 100% ações
    recommendation = recommend(profile, {})

    assert not recommendation.ok
    assert recommendation.error and "Nenhum ativo passou" in recommendation.error


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


# --- Precisão do rateio (spec 003) ------------------------------------------
# A fixture `fake_market_data` usa preços redondos (100,00 e 10,00), em que
# `piso(valor / preço)` quase nunca deixa troco — então ela não exercita a
# sobra. Estes testes usam preço que não divide exato, que é onde a promessa de
# "soma exatamente o valor disponível" é de verdade testada.
@pytest.fixture
def market_data_preco_quebrado() -> dict:
    quebrados = (137.43, 89.17, 211.09, 43.71, 23.57)
    data = {}
    for i, asset in enumerate(UNIVERSE):
        data[asset.ticker] = {
            "prices": synthetic_prices(quebrados[i % len(quebrados)], drift=10.0,
                                       volume=500_000),
            "fundamentals": {"pe_ratio": 9.0, "dividend_yield": 6.0,
                             "debt_to_equity": 40.0, "name": asset.name},
        }
    return data


def test_soma_das_posicoes_e_exatamente_o_valor_disponivel(market_data_preco_quebrado):
    profile = build_profile(answers(emergency_fund="acima_6m", initial_amount=37_777))
    approved, _ = screen_detailed(profile.profile, market_data_preco_quebrado,
                                  profile.allocation)
    positions = distribute(profile, approved)

    assert positions
    total = round(sum(p.amount for p in positions), 2)
    assert total == pytest.approx(profile.investable_amount, abs=0.01), (
        "a carteira recomendada tem que somar o valor disponível, até o centavo"
    )


def test_sobra_do_arredondamento_entra_na_renda_fixa_e_e_declarada(market_data_preco_quebrado):
    profile = build_profile(answers(emergency_fund="acima_6m", initial_amount=37_777))
    approved, _ = screen_detailed(profile.profile, market_data_preco_quebrado,
                                  profile.allocation)
    positions = distribute(profile, approved)

    renda_fixa = next(p for p in positions if p.asset_class == "renda_fixa")
    alvo = profile.investable_amount * profile.allocation["renda_fixa"] / 100
    assert renda_fixa.amount > alvo, "a sobra do arredondamento tinha que estar aqui"
    assert "sobra" in renda_fixa.rationale.lower(), "a sobra precisa ser declarada"

    # E nada ficou pendurado como caixa solta.
    assert Recommendation(positions=positions).leftover == 0


def test_peso_dentro_da_classe_segue_a_nota():
    from investai.analysis.recommender import _pesos_por_nota
    from investai.analysis.screener import Candidate

    def candidato(score: float) -> Candidate:
        c = Candidate(asset=Asset("X.SA", "X", ACAO, "Setor"), indicators={}, fundamentals={})
        c.score = score
        return c

    pesos = _pesos_por_nota([candidato(90.0), candidato(60.0), candidato(30.0)], 60.0)

    assert sum(pesos) == pytest.approx(60.0), "os pesos têm que somar o peso da classe"
    assert pesos[0] > pesos[1] > pesos[2], "nota maior, peso maior"


def test_trava_impede_peso_dramatico_entre_notas_extremas():
    from investai.analysis.recommender import (
        PESO_MAX_FATOR,
        PESO_MIN_FATOR,
        _pesos_por_nota,
    )
    from investai.analysis.screener import Candidate

    def candidato(score: float) -> Candidate:
        c = Candidate(asset=Asset("X.SA", "X", ACAO, "Setor"), indicators={}, fundamentals={})
        c.score = score
        return c

    # Proporcionalidade pura daria 99x1: uma posição 99 vezes maior que a outra,
    # a partir de uma nota que não tem essa precisão.
    pesos = _pesos_por_nota([candidato(99.0), candidato(1.0)], 60.0)

    assert sum(pesos) == pytest.approx(60.0)
    assert max(pesos) / min(pesos) <= PESO_MAX_FATOR / PESO_MIN_FATOR + 0.01


# --- Regra de custo ---------------------------------------------------------
def test_recomendacao_nao_chama_a_anthropic_por_padrao(fake_market_data, monkeypatch):
    """A regra de custo: montar a carteira é de graça, sempre.

    O padrão já foi `use_llm=True`, com um modelo repesando a carteira e nada
    pegando isso. Hoje o único caminho pago é a triagem de notícia, e ela só
    roda com `triagem=True` — que o job da VM liga e mais ninguém.
    """
    import inspect

    assert inspect.signature(recommend).parameters["triagem"].default is False, (
        "o padrão de triagem tem que ser False — ver spec 003"
    )

    def _nao_chamar(*a, **k):
        pytest.fail("recomendação não pode chamar a API da Anthropic (regra de custo)")

    monkeypatch.setattr("investai.analysis.triagem_noticia.consultar_modelo", _nao_chamar)

    profile = build_profile(answers(emergency_fund="acima_6m", initial_amount=50_000))
    recommendation = recommend(profile, fake_market_data)

    assert recommendation.ok
    assert not recommendation.triagem_ok, "triagem não foi pedida"
    assert recommendation.triagem_motivo == "triagem de notícia não solicitada"


def test_classe_sem_candidato_nao_vira_renda_fixa_e_e_declarada(fake_market_data):
    """Fechar a conta realocando a classe vazia seria carteira de consolação.

    O conserto fácil para a soma fechar é mandar os 30% de ação para a liquidez
    quando nenhuma ação é aprovada. Isso entrega uma carteira que ninguém pediu
    com a cara de decisão deliberada, então a regra é: declarar o buraco.
    """
    profile = build_profile(answers(emergency_fund="acima_6m", initial_amount=50_000))
    fiis = {a.ticker for a in UNIVERSE if a.asset_class == FII}
    parcial = {t: d for t, d in fake_market_data.items() if t in fiis}

    recommendation = recommend(profile, parcial)

    assert recommendation.ok, "o que deu para alocar continua valendo"
    assert not any(p.asset_class == ACAO for p in recommendation.positions)

    renda_fixa = next(p for p in recommendation.positions
                      if p.asset_class == "renda_fixa")
    alvo = profile.investable_amount * profile.allocation["renda_fixa"] / 100
    # Recebe a sobra do arredondamento dos FIIs, mas não os 30% da ação.
    assert renda_fixa.amount < alvo + profile.investable_amount * 0.05

    assert recommendation.error and "sem alocação" in recommendation.error


# --- O veto por notícia (spec 003, revisão de 27/10/2026) -------------------
#
# Cada teste aqui fixa um limite escrito na spec. O veto é a única porta por
# onde um modelo toca a recomendação, e é por isso que ela tem tranca testada.
def _candidato(ticker: str, classe: str, nota: float, setor: str = "Diversos") -> Candidate:
    return Candidate(asset=Asset(ticker, ticker.removesuffix(".SA"), classe, setor),
                     indicators={"price_current": 10.0}, fundamentals={}, score=nota)


def _veto(ticker: str, criterio: str = "fraude", frase: str = "indício de fraude contábil") -> Veto:
    return Veto(ticker=ticker, criterio=criterio, frase=frase, fonte="Valor")


def test_veto_derruba_o_candidato_de_nota_maior_da_classe():
    """Vetar o que não seria escolhido não protege ninguém."""
    by_class = {ACAO: [_candidato("AAAA3.SA", ACAO, 80), _candidato("BBBB3.SA", ACAO, 70)]}
    filtrado, aplicados, descartados = _aplicar_vetos(
        by_class, {"AAAA3.SA": _veto("AAAA3.SA")}
    )

    assert [c.asset.ticker for c in filtrado[ACAO]] == ["BBBB3.SA"]
    assert [v.ticker for v in aplicados] == ["AAAA3.SA"]
    assert descartados == []


def test_veto_tem_teto_de_um_ativo_por_classe():
    """Sem teto, um dia de manchete ruim derrubaria a carteira inteira."""
    by_class = {ACAO: [_candidato("AAAA3.SA", ACAO, 80),
                       _candidato("BBBB3.SA", ACAO, 70),
                       _candidato("CCCC3.SA", ACAO, 60)]}
    filtrado, aplicados, descartados = _aplicar_vetos(
        by_class, {"AAAA3.SA": _veto("AAAA3.SA"), "BBBB3.SA": _veto("BBBB3.SA")}
    )

    assert len(aplicados) == 1 and aplicados[0].ticker == "AAAA3.SA"
    assert [v.ticker for v in descartados] == ["BBBB3.SA"]
    assert [c.asset.ticker for c in filtrado[ACAO]] == ["BBBB3.SA", "CCCC3.SA"]


def test_veto_que_esvaziaria_a_classe_e_descartado():
    """Classe vazia não é realocada, então o veto não pode criar esse buraco."""
    by_class = {FII: [_candidato("HGLG11.SA", FII, 75)]}
    filtrado, aplicados, descartados = _aplicar_vetos(
        by_class, {"HGLG11.SA": _veto("HGLG11.SA")}
    )

    assert aplicados == []
    assert [v.ticker for v in descartados] == ["HGLG11.SA"]
    assert [c.asset.ticker for c in filtrado[FII]] == ["HGLG11.SA"], "o ativo fica"


def test_veto_conta_o_teto_por_classe_e_nao_no_total():
    by_class = {ACAO: [_candidato("AAAA3.SA", ACAO, 80), _candidato("BBBB3.SA", ACAO, 70)],
                FII: [_candidato("HGLG11.SA", FII, 75), _candidato("KNRI11.SA", FII, 65)]}
    _, aplicados, _ = _aplicar_vetos(
        by_class, {"AAAA3.SA": _veto("AAAA3.SA"), "HGLG11.SA": _veto("HGLG11.SA")}
    )

    assert sorted(v.ticker for v in aplicados) == ["AAAA3.SA", "HGLG11.SA"]


def test_criterio_fora_da_lista_e_descartado_em_codigo():
    """A lista de critérios é código, não prompt."""
    permitidos = {"AAAA3.SA": "AAAA3.SA"}
    assert _validar({"ticker": "AAAA3.SA", "criterio": "queda_de_lucro",
                     "frase": "lucro caiu 30%"}, permitidos) is None
    assert _validar({"ticker": "AAAA3.SA", "criterio": "fraude",
                     "frase": "CVM aponta fraude"}, permitidos) is not None


def test_veto_de_ticker_fora_dos_candidatos_e_descartado():
    assert _validar({"ticker": "MGLU3.SA", "criterio": "fraude", "frase": "x"},
                    {"AAAA3.SA": "AAAA3.SA"}) is None


def test_veto_sem_frase_e_descartado():
    """Veto sem a frase não é explicável, e a spec exige que ele seja."""
    assert _validar({"ticker": "AAAA3.SA", "criterio": "fraude", "frase": "  "},
                    {"AAAA3.SA": "AAAA3.SA"}) is None


def test_sem_candidato_ou_sem_chave_nao_ha_triagem_nem_chamada(monkeypatch):
    monkeypatch.setattr("investai.analysis.triagem_noticia.consultar_modelo",
                        lambda *a, **k: pytest.fail("não deveria consultar o modelo"))

    assert triar([]).ok is False
    monkeypatch.setattr("investai.analysis.triagem_noticia.anthropic_key", lambda: None)
    assert triar([_candidato("AAAA3.SA", ACAO, 80)]).ok is False


def test_sem_noticia_a_triagem_nao_paga(monkeypatch):
    """Sem matéria-prima não se chama o modelo — e isso é dinheiro."""
    monkeypatch.setattr("investai.analysis.triagem_noticia.anthropic_key", lambda: "chave-de-teste")
    monkeypatch.setattr("investai.analysis.triagem_noticia.fetch_financial_news",
                        lambda *a, **k: {"AAAA3.SA": []})
    monkeypatch.setattr("investai.analysis.triagem_noticia.consultar_modelo",
                        lambda *a, **k: pytest.fail("não deveria consultar o modelo"))

    resultado = triar([_candidato("AAAA3.SA", ACAO, 80)])
    assert resultado.ok is False
    assert resultado.vetos == {}
    assert "nenhuma notícia" in resultado.motivo


def test_falha_da_triagem_nao_derruba_a_recomendacao(fake_market_data, monkeypatch):
    """Degradação honesta: a carteira sai igual, marcada sem triagem."""
    monkeypatch.setattr("investai.analysis.triagem_noticia.anthropic_key", lambda: "chave-de-teste")
    monkeypatch.setattr("investai.analysis.triagem_noticia.fetch_financial_news",
                        lambda *a, **k: {t: [{"title": "algo"}] for t in a[0]})

    def _explode(*a, **k):
        raise RuntimeError("API fora")

    monkeypatch.setattr("investai.analysis.triagem_noticia.consultar_modelo", _explode)
    monkeypatch.setattr("investai.analysis.triagem_noticia.cache.get", lambda *a, **k: None)
    monkeypatch.setattr("investai.analysis.triagem_noticia.cache.set", lambda *a, **k: None)

    profile = build_profile(answers(emergency_fund="acima_6m", initial_amount=50_000))
    sem_triagem = recommend(profile, fake_market_data)
    com_falha = recommend(profile, fake_market_data, triagem=True)

    assert com_falha.ok
    assert com_falha.triagem_ok is False
    assert "API fora" in com_falha.triagem_motivo
    assert [p.ticker for p in com_falha.positions] == [p.ticker for p in sem_triagem.positions]


def test_veto_aplicado_aparece_nos_rejeitados_com_a_origem(fake_market_data, monkeypatch):
    monkeypatch.setattr("investai.analysis.triagem_noticia.anthropic_key", lambda: "chave-de-teste")
    monkeypatch.setattr("investai.analysis.triagem_noticia.fetch_financial_news",
                        lambda *a, **k: {t: [{"title": "CVM investiga"}] for t in a[0]})
    monkeypatch.setattr("investai.analysis.triagem_noticia.cache.get", lambda *a, **k: None)
    monkeypatch.setattr("investai.analysis.triagem_noticia.cache.set", lambda *a, **k: None)

    profile = build_profile(answers(emergency_fund="acima_6m", initial_amount=50_000))
    base = recommend(profile, fake_market_data)
    alvo = next(p.ticker for p in base.positions if p.asset_class == ACAO)

    monkeypatch.setattr(
        "investai.analysis.triagem_noticia.consultar_modelo",
        lambda *a, **k: [{"ticker": alvo, "criterio": "fraude",
                          "frase": "CVM aponta fraude contábil", "fonte": "Valor"}],
    )

    com_veto = recommend(profile, fake_market_data, triagem=True)

    assert com_veto.triagem_ok is True
    assert [v.ticker for v in com_veto.vetos] == [alvo]
    assert alvo not in [p.ticker for p in com_veto.positions]
    marcados = [linha for linhas in com_veto.rejected.values() for linha in linhas
                if linha.startswith("[notícia]")]
    assert any(alvo in linha and "fraude" in linha for linha in marcados)


def test_soma_fecha_no_centavo_com_notas_e_precos_irregulares():
    """O caso que a fixture de preço quebrado não pegava.

    Quando todos os ativos têm o mesmo fundamento, `_pesos_por_nota` devolve
    pesos iguais e o arredondamento de cada `amount` se cancela. Com nota e
    preço diferentes por ativo — o que o mercado real sempre dá — os pesos
    viram frações irregulares, e somar a diferença posição por posição deixava
    a carteira passar alguns centavos do disponível. Foi o que aconteceu na
    primeira execução real: R$ 24.000,02 para R$ 24.000,00 de disponível.
    """
    dados = {}
    precos = (137.43, 89.17, 211.09, 43.71, 23.57, 61.03, 9.87)
    for i, asset in enumerate(UNIVERSE):
        dados[asset.ticker] = {
            "prices": synthetic_prices(precos[i % len(precos)], drift=10.0, volume=900_000),
            "fundamentals": {
                # Fundamento diferente por ativo: é o que faz as notas, e os
                # pesos, saírem irregulares.
                "pe_ratio": 5.0 + (i % 11) * 0.9,
                "dividend_yield": 4.0 + (i % 7) * 0.8,
                "debt_to_equity": 20.0 + (i % 5) * 12.0,
                "name": asset.name,
            },
        }

    for disponivel in (24_000, 37_777, 13_333.33, 9_111.07):
        profile = build_profile(answers(emergency_fund="acima_6m", initial_amount=disponivel))
        aprovados, _ = screen_detailed(profile.profile, dados, profile.allocation)
        posicoes = distribute(profile, aprovados)

        assert posicoes, f"nada recomendado para {disponivel}"
        classes_com_peso = {c for c, p in profile.allocation.items() if p > 0}
        classes_preenchidas = {p.asset_class for p in posicoes}
        if classes_com_peso - classes_preenchidas:
            continue  # classe vazia não é realocada: a soma não fecha de propósito

        total = round(sum(p.amount for p in posicoes), 2)
        assert total == round(profile.investable_amount, 2), (
            f"com {disponivel} disponível a carteira somou {total}"
        )


# --- Sem valor a alocar -----------------------------------------------------
def test_sem_valor_a_investir_a_mensagem_aponta_o_prerequisito(fake_market_data, monkeypatch):
    """O caso real que apareceu na primeira resposta de verdade do questionário.

    Quem tem a reserva incompleta tem `investable_amount` zero: o dinheiro de
    hoje vai para a reserva antes de ir para risco, e isso é a regra certa. O
    que estava errado era a mensagem — a carteira saía vazia dizendo "nenhum
    ativo passou pelos critérios do seu perfil, revise o questionário", que
    culpa o filtro de mercado e dá mau conselho. Pela spec 002, nesse estado o
    pré-requisito É a recomendação.
    """
    monkeypatch.setattr("investai.analysis.triagem_noticia.consultar_modelo",
                        lambda *a, **k: pytest.fail("não há o que triar sem valor a alocar"))

    # Reserva de 6 meses incompleta e pouco dinheiro: sobra zero para risco.
    profile = build_profile(answers(monthly_expenses=1_300, emergency_fund="3_6m",
                                    initial_amount=1_000, monthly_contribution=1_000))
    assert profile.investable_amount == 0, "a fixture precisa representar o caso"

    rec = recommend(profile, fake_market_data, triagem=True)

    assert rec.positions == [], "não há carteira a montar"
    assert rec.error
    assert "não há valor para alocar em risco" in rec.error
    assert "reserva" in rec.error
    for proibido in ("Nenhum ativo passou", "revise o questionário", "atualizar os dados"):
        assert proibido not in rec.error, f"a mensagem voltou a culpar o filtro: {proibido!r}"
    # A alocação-alvo continua vindo: a mensagem aponta para ela.
    assert rec.allocation == profile.allocation


def test_nota_do_aporte_nao_perde_a_pontuacao():
    """`.replace(",", ".")` para o separador de milhar comia a vírgula da frase.

    A nota saía como "Com aportes de R$ 1.000 por mês. a reserva fica completa",
    com um ponto no meio da frase.
    """
    profile = build_profile(answers(monthly_expenses=1_300, emergency_fund="3_6m",
                                    initial_amount=1_000, monthly_contribution=1_000))
    nota = next(n for n in profile.notes if "aportes" in n)

    assert "por mês, a reserva" in nota
    assert "por mês. a reserva" not in nota
    assert "R$ 1.000 " in nota, f"separador de milhar errado: {nota}"
