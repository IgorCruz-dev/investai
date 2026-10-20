"""Testes do questionário, do score de perfil e da alocação-alvo.

Tudo determinístico e offline — é regra de negócio, não dado de mercado.
"""

from __future__ import annotations

import pytest

from investai.onboarding.profile import (
    ARROJADO,
    CONSERVADOR,
    EMERGENCY_MONTHS,
    MODERADO,
    PROFILES,
    build_profile,
    calculate_risk_score,
    classify,
)
from investai.onboarding.questionnaire import (
    HAS_PORTFOLIO_QUESTION,
    QUESTIONS,
    QUESTIONS_BY_KEY,
    STEPS,
    missing_answers,
    questions_for_step,
)

BASE_ANSWERS = dict(
    financial_health=7, commitment=9, priority="patrimonio", knowledge="iniciante",
    income_range="4500_10k", monthly_expenses=4_000, initial_amount=30_000,
    monthly_contribution=1_500, emergency_fund="3_6m", expensive_debt="nenhuma",
    income_stability="estavel", main_goal="aposentadoria", horizon="acima_10a",
    liquidity_need="baixa", international="sim", drawdown_reaction="nao_faco_nada",
    volatility_preference="equilibrio", experience=["poupanca"],
)


def answers(**overrides) -> dict:
    return {**BASE_ANSWERS, **overrides}


# --- Questionário -----------------------------------------------------------
def test_questionario_cobre_as_dimensoes_de_suitability():
    keys = set(QUESTIONS_BY_KEY)
    # As 5 perguntas aproveitadas do diagnóstico da AUVP…
    for key in ("financial_health", "commitment", "priority", "knowledge", "income_range"):
        assert key in keys
        assert QUESTIONS_BY_KEY[key].source == "auvp"
    # …e as dimensões que faltavam nele e definem alocação.
    for key in ("emergency_fund", "expensive_debt", "horizon", "liquidity_need",
                "drawdown_reaction", "volatility_preference", "monthly_expenses",
                "monthly_contribution", "income_stability", "main_goal"):
        assert key in keys, f"dimensão de suitability ausente: {key}"


def test_toda_pergunta_pertence_a_uma_etapa_conhecida():
    etapas = {key for key, _label in STEPS}
    for question in QUESTIONS:
        assert question.step in etapas
    assert sum(len(questions_for_step(k)) for k, _ in STEPS) == len(QUESTIONS)


def test_perguntas_de_escolha_tem_opcoes_e_valores_unicos():
    for question in (*QUESTIONS, HAS_PORTFOLIO_QUESTION):
        if question.kind in ("choice", "multi"):
            assert question.choices, f"{question.key} sem opções"
            valores = [c.value for c in question.choices]
            assert len(valores) == len(set(valores)), f"{question.key} tem valor duplicado"


def test_missing_answers_lista_apenas_obrigatorias():
    assert missing_answers(BASE_ANSWERS) == []
    faltando = missing_answers({})
    assert "horizon" in faltando
    assert "experience" not in faltando, "experiência é opcional"


# --- Score e classificação --------------------------------------------------
def test_score_cresce_com_tolerancia_a_risco():
    medroso = calculate_risk_score(answers(
        drawdown_reaction="vendo_tudo", volatility_preference="previsivel",
        horizon="ate_1a", main_goal="reserva", liquidity_need="alta"))
    equilibrado = calculate_risk_score(BASE_ANSWERS)
    agressivo = calculate_risk_score(answers(
        drawdown_reaction="aporto_mais", volatility_preference="agressivo",
        knowledge="profissionalizar", experience=["acoes", "fiis", "exterior"],
        main_goal="crescimento", emergency_fund="acima_6m"))

    assert 0 <= medroso < equilibrado < agressivo <= 100


def test_score_ignora_perguntas_sem_resposta_em_vez_de_zerar():
    """Sem isto, quem não respondeu tudo cairia em conservador por omissão."""
    parcial = calculate_risk_score({"drawdown_reaction": "aporto_mais"})
    assert parcial == 100.0
    assert calculate_risk_score({}) == 0.0


def test_lista_de_experiencia_vazia_conta_como_zero_e_nao_como_omissao():
    """"Nunca investi em nada" é resposta; chave ausente é omissão."""
    omitida = calculate_risk_score({"drawdown_reaction": "aporto_mais"})
    respondida_vazia = calculate_risk_score(
        {"drawdown_reaction": "aporto_mais", "experience": []})
    assert omitida == 100.0
    assert respondida_vazia < omitida


def test_classificacao_respeita_as_faixas():
    assert classify(10) == CONSERVADOR
    assert classify(50) == MODERADO
    assert classify(90, {"knowledge": "profissionalizar", "experience": ["acoes"]}) == ARROJADO
    assert classify(90) in PROFILES


def test_iniciante_sem_experiencia_nao_vira_arrojado():
    """Horizonte longo infla o score; tolerância a queda só se prova vivendo uma."""
    perfil = build_profile(answers(
        drawdown_reaction="aporto_mais", volatility_preference="agressivo",
        main_goal="crescimento", knowledge="iniciante", experience=["poupanca"]))

    assert perfil.risk_score > 72
    assert perfil.profile == MODERADO
    assert any("limitado a moderado" in nota for nota in perfil.notes)

    # Quem já investiu em risco não sofre o teto.
    experiente = build_profile(answers(
        drawdown_reaction="aporto_mais", volatility_preference="agressivo",
        main_goal="crescimento", knowledge="profissionalizar", experience=["acoes", "fiis"]))
    assert experiente.profile == ARROJADO


# --- Pré-requisitos ---------------------------------------------------------
def test_divida_de_juros_altos_trava_a_alocacao():
    perfil = build_profile(answers(expensive_debt="significativas"))

    assert perfil.is_blocked
    assert perfil.investable_amount == 0, "não se investe em bolsa devendo cartão"
    divida = next(p for p in perfil.prerequisites if p.key == "divida")
    assert divida.blocking


def test_reserva_de_emergencia_vem_antes_da_bolsa():
    perfil = build_profile(answers(emergency_fund="nenhuma", monthly_expenses=4_000,
                                   initial_amount=30_000))

    assert perfil.emergency_target == 4_000 * EMERGENCY_MONTHS
    assert perfil.emergency_gap == 24_000
    # Só o que sobra depois da reserva vai para risco.
    assert perfil.investable_amount == 6_000
    assert any(p.key == "reserva" for p in perfil.prerequisites)


def test_reserva_completa_nao_gera_pre_requisito():
    perfil = build_profile(answers(emergency_fund="acima_6m"))
    assert perfil.emergency_gap == 0
    assert not any(p.key == "reserva" for p in perfil.prerequisites)
    assert perfil.investable_amount == perfil.initial_amount


def test_renda_instavel_gera_aviso():
    perfil = build_profile(answers(income_stability="instavel"))
    assert any(p.key == "renda" for p in perfil.prerequisites)


# --- Alocação ---------------------------------------------------------------
@pytest.mark.parametrize("perfil_esperado,overrides", [
    (CONSERVADOR, dict(drawdown_reaction="vendo_tudo", volatility_preference="previsivel",
                       horizon="1_3a", main_goal="reserva", liquidity_need="alta")),
    (MODERADO, {}),
    (ARROJADO, dict(drawdown_reaction="aporto_mais", volatility_preference="agressivo",
                    knowledge="profissionalizar", experience=["acoes", "fiis", "exterior"],
                    main_goal="crescimento")),
])
def test_alocacao_soma_cem_e_fica_mais_arriscada_com_o_perfil(perfil_esperado, overrides):
    perfil = build_profile(answers(**overrides))
    assert perfil.profile == perfil_esperado
    assert sum(perfil.allocation.values()) == pytest.approx(100.0, abs=0.5)
    assert all(v >= 0 for v in perfil.allocation.values())


def test_horizonte_curto_forca_renda_fixa():
    perfil = build_profile(answers(horizon="ate_1a"))
    assert perfil.allocation["acao"] == 0
    assert perfil.allocation["renda_fixa"] >= 85
    assert any("abaixo de 2 anos" in nota for nota in perfil.notes)


def test_objetivo_renda_passiva_aumenta_fii():
    base = build_profile(answers(knowledge="profissionalizar", experience=["acoes"]))
    renda = build_profile(answers(knowledge="profissionalizar", experience=["acoes"],
                                  main_goal="renda_passiva"))
    assert renda.allocation["fii"] > base.allocation["fii"]


def test_alta_necessidade_de_liquidez_eleva_renda_fixa():
    perfil = build_profile(answers(knowledge="profissionalizar", experience=["acoes", "fiis"],
                                   drawdown_reaction="aporto_mais", liquidity_need="alta"))
    assert perfil.allocation["renda_fixa"] >= 50


def test_iniciante_troca_acao_individual_por_etf():
    perfil = build_profile(answers(knowledge="iniciante", experience=["acoes"],
                                   drawdown_reaction="aporto_mais",
                                   volatility_preference="agressivo"))
    assert perfil.allocation["acao"] <= 20
    assert any("ETF amplo" in nota for nota in perfil.notes)


def test_perfil_serializa_para_json():
    perfil = build_profile(BASE_ANSWERS)
    data = perfil.to_dict()
    for key in ("answers", "risk_score", "profile", "allocation", "prerequisites",
                "investable_amount", "emergency_gap"):
        assert key in data
    import json
    assert json.loads(json.dumps(data))["profile"] == perfil.profile
