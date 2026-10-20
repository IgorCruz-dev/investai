"""Testes de `investai.analysis.llm_analyst`.

A construção do prompt é testada offline (é função pura). A chamada real à
Claude API é um teste `network`+`paid`, desativado por padrão: gastaria
créditos a cada execução da suíte.
"""

from __future__ import annotations

from datetime import datetime

import pandas as pd
import pytest

from investai.analysis.llm_analyst import (
    CONTEXT_TOKEN_BUDGET,
    REQUIRED_CONTEXT_FIELDS,
    SYSTEM_PROMPT,
    USER_INSTRUCTION,
    build_briefing_context,
    estimate_tokens,
    generate_briefing,
)

CURRENCY = "BRL"


@pytest.fixture
def metrics() -> pd.DataFrame:
    return pd.DataFrame([
        {"ticker": "PETR4.SA", "shares": 100, "avg_price": 35.50, "current_price": 40.00,
         "cost_basis": 3550.0, "position_value": 4000.0, "pnl_abs": 450.0, "pnl_pct": 12.68,
         "weight_pct": 55.0, "change_7d": 1.5},
        {"ticker": "VALE3.SA", "shares": 50, "avg_price": 68.00, "current_price": 65.00,
         "cost_basis": 3400.0, "position_value": 3250.0, "pnl_abs": -150.0, "pnl_pct": -4.41,
         "weight_pct": 45.0, "change_7d": -2.1},
    ])


@pytest.fixture
def indicators() -> dict:
    return {
        "PETR4.SA": {"price_current": 40.0, "price_change_7d": 1.5, "price_change_30d": 3.2,
                     "price_change_90d": 8.0, "price_change_1y": 15.0, "ma_20": 39.0,
                     "ma_50": 38.0, "ma_200": 35.0, "rsi_14": 58.3,
                     "volume_avg_30d": 45_000_000, "volatility_30d": 28.4, "trend_signal": "ALTA"},
        "VALE3.SA": {"price_current": 65.0, "price_change_7d": -2.1, "price_change_30d": -5.0,
                     "price_change_90d": -1.0, "price_change_1y": None, "ma_20": 66.0,
                     "ma_50": 67.0, "ma_200": 70.0, "rsi_14": 28.9,
                     "volume_avg_30d": 30_000_000, "volatility_30d": 31.0, "trend_signal": "BAIXA"},
    }


@pytest.fixture
def fundamentals() -> dict:
    return {
        "PETR4.SA": {"name": "Petrobras", "pe_ratio": 5.34, "eps": 10.49,
                     "revenue": 548_493_000_704, "net_income": 133_376_000_000,
                     "debt_to_equity": 76.07, "market_cap": 765_155_213_312,
                     "dividend_yield": 6.54, "currency": "BRL"},
        # Fundamentals esparsos: a maioria dos campos ausente.
        "VALE3.SA": {"name": "Vale", "pe_ratio": None, "eps": None, "revenue": None,
                     "net_income": None, "debt_to_equity": None, "market_cap": 200_000_000_000,
                     "dividend_yield": None, "currency": "BRL"},
    }


@pytest.fixture
def news() -> dict:
    return {
        "PETR4.SA": [
            {"title": f"Petrobras anuncia resultado {i}", "description": "Descrição da notícia.",
             "url": f"https://exemplo.com/{i}", "published": "2026-10-10 12:00:00 +0000"}
            for i in range(5)
        ],
        "VALE3.SA": [],
    }


# --- Construção do contexto -------------------------------------------------
def test_contexto_tem_todos_os_campos_obrigatorios(metrics, indicators, news, fundamentals):
    context = build_briefing_context(metrics, indicators, news, fundamentals, currency=CURRENCY)

    for field in REQUIRED_CONTEXT_FIELDS:
        assert field in context, f"seção obrigatória ausente: {field}"


def test_contexto_inclui_dados_de_cada_ativo(metrics, indicators, news, fundamentals):
    context = build_briefing_context(metrics, indicators, news, fundamentals, currency=CURRENCY)

    for ticker in ("PETR4.SA", "VALE3.SA"):
        assert ticker in context

    # Carteira: cotas, preço médio e P&L.
    assert "100" in context and "35,50" in context and "12,68%" in context
    # Indicadores: RSI, médias e tendência.
    assert "RSI14 58,30" in context and "tendência ALTA" in context
    # Fundamentals disponíveis entram; os ausentes não viram linha vazia.
    assert "P/L 5,34" in context
    assert "Dividend yield 6,54%" in context
    # Notícia real aparece no contexto.
    assert "Petrobras anuncia resultado 0" in context
    # Data de referência presente.
    assert datetime.now().strftime("%d/%m/%Y") in context


def test_contexto_omite_campos_indisponiveis_em_vez_de_inventar(metrics, indicators, news, fundamentals):
    context = build_briefing_context(metrics, indicators, news, fundamentals, currency=CURRENCY)
    vale_line = next(line for line in context.splitlines() if line.startswith("- VALE3.SA (Vale)"))

    assert "Valor de mercado" in vale_line
    assert "P/L" not in vale_line, "campo indisponível não deveria aparecer"
    # Indicador ausente aparece explicitamente como N/D, nunca como número.
    assert "1a N/D" in context


def test_contexto_respeita_o_orcamento_de_tokens(metrics, indicators, news, fundamentals):
    context = build_briefing_context(metrics, indicators, news, fundamentals, currency=CURRENCY)

    # O orçamento vale para a requisição inteira: system prompt + instrução + contexto.
    total = estimate_tokens(SYSTEM_PROMPT) + estimate_tokens(USER_INSTRUCTION) + estimate_tokens(context)
    assert total <= CONTEXT_TOKEN_BUDGET
    assert total < 8000, "a requisição deve ficar abaixo de 8000 tokens"


def test_contexto_poda_noticias_quando_estoura_o_orcamento(metrics, indicators, fundamentals):
    noticias_gigantes = {
        "PETR4.SA": [
            {"title": "T" * 500, "description": "D" * 400, "url": "https://x", "published": "2026-10-10"}
            for _ in range(5)
        ],
        "VALE3.SA": [
            {"title": "T" * 500, "description": "D" * 400, "url": "https://y", "published": "2026-10-10"}
            for _ in range(5)
        ],
    }
    budget = 1500
    context = build_briefing_context(
        metrics, indicators, noticias_gigantes, fundamentals, token_budget=budget
    )

    assert estimate_tokens(context) <= budget
    # A poda sacrifica notícias, mas nunca a carteira nem os indicadores.
    assert "CARTEIRA" in context and "INDICADORES TÉCNICOS" in context
    assert "PETR4.SA" in context


def test_contexto_funciona_sem_noticias_e_sem_fundamentals(metrics, indicators):
    context = build_briefing_context(metrics, indicators, {}, {}, currency=CURRENCY)

    assert "nenhuma notícia disponível" in context
    assert "INDICADORES TÉCNICOS" in context
    assert estimate_tokens(context) <= CONTEXT_TOKEN_BUDGET


def test_contexto_de_carteira_vazia_nao_estoura():
    context = build_briefing_context(pd.DataFrame(), {}, {}, {})
    assert "carteira vazia" in context


def test_system_prompt_cobre_as_seis_secoes_obrigatorias():
    for secao in ("RESUMO EXECUTIVO", "CONTEXTO DE MERCADO", "ANÁLISE POR ATIVO",
                  "RECOMENDAÇÕES DA SEMANA", "SCORE DE RISCO DA CARTEIRA",
                  "PRÓXIMOS EVENTOS A MONITORAR"):
        assert secao in SYSTEM_PROMPT
    assert "nunca prometa retornos" in SYSTEM_PROMPT


def test_estimate_tokens_e_monotonico_e_conservador():
    assert estimate_tokens("") == 0
    assert estimate_tokens("a" * 300) == 200          # 1,5 caracteres por token
    assert estimate_tokens("a" * 700) > estimate_tokens("a" * 350)


# --- Falhas tratadas --------------------------------------------------------
def test_sem_chave_devolve_erro_amigavel_sem_levantar(monkeypatch, metrics, indicators):
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    result = generate_briefing(metrics, indicators, {}, {})

    assert result.error is not None
    assert "ANTHROPIC_API_KEY" in result.error
    assert result.text == ""
    assert result.ok is False
    assert result.context_tokens and result.context_tokens > 0


# --- Chamada real (opt-in: consome créditos) --------------------------------
@pytest.mark.network
@pytest.mark.paid
def test_contagem_de_tokens_real_confere_com_a_estimativa(metrics, indicators, news, fundamentals):
    """Valida a heurística `estimate_tokens` contra `messages.count_tokens`.

    Rode com: pytest -m paid
    """
    import os

    if not os.getenv("ANTHROPIC_API_KEY"):
        pytest.skip("ANTHROPIC_API_KEY não configurada")

    import anthropic

    context = build_briefing_context(metrics, indicators, news, fundamentals, currency=CURRENCY)
    client = anthropic.Anthropic()
    real_total = client.messages.count_tokens(
        model="claude-opus-5",
        system=SYSTEM_PROMPT,
        messages=[{"role": "user", "content": f"{USER_INSTRUCTION}\n\n{context}"}],
    ).input_tokens

    assert real_total <= CONTEXT_TOKEN_BUDGET, "requisição real acima do orçamento"

    estimado = (
        estimate_tokens(SYSTEM_PROMPT) + estimate_tokens(USER_INSTRUCTION) + estimate_tokens(context)
    )
    # A heurística precisa ser conservadora (nunca subestimar muito) e não
    # exagerada ao ponto de podar contexto útil sem necessidade.
    assert 0.9 <= estimado / real_total <= 1.8, f"estimado {estimado} vs real {real_total}"
