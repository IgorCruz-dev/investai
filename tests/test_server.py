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

    from investai.whatsapp import config as config_mod
    importlib.reload(config_mod)
    from investai.whatsapp import bridge_client as bridge_mod
    from investai.whatsapp import store as store_mod
    importlib.reload(store_mod)
    importlib.reload(bridge_mod)
    from investai.whatsapp import app as app_mod
    importlib.reload(app_mod)

    # O reload acima re-executa `load_dotenv()`, que ressuscita a DATABASE_URL
    # que a fixture `sem_banco_por_padrao` tinha escondido. Sem esta linha a
    # suíte offline passa a falar com o Postgres remoto de quem tem `.env` —
    # e quebra em quem não tem, o que é o caso do CI e de todo clone novo.
    monkeypatch.delenv("DATABASE_URL", raising=False)

    enviadas: list[tuple[str, str]] = []
    monkeypatch.setattr(app_mod.bridge_client, "enviar_texto",
                        lambda numero, texto, jid="": enviadas.append((numero, texto)) or True)
    monkeypatch.setattr(app_mod.bridge_client, "status", lambda: {"conectado": True})

    # Mina em TODAS as rotas que custam dinheiro — não só no agente.
    #
    # Aprendido na prática: a primeira versão minava apenas
    # `assistant.responder`, e um teste que mandava "/pergunta analisa PETR4"
    # caiu na rota de análise (a palavra "analisa" casava antes do comando) e
    # fez uma chamada paga de verdade, silenciosamente. Um teste jamais deve
    # poder gastar crédito: a lista abaixo é a fronteira.
    from investai.agent import assistant as assistant_mod
    from investai.analysis import asset_analysis as analise_mod
    from investai.analysis import briefing as briefing_mod
    from investai.analysis import llm_analyst as llm_mod

    def _nao_chamar(*a, **k):
        pytest.fail("este teste não deveria chamar a API da Anthropic")

    for modulo, funcao in (
        (assistant_mod, "responder"),
        (analise_mod, "gerar"),
        (analise_mod, "analisar"),
        (briefing_mod, "montar"),
        (llm_mod, "generate_briefing"),
        (app_mod, "responder"),
    ):
        monkeypatch.setattr(modulo, funcao, _nao_chamar)

    return app_mod, store_mod, enviadas


@pytest.fixture
def agente_falso(ambiente, monkeypatch):
    """Substitui o agente por um registrador. Devolve a lista de chamadas."""
    app_mod, _store, _enviadas = ambiente
    from investai.agent import assistant as assistant_mod

    chamadas: list[str] = []

    def fake(mensagem, historico=None, *a, **k):
        chamadas.append(mensagem)
        return _resposta_fake()

    monkeypatch.setattr(assistant_mod, "responder", fake)
    monkeypatch.setattr(app_mod, "responder", fake)
    return chamadas


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
    from investai.agent.assistant import Resposta
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
def test_mensagem_repetida_nao_e_processada_duas_vezes(client, ambiente, agente_falso):
    postar(client, "/pergunta vale a pena PETR4", message_id="repetida")
    segunda = postar(client, "/pergunta vale a pena PETR4", message_id="repetida")

    assert segunda.json()["status"] == "duplicada"
    assert len(agente_falso) == 1


# --- Comandos ---------------------------------------------------------------
def test_comando_de_ajuda_nao_chama_o_modelo(client, ambiente):
    """A mina de `ambiente` garante o "não chama"; aqui conferimos o conteúdo."""
    _app, _store, enviadas = ambiente

    postar(client, "/ajuda")

    assert "InvestAI" in enviadas[0][1]
    assert "1. Carteira" in enviadas[0][1], "a ajuda agora é o menu numerado"


def test_comando_de_limpar_apaga_o_historico(client, ambiente):
    app_mod, store_mod, enviadas = ambiente
    store_mod.salvar_historico(NUMERO, [{"role": "user", "content": "antigo"}])

    postar(client, "/limpar")

    assert store_mod.carregar_historico(NUMERO) == []
    assert "esqueci" in enviadas[-1][1].lower()


# --- Conversa ---------------------------------------------------------------
def test_pergunta_livre_responde_e_guarda_historico(client, ambiente, monkeypatch):
    """`/pergunta` é a única rota de conversa livre — e a única com histórico."""
    app_mod, store_mod, enviadas = ambiente
    from investai.agent import assistant as assistant_mod

    resposta = _resposta_fake("PETR4 está em R$ 56,00")
    monkeypatch.setattr(assistant_mod, "responder", lambda *a, **k: resposta)

    postar(client, "/pergunta quanto está a PETR4?")

    assert enviadas[-1][0] == NUMERO and "PETR4" in enviadas[-1][1]
    assert store_mod.carregar_historico(NUMERO), "a conversa deve persistir entre mensagens"


def test_erro_do_agente_vira_mensagem_amigavel(client, ambiente, monkeypatch):
    from investai.agent import assistant as assistant_mod
    from investai.agent.assistant import Resposta

    _app, _store, enviadas = ambiente
    monkeypatch.setattr(assistant_mod, "responder",
                        lambda *a, **k: Resposta(erro="API fora do ar"))

    postar(client, "/pergunta analisa PETR4")

    assert "API fora do ar" in enviadas[-1][1]
    assert "Traceback" not in enviadas[-1][1]


def test_excecao_inesperada_nao_derruba_o_servidor(client, ambiente, monkeypatch):
    from investai.whatsapp import actions

    def explode(*a, **k):
        raise RuntimeError("boom")

    _app, _store, enviadas = ambiente
    monkeypatch.setitem(actions.ACOES, "carteira", explode)

    resposta = postar(client, "minha carteira")

    assert resposta.status_code == 202
    assert "problema" in enviadas[-1][1].lower()
    assert "Traceback" not in enviadas[-1][1]


def test_saudacao_responde_local_sem_chamar_o_modelo(client, ambiente):
    """"oi" custaria ~US$ 0,03 por causa da escrita do cache. Não vale."""
    _app, store_mod, enviadas = ambiente

    postar(client, "oi")

    assert "InvestAI" in enviadas[-1][1]
    assert store_mod.gasto_do_mes() == 0, "resposta local não gera custo"


# --- Teto de gasto ----------------------------------------------------------
def test_teto_de_gasto_bloqueia_as_rotas_de_ia(client, ambiente):
    """A mina de `ambiente` prova o "não chamou"; a mensagem prova o aviso."""
    _app, store_mod, enviadas = ambiente
    store_mod.registrar_gasto(NUMERO, 10.0)

    postar(client, "/pergunta analisa PETR4")

    assert "limite de gasto" in enviadas[-1][1].lower()


def test_teto_de_gasto_nao_bloqueia_as_rotas_sem_ia(client, ambiente):
    """Bloquear a carteira porque o briefing estourou o orçamento seria punir
    justamente o caminho que não custa nada."""
    _app, store_mod, enviadas = ambiente
    store_mod.registrar_gasto(NUMERO, 10.0)

    postar(client, "/ajuda")

    assert "limite de gasto" not in enviadas[-1][1].lower()
    assert "1. Carteira" in enviadas[-1][1]


def test_gasto_e_registrado_apos_responder(client, ambiente, agente_falso):
    _app, store_mod, _enviadas = ambiente

    postar(client, "/pergunta analisa PETR4")

    assert store_mod.gasto_do_mes() > 0


def test_rota_sem_ia_nao_registra_gasto(client, ambiente):
    _app, store_mod, _enviadas = ambiente

    postar(client, "/ajuda", message_id="m-ajuda")
    postar(client, "/status", message_id="m-status")
    postar(client, "extrato", message_id="m-extrato")

    assert store_mod.gasto_do_mes() == 0


# --- Cron -------------------------------------------------------------------
def test_cron_exige_token(client):
    assert client.post("/cron/briefing", params={"token": "errado"}).status_code == 403
    assert client.post("/cron/briefing").status_code == 403


def test_cron_com_token_valido_agenda_o_envio(client, ambiente, monkeypatch):
    # O endpoint roda o briefing em segundo plano, e o `TestClient` executa a
    # tarefa de verdade — sem este patch o teste geraria um briefing pago.
    monkeypatch.setattr("investai.agent.tools.gerar_briefing", lambda: "BRIEFING DE TESTE")

    resposta = client.post("/cron/briefing", params={"token": "token-cron"})

    assert resposta.status_code == 200
    assert resposta.json()["status"] == "agendado"


def test_briefing_semanal_envia_para_os_autorizados(ambiente, monkeypatch):
    app_mod, _store, enviadas = ambiente
    monkeypatch.setattr(app_mod, "_enviar_briefing_semanal",
                        app_mod._enviar_briefing_semanal)  # usa o real
    monkeypatch.setattr("investai.agent.tools.gerar_briefing", lambda: "BRIEFING DE TESTE")

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


# --- Roteador: o que custa e o que não custa --------------------------------
def test_pergunta_com_palavra_de_outra_rota_no_argumento(client, ambiente, monkeypatch):
    """Regressão: `/pergunta analisa PETR4` ia para a rota de ANÁLISE.

    A palavra "analisa" estava no argumento do comando e casava com o
    vocabulário antes de o comando explícito ser considerado. O usuário pedia
    conversa livre e recebia — e pagava — outra rota. Comando com barra é
    declaração de intenção: o que vem depois é argumento.
    """
    from investai.whatsapp.router import resolver

    intencao = resolver("/pergunta analisa PETR4")

    assert intencao.nome == "pergunta"
    assert intencao.args["texto_livre"] == "analisa petr4"


def test_comando_explicito_vence_qualquer_palavra_chave():
    from investai.whatsapp.router import resolver

    casos = {
        "/pergunta me manda o briefing da carteira": "pergunta",
        "/carteira analisa tudo": "carteira",
        "/extrato comprei petr4": "extrato",
        "/status quanto esta a petr4": "status",
    }
    for frase, esperado in casos.items():
        assert resolver(frase).nome == esperado, frase


def test_registro_de_compra_pede_confirmacao_e_nao_grava(client, ambiente):
    """Nada é gravado na primeira mensagem — nem com o banco disponível."""
    _app, store_mod, enviadas = ambiente

    postar(client, "comprei 100 PETR4 a 35,50")

    resposta = enviadas[-1][1]
    assert "confirma" in resposta.lower()
    assert "sim" in resposta.lower()
    sessao = store_mod.ler_sessao(NUMERO)
    assert sessao.get("fluxo") == "confirmacao"
    assert sessao["proposta"]["preco"] == 35.50, "o preço não pode virar 35"


def test_menu_numerado_responde_ao_que_nao_foi_entendido(client, ambiente):
    _app, store_mod, enviadas = ambiente

    postar(client, "me explica o que é CDB", message_id="m-1")

    assert "Não entendi" in enviadas[-1][1]
    assert "1. Carteira" in enviadas[-1][1]
    assert store_mod.ler_sessao(NUMERO).get("menu_mostrado") is True

    postar(client, "6", message_id="m-2")

    # Item 6 é o extrato. Com banco ele diz que não há movimentação; sem banco,
    # que não conseguiu consultar. As duas respostas provam o que o teste quer:
    # o número executou o item em vez de repetir o menu.
    resposta = enviadas[-1][1]
    assert "movimenta" in resposta or "banco de dados" in resposta, \
        "o número do menu tem de executar o item"
    assert "1. Carteira" not in resposta, "não pode repetir o menu"


def test_flag_desligada_volta_ao_agente_antigo(client, ambiente, monkeypatch):
    """`INVESTAI_ROTEADOR=0` é o rollback do deploy e precisa continuar valendo."""
    app_mod, _store, enviadas = ambiente
    from investai.agent import assistant as assistant_mod

    monkeypatch.setattr(app_mod, "ROTEADOR", False)
    monkeypatch.setattr(assistant_mod, "responder",
                        lambda *a, **k: _resposta_fake("resposta do agente"))
    monkeypatch.setattr(app_mod, "responder",
                        lambda *a, **k: _resposta_fake("resposta do agente"))

    postar(client, "como está minha carteira?")

    assert enviadas[-1][1] == "resposta do agente"
