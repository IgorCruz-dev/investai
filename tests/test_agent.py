"""Testes do agente: normalização de ticker, poda de histórico e formato das respostas."""

from __future__ import annotations

import pytest

from src.agent import tools
from src.agent.assistant import MAX_HISTORICO, Resposta, _aparar, responder, saudacao


# --- Normalização de ticker -------------------------------------------------
@pytest.mark.parametrize("entrada,esperado", [
    ("petr4", "PETR4.SA"),
    ("PETR4", "PETR4.SA"),
    ("  vale3  ", "VALE3.SA"),
    ("KLBN11", "KLBN11.SA"),
    ("PETR4.SA", "PETR4.SA"),      # já normalizado
    ("AAPL", "AAPL"),              # americano passa direto
    ("MSFT", "MSFT"),
    ("", ""),
])
def test_normalizacao_de_ticker(entrada, esperado):
    assert tools._normalizar(entrada) == esperado


# --- Poda de histórico ------------------------------------------------------
def test_historico_curto_fica_intacto():
    historico = [{"role": "user", "content": f"m{i}"} for i in range(5)]
    assert _aparar(historico) == historico


def test_historico_longo_mantem_as_mensagens_recentes():
    historico = [{"role": "user", "content": f"m{i}"} for i in range(MAX_HISTORICO + 20)]
    podado = _aparar(historico)

    assert len(podado) <= MAX_HISTORICO
    assert podado[-1] == historico[-1], "a mensagem mais recente nunca pode sumir"


def _comeca_com_orfao(historico) -> bool:
    if not historico:
        return False
    primeiro = historico[0]
    conteudo = primeiro.get("content")
    return (primeiro.get("role") == "user" and isinstance(conteudo, list)
            and any(b.get("type") == "tool_result" for b in conteudo))


def test_poda_preserva_a_conversa_cortando_em_turno_limpo():
    """Conversa real: texto do usuário, resposta, e pares de ferramenta no meio."""
    historico = []
    for i in range(MAX_HISTORICO):
        historico.append({"role": "user", "content": f"pergunta {i}"})
        historico.append({"role": "assistant", "content": [{"type": "tool_use", "id": f"t{i}"}]})
        historico.append({"role": "user", "content": [{"type": "tool_result", "tool_use_id": f"t{i}"}]})
        historico.append({"role": "assistant", "content": f"resposta {i}"})

    podado = _aparar(historico)

    assert len(podado) <= MAX_HISTORICO
    assert not _comeca_com_orfao(podado), "não pode começar com tool_result órfão"
    assert podado[0]["role"] == "user" and isinstance(podado[0]["content"], str)
    assert podado[-1] == historico[-1]


def test_poda_sem_fronteira_segura_reinicia_em_vez_de_enviar_invalido():
    """Caso degenerado: só pares de ferramenta, nenhum turno de texto na cauda."""
    historico = []
    for i in range(MAX_HISTORICO + 10):
        historico.append({"role": "user", "content": [{"type": "tool_result", "tool_use_id": f"t{i}"}]})
        historico.append({"role": "assistant", "content": f"resposta {i}"})

    podado = _aparar(historico)

    assert podado == [], "melhor recomeçar do que mandar histórico que a API recusa"
    assert not _comeca_com_orfao(podado)


# --- Fronteiras do assistente -----------------------------------------------
def test_mensagem_vazia_nao_chama_a_api():
    assert responder("   ").erro == "mensagem vazia"


def test_sem_chave_devolve_erro_tratado(monkeypatch):
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    resultado = responder("oi")

    assert resultado.erro and "ANTHROPIC_API_KEY" in resultado.erro
    assert resultado.ok is False


def test_custo_considera_desconto_do_cache():
    sem_cache = Resposta(texto="x", input_tokens=4000, output_tokens=200)
    com_cache = Resposta(texto="x", input_tokens=4, output_tokens=200, cache_read_tokens=4000)

    assert com_cache.custo_estimado < sem_cache.custo_estimado
    # Entrada cacheada custa ~10% da normal:
    # 200 tokens de saída (US$ 25/M) + 4.000 em cache (US$ 0,50/M) + 4 de entrada.
    assert com_cache.custo_estimado == pytest.approx(0.005 + 0.002 + 0.00002, abs=1e-5)


def test_saudacao_lista_as_capacidades():
    texto = saudacao()
    for termo in ("Carteira", "Ativos", "Notícias", "Briefing", "Perfil"):
        assert termo in texto


# --- Ferramentas (sem rede: carteira vazia é o estado atual) ----------------
def test_ferramentas_tem_nome_descricao_e_schema():
    assert len(tools.FERRAMENTAS) == 8
    for ferramenta in tools.FERRAMENTAS:
        assert ferramenta.name and ferramenta.description
        assert "properties" in ferramenta.input_schema
        assert len(ferramenta.description) > 40, f"{ferramenta.name}: descrição curta demais"


def test_carteira_vazia_orienta_o_onboarding(monkeypatch, tmp_path):
    from src import config as config_mod

    vazia = tmp_path / "portfolio.json"
    vazia.write_text('{"portfolio": [], "currency": "BRL"}', encoding="utf-8")
    monkeypatch.setattr(config_mod, "PORTFOLIO_PATH", vazia)

    resposta = tools.consultar_carteira()
    assert "vazia" in resposta.lower() and "onboarding" in resposta.lower()


def test_perfil_ausente_orienta_o_onboarding(monkeypatch, tmp_path):
    from src import config as config_mod

    monkeypatch.setattr(config_mod, "PROFILE_PATH", tmp_path / "inexistente.json")
    assert "onboarding" in tools.status_do_perfil().lower()
    assert "onboarding" in tools.recomendar_carteira().lower()


def test_ticker_vazio_pede_o_codigo():
    assert "informe" in tools.analisar_ativo("").lower()
    assert "informe" in tools.cotacao("").lower()


def test_data_de_hoje_responde_em_portugues():
    texto = tools.data_de_hoje()
    assert "/" in texto
    assert any(dia in texto for dia in ("segunda", "terça", "quarta", "quinta",
                                        "sexta", "sábado", "domingo"))


# --- Agente real (consome créditos) ----------------------------------------
@pytest.mark.network
@pytest.mark.paid
def test_agente_responde_pergunta_real(require_internet):
    """Rode com: pytest -m paid"""
    import os

    if not os.getenv("ANTHROPIC_API_KEY"):
        pytest.skip("ANTHROPIC_API_KEY não configurada")

    resultado = responder("qual o preço da PETR4?")

    assert resultado.ok, resultado.erro
    assert "cotacao" in resultado.ferramentas_usadas or "analisar_ativo" in resultado.ferramentas_usadas
    assert "PETR4" in resultado.texto.upper()
    assert resultado.custo_estimado < 0.20, "uma pergunta simples não deveria custar tanto"


# --- Respostas locais (sem custo) -------------------------------------------
@pytest.mark.parametrize("mensagem", ["oi", "Oi!", "OLÁ", "bom dia", "Boa noite",
                                      "tudo bem?", "valeu", "obrigado", "👍"])
def test_mensagens_triviais_respondem_sem_chamar_o_modelo(mensagem):
    from src.agent.assistant import resposta_rapida
    assert resposta_rapida(mensagem) is not None


@pytest.mark.parametrize("mensagem", [
    "bom dia, como está minha carteira?",
    "analisa PETR4",
    "oi, me manda o briefing",
    "obrigado, mas e a VALE3?",
])
def test_mensagem_com_pedido_real_vai_para_o_modelo(mensagem):
    """Só a saudação pura responde local — pedido junto precisa do modelo."""
    from src.agent.assistant import resposta_rapida
    assert resposta_rapida(mensagem) is None


def test_custo_inclui_a_escrita_do_cache():
    """A primeira mensagem escreve ~4 mil tokens: é a mais cara, não a mais barata."""
    primeira = Resposta(texto="x", input_tokens=2, output_tokens=134, cache_write_tokens=4323)
    seguinte = Resposta(texto="x", input_tokens=4, output_tokens=134, cache_read_tokens=4323)

    assert primeira.custo_estimado == pytest.approx(0.0304, abs=0.001)
    assert seguinte.custo_estimado < primeira.custo_estimado / 5
