"""Testes do roteador: a tabela de intenções e a garantia de custo zero.

Duas coisas sob teste, e a segunda é a razão de o módulo existir:

1. **a tabela** — cada jeito natural de pedir cada coisa resolve na intenção
   certa, incluindo sem acento e com pontuação, que é como se escreve no celular;
2. **o custo** — nenhuma rota marcada como sem IA pode chamar o modelo. O teste
   substitui as três funções que falam com a Anthropic por `pytest.fail`, então
   uma regressão que mande "minha carteira" para o agente de novo quebra aqui, e
   não na fatura.

`resolver()` é puro, então tudo isto roda offline, em milissegundos.
"""

from __future__ import annotations

import pytest

from investai.whatsapp.router import MENU, POR_NUMERO, normalizar_texto, resolver

SEM_SESSAO: dict = {}


def nome(texto: str, sessao: dict | None = None) -> str:
    return resolver(texto, sessao if sessao is not None else SEM_SESSAO).nome


# --- Normalização -----------------------------------------------------------
@pytest.mark.parametrize("entrada,esperado", [
    ("Qual é a COTAÇÃO da PETR4??", "qual e a cotacao da petr4"),
    ("Não  entendi...", "nao entendi"),
    ("ALOCAÇÃO", "alocacao"),
    ("  ", ""),
])
def test_normalizacao(entrada, esperado):
    assert normalizar_texto(entrada) == esperado


# --- A tabela de roteamento -------------------------------------------------
#: Frase do usuário → intenção esperada. Escritas como eu escreveria de verdade:
#: sem acento, sem maiúscula, com abreviação.
TABELA = [
    # ajuda e menu
    ("/ajuda", "ajuda"), ("ajuda", "ajuda"), ("menu", "ajuda"),
    ("/start", "ajuda"), ("o que voce faz", "ajuda"), ("comandos", "ajuda"),

    # carteira
    ("/carteira", "carteira"), ("carteira", "carteira"),
    ("minha carteira", "carteira"), ("como esta minha carteira?", "carteira"),
    ("como ta a carteira", "carteira"), ("quanto eu tenho", "carteira"),
    ("meu patrimonio", "carteira"), ("posicoes", "carteira"),
    ("quanto eu ja ganhei", "carteira"), ("meus investimentos", "carteira"),
    ("meu resultado", "carteira"),

    # cotação
    ("/cotacao PETR4", "cotacao"), ("cotacao de petr4", "cotacao"),
    ("quanto esta a vale3?", "cotacao"), ("quanto ta itub4", "cotacao"),
    ("preco de bova11", "cotacao"), ("cotacao de petr4 e vale3", "cotacao"),
    ("PETR4", "cotacao"), ("petr4 vale3", "cotacao"),

    # análise (IA)
    ("/analise PETR4", "analise"), ("analisa petr4", "analise"),
    ("analisa a petr4 pra mim", "analise"),
    ("o que voce acha de vale3", "analise"),
    ("vale a pena comprar itub4", "analise"),
    ("avalia bbas3", "analise"),

    # briefing (IA, com confirmação)
    ("/briefing", "confirmar_briefing"), ("briefing", "confirmar_briefing"),
    ("me manda o briefing da semana", "confirmar_briefing"),
    ("analise da semana", "confirmar_briefing"),

    # pergunta livre (IA)
    ("/pergunta itub4 ou bbas3 pra dividendos?", "pergunta"),

    # notícias
    ("/noticias", "noticias"), ("noticias", "noticias"),
    ("o que saiu sobre petr4", "noticias"),
    ("o que saiu sobre meus ativos", "noticias"),
    ("novidades", "noticias"),

    # escrita
    ("comprei 100 petr4 a 35,50", "movimento"),
    ("comprei 100 PETR4 a 35.50", "movimento"),
    ("compra 100 petr4 35,50", "movimento"),
    ("comprei 10 itub4 a 25 em 12/10", "movimento"),
    ("vendi 50 vale3 a 68", "movimento"),
    ("vendi 50 vale3", "movimento"),
    ("comprei 7,5 hglg11 a 160", "movimento"),
    ("/ajustar petr4 120 36,10", "ajustar"),
    ("corrige petr4 120 36,10", "ajustar"),
    ("/remover petr4", "remover"),
    ("remove petr4 da carteira", "remover"),
    ("zera vale3", "remover"),
    ("/desfazer", "desfazer"), ("desfazer", "desfazer"),
    ("apaga a ultima", "desfazer"),

    # extrato
    ("/extrato", "extrato"), ("extrato", "extrato"),
    ("movimentacoes", "extrato"), ("historico de compras", "extrato"),
    ("minhas compras", "extrato"), ("o que eu comprei", "extrato"),

    # perfil, alocação, sugestão
    ("/perfil", "perfil"), ("qual o meu perfil", "perfil"),
    ("perfil de risco", "perfil"), ("sou conservador?", "perfil"),
    ("/alocacao", "alocacao"), ("alocacao", "alocacao"),
    ("o que falta", "alocacao"), ("reserva de emergencia", "alocacao"),
    ("quanto devo ter em cada classe", "alocacao"),
    ("/sugestao", "sugestao"), ("o que eu deveria comprar", "sugestao"),
    ("monta uma carteira", "sugestao"), ("onde invisto", "sugestao"),
    ("sugestao de carteira", "sugestao"),

    # onboarding
    ("/onboarding", "onboarding"), ("questionario", "onboarding"),
    ("refazer o perfil", "onboarding"), ("mudou minha situacao", "onboarding"),

    # operação
    ("/status", "status"), ("status", "status"),
    ("quanto eu gastei", "status"), ("ta tudo no ar?", "status"),
    ("/web", "web"), ("link do dashboard", "web"),
    ("/limpar", "limpar"), ("esquece tudo", "limpar"),

    # saudação (resposta local, já existente)
    ("oi", "saudacao"), ("bom dia", "saudacao"), ("valeu", "saudacao"),
    ("obrigado", "saudacao"),

    # nada casou
    ("me explica o que é selic", "nao_entendi"),
    ("asdfghjkl", "nao_entendi"),
    ("", "vazia"),
]


@pytest.mark.parametrize("frase,esperado", TABELA, ids=[f[0] or "vazio" for f in TABELA])
def test_tabela_de_roteamento(frase, esperado):
    assert nome(frase) == esperado


def test_a_tabela_cobre_todas_as_intencoes_executaveis():
    """Rede de proteção contra comando novo sem teste.

    Se alguém acrescentar uma intenção ao executor e esquecer de roteá-la, isso
    aparece aqui em vez de aparecer no celular.
    """
    from investai.whatsapp.actions import ACOES

    roteadas = {esperado for _frase, esperado in TABELA}
    # Intenções que só existem dentro de um fluxo com sessão.
    contextuais = {"confirmar", "cancelar", "informar_preco",
                   "onboarding_resposta", "briefing"}
    sem_teste = set(ACOES) - roteadas - contextuais

    assert not sem_teste, f"intenções sem frase na tabela: {sorted(sem_teste)}"


# --- O que é IA e o que não é -----------------------------------------------
#: As únicas três rotas que podem chamar a API da Anthropic.
COM_IA = {"analise", "briefing", "pergunta"}


@pytest.mark.parametrize("frase,esperado", TABELA, ids=[f[0] or "vazio" for f in TABELA])
def test_so_as_rotas_de_ia_marcam_usa_llm(frase, esperado):
    intencao = resolver(frase, SEM_SESSAO)
    assert intencao.usa_llm is (intencao.nome in COM_IA), (
        f'"{frase}" resolveu em {intencao.nome} com usa_llm={intencao.usa_llm}')


def test_confirmar_briefing_ainda_nao_e_chamada_de_ia():
    """Pedir o briefing não gasta: o gasto começa no "sim"."""
    intencao = resolver("me manda o briefing", SEM_SESSAO)

    assert intencao.nome == "confirmar_briefing"
    assert intencao.usa_llm is False


@pytest.fixture
def banco_de_sessao(tmp_path, monkeypatch):
    """SQLite temporário: algumas ações gravam sessão (menu mostrado, pendência)."""
    monkeypatch.setenv("INVESTAI_DB", str(tmp_path / "sessao.db"))
    import importlib

    from investai.whatsapp import config as config_mod
    importlib.reload(config_mod)
    from investai.whatsapp import store as store_mod
    importlib.reload(store_mod)
    store_mod.init()
    return store_mod


def test_nenhuma_rota_barata_chama_o_modelo(monkeypatch, banco_de_sessao):
    """O teste que paga a conta: executa TODA rota sem IA com a API minada.

    As três funções que falam com a Anthropic são substituídas por `pytest.fail`.
    Qualquer caminho que escorregue para o modelo explode aqui.
    """
    import investai.whatsapp.actions as actions_mod
    from investai.agent import assistant
    from investai.analysis import asset_analysis, briefing

    def proibido(*a, **k):
        pytest.fail("rota sem IA chamou a API da Anthropic")

    monkeypatch.setattr(assistant, "responder", proibido)
    monkeypatch.setattr(asset_analysis, "gerar", proibido)
    monkeypatch.setattr(briefing, "montar", proibido)

    chamadas: list[str] = []
    monkeypatch.setattr(actions_mod, "ACOES",
                        {k: (lambda n, a, _k=k: chamadas.append(_k) or "ok")
                         for k in actions_mod.ACOES})

    for frase, _esperado in TABELA:
        intencao = resolver(frase, SEM_SESSAO)
        if intencao.usa_llm:
            continue
        actions_mod.executar(intencao, "5516999990000")

    assert chamadas, "o teste precisa ter executado alguma ação"


# --- Sessão: confirmação ----------------------------------------------------
CONFIRMACAO = {"fluxo": "confirmacao", "proposta": {"tipo": "compra"}}


@pytest.mark.parametrize("resposta", [
    "sim", "s", "Sim!", "isso", "ok", "confirma", "pode", "manda", "claro", "1", "👍",
])
def test_sim_confirma_a_pendencia(resposta):
    assert nome(resposta, CONFIRMACAO) == "confirmar"


@pytest.mark.parametrize("resposta", [
    "nao", "não", "n", "cancela", "Cancelar", "esquece", "2", "errado",
])
def test_nao_cancela_a_pendencia(resposta):
    assert nome(resposta, CONFIRMACAO) == "cancelar"


def test_outra_mensagem_descarta_a_pendencia_em_vez_de_prender(nao_importa=None):
    """O usuário nunca fica preso numa pergunta que não quer responder."""
    intencao = resolver("minha carteira", CONFIRMACAO)

    assert intencao.nome == "carteira"
    assert intencao.args.get("pendencia_descartada") is True


def test_sim_sem_pendencia_nao_confirma_nada():
    """"sim" solto não pode gravar: sem contexto, não é confirmação de nada."""
    assert nome("sim") != "confirmar"


def test_numero_solto_responde_ao_menu_so_depois_do_menu():
    assert nome("1", {"menu_mostrado": True}) == "carteira"
    assert nome("7", {"menu_mostrado": True}) == "perfil"
    # Sem menu mostrado, "7" não é escolha de menu.
    assert nome("7") == "nao_entendi"


def test_todo_item_do_menu_tem_destino():
    from investai.whatsapp.actions import ACOES
    from investai.whatsapp.router import PEDIDOS

    for numero, rotulo, destino in MENU:
        assert destino in ACOES or destino in PEDIDOS or destino == "briefing", \
            f"item {numero} ({rotulo}) aponta para {destino}, que não existe"
    assert len(POR_NUMERO) == len(MENU), "número de menu duplicado"


# --- Sessão: preço faltante -------------------------------------------------
FALTA_PRECO = {"fluxo": "confirmacao", "etapa": "falta_preco",
               "proposta": {"tipo": "compra", "ticker": "PETR4.SA", "shares": 100}}


def test_numero_solto_e_lido_como_preco_quando_e_ele_que_falta():
    """"35,50" não pode cair nos padrões de comando nem descartar a proposta."""
    intencao = resolver("35,50", FALTA_PRECO)

    assert intencao.nome == "informar_preco"
    assert intencao.args["preco"] == "35,50"


def test_mercado_tambem_responde_o_preco_faltante():
    assert nome("mercado", FALTA_PRECO) == "informar_preco"


def test_nao_cancela_mesmo_faltando_o_preco():
    assert nome("cancela", FALTA_PRECO) == "cancelar"


# --- Sessão: onboarding engole tudo -----------------------------------------
ONBOARDING = {"fluxo": "onboarding", "idx": 3, "respostas": {}}


@pytest.mark.parametrize("resposta", ["1", "3500", "2,4", "voltar", "sim", "petr4"])
def test_no_onboarding_toda_mensagem_e_resposta(resposta):
    """Dentro do questionário, "1" é a opção 1 — não o item 1 do menu."""
    intencao = resolver(resposta, ONBOARDING)

    assert intencao.nome == "onboarding_resposta"
    assert intencao.args["resposta"] == resposta
    assert intencao.usa_llm is False


# --- Extração de argumentos -------------------------------------------------
def test_movimento_extrai_tipo_quantidade_ticker_preco_e_data():
    args = resolver("comprei 100 petr4 a 35,50 em 12/10").args

    assert args["tipo"] == "compra"
    assert args["ticker"] == "PETR4.SA"
    assert args["shares"] == "100"
    assert args["preco"] == "35,50"
    assert args["data"] == "12/10"


def test_venda_e_reconhecida_como_venda():
    assert resolver("vendi 50 vale3 a 68").args["tipo"] == "venda"


def test_movimento_sem_preco_nao_perde_o_resto():
    args = resolver("comprei 100 petr4").args

    assert args["tipo"] == "compra" and args["shares"] == "100"
    assert args["preco"] is None, "o preço faltante é perguntado, não inventado"


def test_cotacao_de_varios_ativos_extrai_todos():
    assert resolver("cotacao de petr4, vale3 e itub4").args["tickers"] == \
        ["PETR4.SA", "VALE3.SA", "ITUB4.SA"]


def test_analise_sem_ticker_pede_o_ticker_sem_chamar_ia():
    intencao = resolver("analisa pra mim")

    assert intencao.nome == "falta_ticker"
    assert intencao.usa_llm is False
    assert "PETR4" in intencao.texto


def test_cotacao_sem_ticker_pede_o_ticker():
    assert nome("qual a cotacao?") == "falta_ticker"


def test_pergunta_vazia_explica_o_custo_sem_gastar():
    intencao = resolver("/pergunta")

    assert intencao.nome == "falta_pergunta"
    assert intencao.usa_llm is False
    assert "0,03" in intencao.texto


def test_ticker_solto_oferece_a_analise_mas_entrega_a_cotacao():
    """Ambíguo entre cotação e análise: entrega o grátis e oferece o pago."""
    intencao = resolver("petr4")

    assert intencao.nome == "cotacao"
    assert intencao.usa_llm is False
    assert intencao.args["oferecer_analise"] is True


def test_frase_longa_com_ticker_nao_vira_cotacao_automatica():
    """"me explica por que a petr4 subiu" não é pedido de cotação."""
    intencao = resolver("me explica por que a petr4 subiu tanto esse mes")

    assert intencao.nome == "nao_entendi"
    assert intencao.usa_llm is False
