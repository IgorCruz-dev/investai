"""Testes do questionário de perfil por conversa.

Percorre as 18 perguntas mandando mensagem, como se fosse o celular. O que
importa aqui: o fluxo chega ao fim, entende os formatos de resposta de cada tipo
de pergunta, deixa voltar e cancelar, e **só grava o perfil depois do "sim"**.

Nenhuma chamada de modelo em todo o percurso — `responder` do agente é minado
com `pytest.fail`, então um escorregão para o LLM quebra o teste.
"""

from __future__ import annotations

import pytest

from investai.onboarding.questionnaire import QUESTIONS

NUMERO = "5516999990000"


@pytest.fixture
def conversa(tmp_path, monkeypatch, banco):
    """Servidor isolado: SQLite temporário para a sessão, Postgres para o perfil."""
    monkeypatch.setenv("INVESTAI_DB", str(tmp_path / "sessao.db"))
    import importlib

    from investai.whatsapp import config as config_mod
    importlib.reload(config_mod)
    from investai.whatsapp import store as store_mod
    importlib.reload(store_mod)
    store_mod.init()

    from investai.whatsapp import onboarding_chat
    importlib.reload(onboarding_chat)

    from investai.agent import assistant
    monkeypatch.setattr(assistant, "responder",
                        lambda *a, **k: pytest.fail("onboarding não chama o modelo"))

    class Conversa:
        store = store_mod
        chat = onboarding_chat
        repo = banco

        def manda(self, texto: str) -> str:
            """Passa pelo roteador de verdade, como uma mensagem do WhatsApp."""
            from investai.whatsapp import actions
            from investai.whatsapp.router import resolver

            intencao = resolver(texto, store_mod.ler_sessao(NUMERO))
            assert intencao.usa_llm is False, f'"{texto}" tentou usar IA'
            return actions.executar(intencao, NUMERO)

    return Conversa()


#: Respostas válidas para as 18 perguntas, na ordem. Perfil de quem tem renda
#: estável, reserva feita, horizonte longo e aguenta queda — deve dar arrojado
#: na pontuação, mas cair para moderado pelo teto de iniciante.
RESPOSTAS = [
    "7",        # financial_health (scale 1-10)
    "9",        # commitment (scale)
    "1",        # priority: patrimonio
    "1",        # knowledge: iniciante
    "4",        # income_range: 4500_10k
    "4000",     # monthly_expenses (number)
    "50000",    # initial_amount
    "2000",     # monthly_contribution
    "4",        # emergency_fund: acima_6m
    "3",        # expensive_debt: nenhuma
    "3",        # income_stability: estavel
    "4",        # main_goal: aposentadoria
    "5",        # horizon: acima_10a
    "3",        # liquidity_need: baixa
    "1",        # international: sim
    "4",        # drawdown_reaction: aporto_mais
    "3",        # volatility_preference: agressivo
    "0",        # experience: nenhum (pular)
]


@pytest.mark.network
def test_percorre_as_18_perguntas_e_grava_depois_do_sim(conversa):
    primeira = conversa.manda("/onboarding")
    assert "18 perguntas" in primeira
    assert QUESTIONS[0].prompt in primeira

    for i, resposta in enumerate(RESPOSTAS):
        saida = conversa.manda(resposta)
        if i + 1 < len(QUESTIONS):
            assert QUESTIONS[i + 1].prompt in saida, \
                f"depois da resposta {i + 1} deveria vir a pergunta {i + 2}"

    # A última resposta produz o resumo, não a gravação.
    assert "Salvo assim?" in saida
    assert conversa.repo.perfil() == {}, "o perfil não pode ser gravado antes do sim"

    final = conversa.manda("sim")

    assert "Perfil salvo" in final
    salvo = conversa.repo.perfil()
    assert salvo["profile"] in ("Conservador", "Moderado", "Arrojado")
    assert salvo["answers"]["horizon"] == "acima_10a"
    assert salvo["answers"]["monthly_expenses"] == 4000
    assert salvo["allocation"], "a alocação-alvo tem de vir junto"


@pytest.mark.network
def test_teto_de_iniciante_vale_no_fluxo_por_conversa(conversa):
    """A regra de `profile.py` não pode se perder no caminho da conversa.

    Score alto + "sou iniciante" + nunca investiu em risco = moderado, não
    arrojado: tolerância a queda só se comprova vivendo uma.
    """
    conversa.manda("/onboarding")
    for resposta in RESPOSTAS:
        conversa.manda(resposta)
    conversa.manda("sim")

    salvo = conversa.repo.perfil()
    assert salvo["profile"] == "Moderado"
    assert salvo["risk_score"] >= 72, "o score bruto daria arrojado"
    assert any("limitado a moderado" in n for n in salvo["notes"])


@pytest.mark.network
def test_nao_descarta_o_perfil_no_fim(conversa):
    conversa.manda("/onboarding")
    for resposta in RESPOSTAS:
        conversa.manda(resposta)

    saida = conversa.manda("nao")

    assert "não gravei" in saida.lower()
    assert conversa.repo.perfil() == {}


@pytest.mark.network
def test_cancelar_no_meio_nao_deixa_rastro(conversa):
    conversa.manda("/onboarding")
    conversa.manda("7")

    saida = conversa.manda("cancelar")

    assert "cancelado" in saida.lower()
    assert conversa.store.ler_sessao(NUMERO) == {}
    assert conversa.repo.perfil() == {}


@pytest.mark.network
def test_voltar_refaz_a_pergunta_anterior(conversa):
    conversa.manda("/onboarding")
    conversa.manda("7")                                 # responde a pergunta 1
    assert QUESTIONS[2].prompt in conversa.manda("9")   # responde a 2, abre a 3

    saida = conversa.manda("voltar")

    assert QUESTIONS[1].prompt in saida, "voltar tem de reabrir a pergunta 2"
    assert "commitment" not in (conversa.store.ler_sessao(NUMERO)["respostas"]), \
        "voltar apaga a resposta anterior em vez de deixar o valor velho valendo"


@pytest.mark.network
def test_voltar_na_primeira_pergunta_avisa_e_nao_quebra(conversa):
    conversa.manda("/onboarding")

    saida = conversa.manda("voltar")

    assert "primeira pergunta" in saida
    assert QUESTIONS[0].prompt in saida


@pytest.mark.network
def test_interrogacao_explica_sem_avancar(conversa):
    conversa.manda("/onboarding")

    saida = conversa.manda("?")

    assert QUESTIONS[0].help in saida
    assert conversa.store.ler_sessao(NUMERO)["idx"] == 0, "pedir ajuda não avança"


@pytest.mark.network
def test_resposta_fora_da_faixa_e_recusada_e_a_pergunta_volta(conversa):
    conversa.manda("/onboarding")

    saida = conversa.manda("42")   # a escala vai de 1 a 10

    assert "de 1 a 10" in saida
    assert QUESTIONS[0].prompt in saida
    assert conversa.store.ler_sessao(NUMERO)["idx"] == 0


@pytest.mark.network
def test_opcao_inexistente_em_escolha_e_recusada(conversa):
    conversa.manda("/onboarding")
    conversa.manda("7")
    conversa.manda("9")
    # Agora a 3 (priority), com 5 opções.
    saida = conversa.manda("8")

    assert "de 1 a 5" in saida


@pytest.mark.network
def test_multipla_escolha_aceita_varios_numeros(conversa):
    conversa.manda("/onboarding")
    for resposta in RESPOSTAS[:-1]:
        conversa.manda(resposta)

    conversa.manda("2,4")      # renda fixa + ações
    conversa.manda("sim")

    experiencia = conversa.repo.perfil()["answers"]["experience"]
    assert set(experiencia) == {"renda_fixa", "acoes"}


@pytest.mark.network
def test_experiencia_em_risco_libera_o_perfil_arrojado(conversa):
    """Quem já comprou ação não leva o teto de iniciante."""
    conversa.manda("/onboarding")
    for resposta in RESPOSTAS[:-1]:
        conversa.manda(resposta)
    conversa.manda("4")       # já investiu em ações
    conversa.manda("sim")

    assert conversa.repo.perfil()["profile"] == "Arrojado"


@pytest.mark.network
def test_valor_em_reais_aceita_formato_brasileiro(conversa):
    conversa.manda("/onboarding")
    for resposta in RESPOSTAS[:5]:
        conversa.manda(resposta)

    conversa.manda("4.500,50")        # monthly_expenses
    respostas = conversa.store.ler_sessao(NUMERO)["respostas"]

    assert respostas["monthly_expenses"] == 4500.50


@pytest.mark.network
def test_refazer_nao_apaga_o_perfil_antigo_antes_da_confirmacao(conversa):
    """Quem recomeça o questionário não pode perder o perfil que já tinha."""
    conversa.manda("/onboarding")
    for resposta in RESPOSTAS:
        conversa.manda(resposta)
    conversa.manda("sim")
    antigo = conversa.repo.perfil()

    saida = conversa.manda("/onboarding")
    conversa.manda("1")

    assert "já tem um perfil salvo" in saida
    assert conversa.repo.perfil()["profile"] == antigo["profile"]


@pytest.mark.network
def test_perfil_salvo_aparece_no_comando_perfil(conversa):
    """Fecha o ciclo: o que o onboarding gravou é o que o /perfil mostra."""
    conversa.manda("/onboarding")
    for resposta in RESPOSTAS:
        conversa.manda(resposta)
    conversa.manda("sim")

    saida = conversa.manda("/perfil")

    assert "Moderado" in saida
    assert "Alocação-alvo" in saida
