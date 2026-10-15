"""Testes do Postgres: o replay do ledger e o acesso em `src/data/repo.py`.

O que está sob teste aqui é a afirmação central do esquema: **posição é derivada
do histórico, sempre**. Por isso os números são conferidos contra conta feita à
mão, e há um teste que apaga uma movimentação do meio do histórico e exige a
posição recomposta — é o caso em que um delta incremental erraria calado.

Precisam de um Postgres de verdade (a fixture `banco` cria um schema próprio por
teste). Sem `DATABASE_URL`, pulam com motivo, como o resto da suíte faz com API
indisponível.
"""

from __future__ import annotations

from datetime import date, timedelta

import pytest

pytestmark = pytest.mark.network

HOJE = date.today()
ONTEM = HOJE - timedelta(days=1)
ANTEONTEM = HOJE - timedelta(days=2)


def mov(repo, tipo, ticker="PETR4.SA", shares=100, preco=30.0, taxas=0.0,
        data=None, origem="whatsapp"):
    repo.garantir_ativo(ticker, classe="acao")
    return repo.registrar_movimento(repo.Movimento(
        tipo=tipo, ticker=ticker, shares=shares, preco=preco, taxas=taxas,
        data=data or HOJE, origem=origem,
    ))


def posicao(repo, ticker="PETR4.SA"):
    return next((p for p in repo.posicoes().positions if p.ticker == ticker), None)


# --- Preço médio ------------------------------------------------------------
def test_compra_unica_define_preco_medio(banco):
    mov(banco, "compra", shares=100, preco=35.50)

    p = posicao(banco)
    assert p.shares == 100
    assert p.avg_price == pytest.approx(35.50)


def test_segunda_compra_pondera_o_preco_medio(banco):
    """100 a 30 + 100 a 40 = 200 a 35. Média ponderada, não média das médias."""
    mov(banco, "compra", shares=100, preco=30.0, data=ANTEONTEM)
    mov(banco, "compra", shares=100, preco=40.0, data=ONTEM)

    p = posicao(banco)
    assert p.shares == 200
    assert p.avg_price == pytest.approx(35.0)


def test_taxas_entram_no_custo(banco):
    """100 a 30 com R$ 20 de corretagem = custo 3.020, médio 30,20.

    Taxa no custo é o critério da Receita para apurar ganho de capital — deixá-la
    de fora inflaria o lucro tributável na venda.
    """
    mov(banco, "compra", shares=100, preco=30.0, taxas=20.0)

    assert posicao(banco).avg_price == pytest.approx(30.20)


def test_quantidade_fracionaria_e_suportada(banco):
    """Fundo imobiliário e mercado fracionário não negociam lote inteiro."""
    mov(banco, "compra", ticker="HGLG11.SA", shares=7.5, preco=160.0)

    assert posicao(banco, "HGLG11.SA").shares == pytest.approx(7.5)


# --- Vendas -----------------------------------------------------------------
def test_venda_parcial_apura_resultado_e_mantem_preco_medio(banco):
    """200 a 35, vende 50 a 40: lucro 50×5 = 250, e o médio das 150 segue 35."""
    mov(banco, "compra", shares=100, preco=30.0, data=ANTEONTEM)
    mov(banco, "compra", shares=100, preco=40.0, data=ONTEM)
    mov(banco, "venda", shares=50, preco=40.0, data=HOJE)

    p = posicao(banco)
    assert p.shares == 150
    assert p.avg_price == pytest.approx(35.0), "venda não muda o preço médio"
    assert banco.resultado_realizado() == pytest.approx(250.0)


def test_venda_total_zera_a_posicao_e_preserva_o_resultado(banco):
    mov(banco, "compra", shares=100, preco=30.0, data=ONTEM)
    mov(banco, "venda", shares=100, preco=45.0, data=HOJE)

    assert posicao(banco) is None, "posição zerada não é carteira"
    assert banco.resultado_realizado() == pytest.approx(1500.0), \
        "o resultado da posição encerrada não pode se perder"


def test_prejuizo_e_registrado_com_sinal_negativo(banco):
    mov(banco, "compra", shares=100, preco=40.0, data=ONTEM)
    mov(banco, "venda", shares=100, preco=25.0, data=HOJE)

    assert banco.resultado_realizado() == pytest.approx(-1500.0)


def test_venda_acima_da_posicao_e_recusada(banco):
    """A regra mora no banco, não só na validação do aplicativo."""
    mov(banco, "compra", shares=100, preco=30.0)

    with pytest.raises(banco.ErroDeEscrita) as erro:
        mov(banco, "venda", shares=150, preco=35.0)

    assert "excede" in str(erro.value).lower()
    assert posicao(banco).shares == 100, "a posição não pode ter sido tocada"


def test_recompra_depois_de_zerar_recomeca_o_preco_medio(banco):
    mov(banco, "compra", shares=100, preco=30.0, data=ANTEONTEM)
    mov(banco, "venda", shares=100, preco=35.0, data=ONTEM)
    mov(banco, "compra", shares=50, preco=20.0, data=HOJE)

    p = posicao(banco)
    assert p.shares == 50
    assert p.avg_price == pytest.approx(20.0), "o médio antigo não contamina a nova posição"
    assert banco.resultado_realizado() == pytest.approx(500.0)


# --- Ajuste -----------------------------------------------------------------
def test_ajuste_sobrescreve_a_posicao(banco):
    """Importar posição antiga sem inventar o histórico que a formou."""
    mov(banco, "compra", shares=100, preco=30.0, data=ANTEONTEM)
    mov(banco, "ajuste", shares=120, preco=36.10, data=ONTEM)

    p = posicao(banco)
    assert p.shares == 120
    assert p.avg_price == pytest.approx(36.10)


# --- A propriedade que justifica o desenho ----------------------------------
def test_apagar_movimentacao_do_meio_recompoe_a_posicao(banco):
    """O teste que prova o desenho: corrigir o histórico corrige a posição.

    Três compras; apagar a do meio tem de deixar a posição exatamente como se
    ela nunca tivesse existido — 100 a 30 + 100 a 50 = 200 a 40.
    """
    mov(banco, "compra", shares=100, preco=30.0, data=ANTEONTEM)
    id_meio = mov(banco, "compra", shares=100, preco=40.0, data=ONTEM)
    mov(banco, "compra", shares=100, preco=50.0, data=HOJE)
    assert posicao(banco).avg_price == pytest.approx(40.0)

    assert banco.apagar_movimento(id_meio) is True

    p = posicao(banco)
    assert p.shares == 200
    assert p.avg_price == pytest.approx(40.0)
    assert banco.total_movimentacoes() == 2


def test_editar_preco_de_movimentacao_antiga_corrige_o_medio(banco):
    """Digitou 3550 onde era 35,50 três meses atrás: conserta sem refazer nada."""
    id_errado = mov(banco, "compra", shares=100, preco=3550.0)
    assert posicao(banco).avg_price == pytest.approx(3550.0)

    assert banco.editar_movimento(id_errado, {"preco": 35.50}) is True

    assert posicao(banco).avg_price == pytest.approx(35.50)


def test_ordem_do_replay_segue_a_data_do_negocio(banco):
    """Lançar hoje uma compra de anteontem recoloca o movimento no lugar certo.

    Importa porque a venda consome o custo médio **do momento da venda**: se a
    ordem fosse a de digitação, o resultado apurado sairia errado.
    """
    mov(banco, "compra", shares=100, preco=30.0, data=ANTEONTEM)
    mov(banco, "venda", shares=100, preco=40.0, data=HOJE)
    # Lançada por último, mas aconteceu no meio.
    mov(banco, "compra", shares=100, preco=50.0, data=ONTEM)

    # Replay por data: compra 100@30 → compra 100@50 (200 a 40) → venda 100@40.
    p = posicao(banco)
    assert p.shares == 100
    assert p.avg_price == pytest.approx(40.0)
    assert banco.resultado_realizado() == pytest.approx(0.0)


def test_varios_ativos_nao_se_misturam(banco):
    mov(banco, "compra", ticker="PETR4.SA", shares=100, preco=30.0)
    mov(banco, "compra", ticker="VALE3.SA", shares=50, preco=60.0)

    assert posicao(banco, "PETR4.SA").avg_price == pytest.approx(30.0)
    assert posicao(banco, "VALE3.SA").avg_price == pytest.approx(60.0)
    assert len(banco.posicoes().positions) == 2


# --- Constraints -------------------------------------------------------------
@pytest.mark.parametrize("campo,valor", [("shares", 0), ("shares", -10), ("preco", -1)])
def test_banco_recusa_valor_invalido(banco, campo, valor):
    """Rede de segurança: nem um `psql` na mão grava fora das regras."""
    kwargs = {"shares": 100, "preco": 30.0, campo: valor}

    with pytest.raises(banco.ErroDeEscrita):
        mov(banco, "compra", **kwargs)


def test_ticker_sem_catalogo_e_recusado(banco):
    with pytest.raises(banco.ErroDeEscrita):
        banco.registrar_movimento(banco.Movimento(
            tipo="compra", ticker="FANTASMA9.SA", shares=10, preco=1.0, origem="web",
        ))


# --- Extrato ----------------------------------------------------------------
def test_extrato_vem_do_mais_recente_para_o_mais_antigo(banco):
    mov(banco, "compra", shares=100, preco=30.0, data=ANTEONTEM)
    mov(banco, "compra", shares=50, preco=40.0, data=HOJE)

    extrato = banco.movimentacoes(limite=10)

    assert [float(m["preco"]) for m in extrato] == [40.0, 30.0]


def test_extrato_filtra_por_ticker(banco):
    mov(banco, "compra", ticker="PETR4.SA")
    mov(banco, "compra", ticker="VALE3.SA")

    assert len(banco.movimentacoes(ticker="PETR4.SA")) == 1


def test_desfazer_apaga_o_ultimo_registrado_nao_o_de_data_maior(banco):
    """"Desfazer" é sobre o que eu acabei de digitar, não sobre o calendário."""
    mov(banco, "compra", shares=100, preco=30.0, data=HOJE)
    id_ultimo = mov(banco, "compra", shares=50, preco=40.0, data=ANTEONTEM)

    assert banco.ultimo_movimento()["id"] == id_ultimo
    banco.apagar_movimento(id_ultimo)
    assert posicao(banco).shares == 100


# --- Perfil -----------------------------------------------------------------
def test_perfil_salva_e_le_no_formato_que_o_sistema_espera(banco):
    """`status_do_perfil` e `recomendar_carteira` leem `answers` e o derivado juntos."""
    respostas = {"horizon": "acima_10a", "knowledge": "iniciante"}
    derivado = {"profile": "Moderado", "risk_score": 68.0,
                "allocation": {"renda_fixa": 40.0, "etf": 30.0}}

    banco.salvar_perfil(respostas, derivado)
    lido = banco.perfil()

    assert lido["answers"] == respostas
    assert lido["profile"] == "Moderado"
    assert lido["allocation"]["renda_fixa"] == 40.0
    assert lido["saved_at"]


def test_salvar_perfil_duas_vezes_sobrescreve(banco):
    banco.salvar_perfil({"a": 1}, {"profile": "Conservador"})
    banco.salvar_perfil({"a": 2}, {"profile": "Arrojado"})

    assert banco.perfil()["profile"] == "Arrojado"
    assert banco.perfil()["answers"] == {"a": 2}


def test_perfil_ausente_devolve_dicionario_vazio(banco):
    assert banco.perfil() == {}


# --- Snapshots e fila -------------------------------------------------------
def test_snapshot_publicado_volta_na_leitura(banco):
    banco.publicar_snapshot({"positions": [], "totals": {"total_value": 123.45}})

    lido = banco.ultimo_snapshot()

    assert lido["totals"]["total_value"] == 123.45
    assert lido["generatedAt"], "a web mostra o horário do dado"


def test_snapshot_mais_recente_vence(banco):
    banco.publicar_snapshot({"v": 1})
    banco.publicar_snapshot({"v": 2})

    assert banco.ultimo_snapshot()["v"] == 2


def test_retencao_de_snapshots(banco):
    """0,5 GB no plano gratuito: snapshot é histórico de tela, não data lake."""
    for i in range(banco.SNAPSHOTS_RETIDOS + 5):
        banco.publicar_snapshot({"v": i})

    total = banco._executar("select count(*) as n from snapshots", buscar="um")["n"]
    assert total == banco.SNAPSHOTS_RETIDOS
    assert banco.ultimo_snapshot()["v"] == banco.SNAPSHOTS_RETIDOS + 4


def test_job_e_tomado_uma_unica_vez(banco):
    """Dois consumidores (cron e um teste) não podem pegar o mesmo job."""
    banco.enfileirar_job("briefing", {"pedido_por": "web"})

    primeiro = banco.tomar_job()
    segundo = banco.tomar_job()

    assert primeiro["tipo"] == "briefing"
    assert primeiro["pedido"]["pedido_por"] == "web"
    assert segundo is None, "job já tomado não volta para a fila"


def test_job_fechado_sai_da_contagem_de_pendentes(banco):
    id_job = banco.enfileirar_job("snapshot")
    assert banco.jobs_pendentes() == 1

    banco.tomar_job()
    banco.fechar_job(id_job, ok=True, resultado={"posicoes": 3})

    assert banco.jobs_pendentes() == 0
    estado = banco._executar("select estado, resultado from jobs where id = %s",
                             (id_job,), buscar="um")
    assert estado["estado"] == "feito"
    assert estado["resultado"]["posicoes"] == 3


# --- Catálogo ---------------------------------------------------------------
def test_garantir_ativo_nao_sobrescreve_o_que_ja_existe(banco):
    banco.garantir_ativo("PETR4.SA", "Petrobras", "acao", "Petróleo e gás", validado=True)
    banco.garantir_ativo("PETR4.SA")  # chamada "cega", sem nome nem setor

    linha = banco._executar("select * from ativos where ticker = %s",
                            ("PETR4.SA",), buscar="um")
    assert linha["nome"] == "Petrobras"
    assert linha["validado"] is True


def test_ticker_novo_entra_pendente_de_conferencia(banco):
    """A web grava otimista; só a VM tem yfinance para confirmar."""
    mov(banco, "compra", ticker="XPTO3.SA", origem="web")

    assert "XPTO3.SA" in banco.tickers_pendentes()
    assert [l["ticker"] for l in banco.ativos_a_conferir()] == ["XPTO3.SA"]

    banco.marcar_conferido("XPTO3.SA", existe=False)

    assert banco.tickers_pendentes() == []
    assert banco.tickers_invalidos() == ["XPTO3.SA"]
