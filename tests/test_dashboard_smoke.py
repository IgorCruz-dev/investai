"""Smoke test do dashboard: o app abre e renderiza as 4 abas sem exceção.

Usa `streamlit.testing.v1.AppTest`, que executa `main.py` de verdade (dados
reais incluídos) e expõe qualquer exceção levantada no render.
"""

from __future__ import annotations

from pathlib import Path

import pytest

pytest.importorskip("streamlit")

from streamlit.testing.v1 import AppTest  # noqa: E402

# Caminhos relativos no AppTest resolvem contra este arquivo; usamos o absoluto.
MAIN = Path(__file__).resolve().parent.parent / "main.py"


@pytest.fixture
def carteira_real(tmp_path, monkeypatch):
    """Carteira com posições reais, isolada do `config/portfolio.json` do usuário."""
    from src import config as config_module

    arquivo = tmp_path / "portfolio.json"
    arquivo.write_text(
        '''{"portfolio": [
            {"ticker": "PETR4.SA", "shares": 100, "avg_price": 35.50},
            {"ticker": "VALE3.SA", "shares": 50, "avg_price": 68.00},
            {"ticker": "ITUB4.SA", "shares": 200, "avg_price": 25.00}
        ], "currency": "BRL"}''',
        encoding="utf-8",
    )
    monkeypatch.setattr(config_module, "PORTFOLIO_PATH", arquivo)
    monkeypatch.setattr(config_module, "PROFILE_PATH", tmp_path / "profile.json")
    return arquivo


@pytest.mark.network
def test_dashboard_abre_sem_erro(require_internet, carteira_real):
    app = AppTest.from_file(str(MAIN), default_timeout=240).run()

    assert not app.exception, f"dashboard levantou exceção: {[e.value for e in app.exception]}"

    titles = [t.value for t in app.title]
    assert any("InvestAI" in t for t in titles)

    labels = [tab.label for tab in app.tabs]
    for expected in ("Carteira", "Análise Técnica", "Briefing Semanal", "Notícias"):
        assert expected in labels, f"aba ausente: {expected} (encontradas: {labels})"

    # Sem chave da Anthropic o app precisa avisar, não quebrar.
    assert not app.error or all("portfolio.json" not in e.value for e in app.error)


@pytest.mark.network
def test_sem_chave_o_botao_de_briefing_fica_desabilitado(require_internet, carteira_real, monkeypatch):
    """Sem chave o app avisa e bloqueia o botão, em vez de falhar no clique."""
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    app = AppTest.from_file(str(MAIN), default_timeout=240).run()

    botoes = [b for b in app.button if b.label == "Gerar Briefing"]
    assert botoes, "botão de geração do briefing não encontrado"
    assert botoes[0].disabled, "sem chave, o botão deveria estar desabilitado"
    assert any("ANTHROPIC_API_KEY" in w.value for w in app.warning)


@pytest.mark.network
def test_chave_invalida_mostra_erro_amigavel_no_dashboard(require_internet, carteira_real, monkeypatch):
    """Chave inválida → mensagem amigável na aba, sem exceção e sem custo."""
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-ant-chave-invalida-de-teste")
    app = AppTest.from_file(str(MAIN), default_timeout=240).run()

    botoes = [b for b in app.button if b.label == "Gerar Briefing"]
    assert botoes and not botoes[0].disabled, "com chave presente o botão deve ficar ativo"

    app = botoes[0].set_value(True).run()
    assert not app.exception, f"clique no briefing levantou exceção: {[e.value for e in app.exception]}"
    erros = [e.value for e in app.error]
    assert any("Chave da Anthropic inválida" in e for e in erros), erros


@pytest.mark.network
def test_botao_atualizar_dados_refaz_a_busca(require_internet, carteira_real):
    app = AppTest.from_file(str(MAIN), default_timeout=240).run()
    botoes = [b for b in app.button if "Atualizar" in b.label]
    assert botoes, "botão de atualização não encontrado"

    app = botoes[0].set_value(True).run()
    assert not app.exception, f"atualização levantou exceção: {[e.value for e in app.exception]}"
    assert any("Última atualização" in m.value for m in app.sidebar.markdown)


# --- Onboarding -------------------------------------------------------------
@pytest.fixture
def carteira_vazia(tmp_path, monkeypatch):
    """Carteira inexistente + LLM desligado: força o onboarding sem custo.

    O app decide usar o LLM por `llm_analyst.probe()`, que só olha se existe
    chave; removendo a variável, a recomendação sai pelo filtro quantitativo e
    o teste não consome créditos a cada execução.
    """
    from src import config as config_module

    vazia = tmp_path / "portfolio.json"
    vazia.write_text('{"portfolio": [], "currency": "BRL"}', encoding="utf-8")
    monkeypatch.setattr(config_module, "PORTFOLIO_PATH", vazia)
    monkeypatch.setattr(config_module, "PROFILE_PATH", tmp_path / "profile.json")
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    return vazia


@pytest.mark.network
def test_sem_carteira_o_app_abre_o_onboarding(require_internet, carteira_vazia):
    app = AppTest.from_file(str(MAIN), default_timeout=300).run()

    assert not app.exception, [e.value for e in app.exception]
    assert any("Bem-vindo ao InvestAI" in t.value for t in app.title)

    # A primeira decisão do fluxo é se a pessoa já tem carteira.
    perguntas = [r.label for r in app.radio]
    assert any("carteira de investimentos ativa" in p for p in perguntas), perguntas
    assert any("Começar" in b.label for b in app.button)
    # Sem carteira não existem abas de análise ainda.
    assert not app.tabs


@pytest.mark.network
def test_onboarding_chega_na_carteira_sugerida(require_internet, carteira_vazia):
    """Com o questionário respondido, a tela final traz perfil e recomendação."""
    from dashboard.components.onboarding import STATE_ANSWERS, STATE_PATH, STATE_STEP
    from src.onboarding.questionnaire import STEPS
    from tests.test_onboarding import BASE_ANSWERS

    app = AppTest.from_file(str(MAIN), default_timeout=300)
    # Entra direto no resultado: o passo a passo dos formulários é coberto
    # pelos testes do questionário, e cada etapa extra aqui refaz a busca.
    app.session_state[STATE_PATH] = "new"
    app.session_state[STATE_ANSWERS] = dict(BASE_ANSWERS)
    app.session_state[STATE_STEP] = len(STEPS)
    app = app.run()

    assert not app.exception, [e.value for e in app.exception]

    metricas = {m.label: m.value for m in app.metric}
    assert metricas.get("Perfil") in ("Conservador", "Moderado", "Arrojado")
    assert "Score de risco" in metricas
    assert "Para investir agora" in metricas

    subtitulos = [s.value for s in app.subheader]
    assert any("Carteira sugerida" in s for s in subtitulos), subtitulos
    assert any("Adotar" in b.label for b in app.button)


@pytest.mark.network
def test_onboarding_de_quem_ja_tem_carteira_pede_cotas(require_internet, carteira_vazia):
    from dashboard.components.onboarding import STATE_PATH

    app = AppTest.from_file(str(MAIN), default_timeout=300)
    app.session_state[STATE_PATH] = "existing"
    app = app.run()

    assert not app.exception, [e.value for e in app.exception]
    assert any("carteira atual" in t.value.lower() for t in app.title)
    assert app.multiselect, "deveria oferecer seleção de ativos"
