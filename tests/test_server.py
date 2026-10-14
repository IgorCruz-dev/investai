"""Testes do servidor do assistente.

O envio pela ponte é substituído por um registrador — o que importa aqui é o
**nosso** fluxo: segredo, lista branca, idempotência, comandos e teto de gasto.
A chamada ao Claude tem custo e latência, então o agente também é substituído;
o agente real é exercitado em `test_agent.py`.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

NUMERO = "5516999990000"
SEGREDO = "segredo-da-ponte"


@pytest.fixture
def ambiente(tmp_path, monkeypatch):
    """Servidor isolado: banco temporário, número e segredo de teste."""
    monkeypatch.setenv("INVESTAI_DB", str(tmp_path / "test.db"))
    monkeypatch.setenv("WHATSAPP_ALLOWED_NUMBERS", NUMERO)
    monkeypatch.setenv("BRIDGE_SECRET", SEGREDO)
    monkeypatch.setenv("INVESTAI_CRON_TOKEN", "token-cron")
    monkeypatch.setenv("INVESTAI_MONTHLY_BUDGET_USD", "5")

    import importlib
    from server import config as config_mod
    importlib.reload(config_mod)
    from server import bridge_client as bridge_mod, store as store_mod
    importlib.reload(store_mod)
    importlib.reload(bridge_mod)
    from server import app as app_mod
    importlib.reload(app_mod)

    enviadas: list[tuple[str, str]] = []
    monkeypatch.setattr(app_mod.bridge_client, "enviar_texto",
                        lambda numero, texto, jid="": enviadas.append((numero, texto)) or True)
    monkeypatch.setattr(app_mod.bridge_client, "status", lambda: {"conectado": True})

    return app_mod, store_mod, enviadas


@pytest.fixture
def client(ambiente):
    app_mod, _store, _enviadas = ambiente
    with TestClient(app_mod.app) as cliente:
        yield cliente


def postar(client, texto, numero=NUMERO, message_id="m1", segredo=SEGREDO):
    return client.post(
        "/bridge/message",
        json={"numero": numero, "texto": texto, "message_id": message_id,
              "jid": f"{numero}@s.whatsapp.net"},
        headers={"X-Bridge-Secret": segredo},
    )


def _resposta_fake(texto: str = "resposta de teste"):
    from src.agent.assistant import Resposta
    return Resposta(texto=texto, historico=[{"role": "user", "content": "oi"}],
                    input_tokens=10, output_tokens=20)


# --- Segurança --------------------------------------------------------------
def test_segredo_invalido_e_recusado(client):
    assert postar(client, "oi", segredo="errado").status_code == 403
    assert client.post("/bridge/message", json={"numero": NUMERO, "texto": "oi"}).status_code == 403


def test_numero_fora_da_lista_branca_e_ignorado(client, ambiente):
    _app, _store, enviadas = ambiente
    resposta = postar(client, "oi", numero="5511888887777")

    assert resposta.json()["status"] == "ignorado"
    assert enviadas == [], "número não autorizado não recebe resposta"


def test_payload_malformado_e_recusado(client):
    resposta = client.post("/bridge/message", json={"numero": "123"},
                           headers={"X-Bridge-Secret": SEGREDO})
    assert resposta.status_code == 422, "número curto demais não é telefone"


# --- Idempotência -----------------------------------------------------------
def test_mensagem_repetida_nao_e_processada_duas_vezes(client, ambiente):
    app_mod, _store, _enviadas = ambiente
    chamadas: list[str] = []
    app_mod.responder = lambda *a, **k: chamadas.append("x") or _resposta_fake()

    postar(client, "oi", message_id="repetida")
    segunda = postar(client, "oi", message_id="repetida")

    assert segunda.json()["status"] == "duplicada"
    assert len(chamadas) == 1


# --- Comandos ---------------------------------------------------------------
def test_comando_de_ajuda_nao_chama_o_modelo(client, ambiente):
    app_mod, _store, enviadas = ambiente
    app_mod.responder = lambda *a, **k: pytest.fail("ajuda não deveria chamar o modelo")

    postar(client, "/ajuda")

    assert "InvestAI" in enviadas[0][1]


def test_comando_de_limpar_apaga_o_historico(client, ambiente):
    app_mod, store_mod, enviadas = ambiente
    store_mod.salvar_historico(NUMERO, [{"role": "user", "content": "antigo"}])

    postar(client, "/limpar")

    assert store_mod.carregar_historico(NUMERO) == []
    assert "esqueci" in enviadas[-1][1].lower()


# --- Conversa ---------------------------------------------------------------
def test_mensagem_normal_responde_e_guarda_historico(client, ambiente):
    app_mod, store_mod, enviadas = ambiente
    app_mod.responder = lambda *a, **k: _resposta_fake("PETR4 está em R$ 56,00")

    postar(client, "quanto está a PETR4?")

    assert enviadas[-1][0] == NUMERO and "PETR4" in enviadas[-1][1]
    assert store_mod.carregar_historico(NUMERO), "a conversa deve persistir entre mensagens"


def test_erro_do_agente_vira_mensagem_amigavel(client, ambiente):
    from src.agent.assistant import Resposta
    app_mod, _store, enviadas = ambiente
    app_mod.responder = lambda *a, **k: Resposta(erro="API fora do ar")

    postar(client, "oi")

    assert "API fora do ar" in enviadas[-1][1]
    assert "Traceback" not in enviadas[-1][1]


def test_excecao_inesperada_nao_derruba_o_servidor(client, ambiente):
    app_mod, _store, enviadas = ambiente

    def explode(*a, **k):
        raise RuntimeError("boom")

    app_mod.responder = explode
    resposta = postar(client, "oi")

    assert resposta.status_code == 202
    assert "problema inesperado" in enviadas[-1][1].lower()


# --- Teto de gasto ----------------------------------------------------------
def test_teto_de_gasto_bloqueia_novas_respostas(client, ambiente):
    app_mod, store_mod, enviadas = ambiente
    store_mod.registrar_gasto(NUMERO, 10.0)
    app_mod.responder = lambda *a, **k: pytest.fail("não deveria chamar o modelo com o teto estourado")

    postar(client, "oi")

    assert "limite de gasto" in enviadas[-1][1].lower()


def test_gasto_e_registrado_apos_responder(client, ambiente):
    app_mod, store_mod, _enviadas = ambiente
    app_mod.responder = lambda *a, **k: _resposta_fake()

    postar(client, "oi")

    assert store_mod.gasto_do_mes() > 0


# --- Cron -------------------------------------------------------------------
def test_cron_exige_token(client):
    assert client.post("/cron/briefing", params={"token": "errado"}).status_code == 403
    assert client.post("/cron/briefing").status_code == 403


def test_cron_com_token_valido_agenda_o_envio(client, ambiente):
    resposta = client.post("/cron/briefing", params={"token": "token-cron"})
    assert resposta.status_code == 200
    assert resposta.json()["status"] == "agendado"


def test_briefing_semanal_envia_para_os_autorizados(ambiente, monkeypatch):
    app_mod, _store, enviadas = ambiente
    monkeypatch.setattr(app_mod, "_enviar_briefing_semanal",
                        app_mod._enviar_briefing_semanal)  # usa o real
    monkeypatch.setattr("src.agent.tools.gerar_briefing", lambda: "BRIEFING DE TESTE")

    app_mod._enviar_briefing_semanal()

    assert enviadas, "deveria enviar para o número autorizado"
    assert "briefing semanal" in enviadas[0][1].lower()


# --- Saúde ------------------------------------------------------------------
def test_health_reporta_configuracao_e_estado_da_ponte(client):
    dados = client.get("/health").json()
    assert dados["status"] == "ok"
    assert dados["configuracao_faltando"] == []
    assert dados["ponte"]["conectado"] is True
    assert "gasto_mes_usd" in dados
