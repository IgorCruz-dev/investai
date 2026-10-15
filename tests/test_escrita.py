"""Testes da escrita: validação em camadas e confirmação antes de gravar.

A propriedade central: **nada é gravado na primeira mensagem**. Toda escrita
produz uma `Proposta`, que vira texto de confirmação, e só o "sim" aplica. Os
testes aqui cobrem o que precisa ser recusado, o que precisa ser avisado (e não
recusado) e o que acontece depois do "sim".
"""

from __future__ import annotations

from datetime import date, timedelta

import pytest

from src.portfolio import escrita

HOJE = date.today()


def montar(**kwargs):
    """`conferir_mercado=False` por padrão: estes testes não são sobre o yfinance."""
    kwargs.setdefault("conferir_mercado", False)
    return escrita.montar(**kwargs)


# --- Camada 1: formato e faixa (sem rede, sem banco) ------------------------
def test_compra_valida_vira_proposta():
    p = montar(tipo="compra", ticker="petr4", shares="100", preco="35,50")

    assert p.ok
    assert p.ticker == "PETR4.SA"
    assert p.shares == 100
    assert p.preco == 35.50
    assert p.total == pytest.approx(3550.0)
    assert p.data == HOJE


def test_preco_com_ponto_decimal_tambem_vale():
    """O teclado numérico do celular entrega ponto, não vírgula."""
    assert montar(tipo="compra", ticker="petr4", shares="100", preco="35.50").preco == 35.50


def test_milhar_com_ponto_nao_virar_centavo():
    """`3.550` são três mil e quinhentos e cinquenta, não três e cinquenta e cinco."""
    assert montar(tipo="compra", ticker="petr4", shares="1", preco="3.550").preco == 3550.0


@pytest.mark.parametrize("shares,motivo", [
    ("0", "maior que zero"),
    ("-10", "maior que zero"),
    ("abc", "quantidade"),
    ("", "quantidade"),
])
def test_quantidade_invalida_e_recusada(shares, motivo):
    p = montar(tipo="compra", ticker="petr4", shares=shares, preco="30")

    assert not p.ok
    assert motivo in p.erro.lower()


@pytest.mark.parametrize("preco", ["0", "-5"])
def test_preco_invalido_e_recusado(preco):
    p = montar(tipo="compra", ticker="petr4", shares="100", preco=preco)

    assert not p.ok and "maior que zero" in p.erro


def test_quantidade_absurda_e_recusada():
    p = montar(tipo="compra", ticker="petr4", shares="99999999999", preco="30")

    assert not p.ok and "não parece real" in p.erro


def test_ticker_vazio_e_recusado():
    assert "código do ativo" in montar(tipo="compra", ticker="", shares="1", preco="1").erro


def test_preco_faltante_nao_e_erro_e_sim_pergunta():
    """Esquecer o preço é comum; inventá-lo seria pior que perguntar."""
    p = montar(tipo="compra", ticker="petr4", shares="100", preco=None)

    assert p.erro == "FALTA_PRECO"
    assert p.ticker == "PETR4.SA" and p.shares == 100


# --- Datas ------------------------------------------------------------------
def test_data_curta_assume_o_ano_corrente():
    p = montar(tipo="compra", ticker="petr4", shares="1", preco="1", data="12/10")

    assert p.data == date(HOJE.year, 10, 12)


def test_data_no_futuro_e_recusada():
    """Registro é de negócio que já aconteceu."""
    amanha = (HOJE + timedelta(days=1)).strftime("%d/%m/%Y")
    p = montar(tipo="compra", ticker="petr4", shares="1", preco="1", data=amanha)

    assert not p.ok and "futuro" in p.erro


def test_data_ilegivel_e_recusada_com_exemplo():
    p = montar(tipo="compra", ticker="petr4", shares="1", preco="1", data="ontem")

    assert not p.ok and "12/10" in p.erro


# --- Camada 2: posição disponível (precisa de banco) ------------------------
def _comprar(banco, shares=100, preco=30.0, ticker="PETR4.SA"):
    banco.garantir_ativo(ticker, classe="acao")
    return banco.registrar_movimento(banco.Movimento(
        tipo="compra", ticker=ticker, shares=shares, preco=preco, origem="whatsapp"))


@pytest.mark.network
def test_venda_sem_posicao_e_recusada(banco):
    p = montar(tipo="venda", ticker="petr4", shares="100", preco="40")

    assert not p.ok
    assert "não tem" in p.erro.lower() and "comprei" in p.erro


@pytest.mark.network
def test_venda_acima_da_posicao_e_recusada_antes_da_confirmacao(banco):
    """O banco também recusaria, mas aqui a mensagem vem antes do "sim"."""
    _comprar(banco, shares=100)

    p = montar(tipo="venda", ticker="petr4", shares="150", preco="40")

    assert not p.ok
    assert "100" in p.erro and "150" in p.erro


@pytest.mark.network
def test_venda_dentro_da_posicao_calcula_o_resultado_na_confirmacao(banco):
    _comprar(banco, shares=100, preco=30.0)

    p = montar(tipo="venda", ticker="petr4", shares="50", preco="40")
    texto = escrita.texto_confirmacao(p)

    assert p.ok
    assert "Resultado apurado" in texto
    assert "500,00" in texto, "50 cotas × (40 − 30) = R$ 500"


@pytest.mark.network
def test_compra_em_posicao_existente_mostra_o_novo_preco_medio(banco):
    _comprar(banco, shares=100, preco=30.0)

    p = montar(tipo="compra", ticker="petr4", shares="100", preco="40")
    texto = escrita.texto_confirmacao(p)

    assert "200" in texto and "35,00" in texto, "o texto antecipa 200 cotas a R$ 35"


@pytest.mark.network
def test_remocao_diz_quantas_linhas_vao_embora(banco):
    """Destrutivo: a confirmação tem de dizer exatamente o que se perde."""
    _comprar(banco, shares=100)
    _comprar(banco, shares=50, preco=40.0)

    p = montar(tipo="remocao", ticker="petr4")
    texto = escrita.texto_confirmacao(p)

    assert p.movimentacoes_afetadas == 2
    assert "2 movimenta" in texto
    assert "não tem volta" in texto.lower()
    assert "vendi" in texto, "precisa apontar o caminho certo para quem vendeu"


@pytest.mark.network
def test_remocao_de_ativo_ausente_e_recusada(banco):
    assert "não está na sua carteira" in montar(tipo="remocao", ticker="petr4").erro


# --- Camada 4: sanidade do preço (avisa, não recusa) ------------------------
@pytest.mark.network
def test_preco_muito_fora_do_mercado_gera_aviso_nao_recusa(banco, require_internet):
    """35,50 digitado como 3550 é o erro clássico. Avisar é melhor que recusar:
    preço fora do mercado é suspeito, não impossível (compra antiga, por exemplo)."""
    p = escrita.montar(tipo="compra", ticker="petr4", shares="100", preco="3550")

    if p.preco_mercado is None:
        pytest.skip("cotação indisponível agora — não dá para comparar")
    assert p.ok, "preço suspeito não bloqueia, só avisa"
    assert any("vírgula" in a for a in p.avisos)
    assert "⚠️" in escrita.texto_confirmacao(p)


@pytest.mark.network
def test_preco_coerente_com_o_mercado_nao_gera_aviso(banco, require_internet):
    from src.data import market_data

    precos = market_data.get_stock_data("PETR4.SA")
    if precos.empty:
        pytest.skip("cotação indisponível agora")
    atual = float(precos["Close"].dropna().iloc[-1])

    p = escrita.montar(tipo="compra", ticker="petr4", shares="100", preco=str(atual))

    assert p.ok and not p.avisos


@pytest.mark.network
def test_ticker_inexistente_e_recusado(banco, require_internet):
    p = escrita.montar(tipo="compra", ticker="XXXX9", shares="100", preco="30")

    if p.erro.startswith("Não encontrei"):
        assert "PETR4" in p.erro, "a recusa precisa ensinar o formato certo"
    else:
        pytest.skip("yfinance não respondeu de forma conclusiva agora")


# --- Gravação (depois do "sim") ---------------------------------------------
@pytest.mark.network
def test_aplicar_grava_e_confirma_com_a_posicao_nova(banco, monkeypatch):
    monkeypatch.setattr(escrita, "_espelhar", lambda: None)
    p = montar(tipo="compra", ticker="petr4", shares="100", preco="35,50")

    texto = escrita.aplicar(p, origem="whatsapp")

    assert "registrada" in texto and "#" in texto
    assert "35,50" in texto
    posicao = banco.posicoes().positions[0]
    assert posicao.ticker == "PETR4.SA" and posicao.avg_price == pytest.approx(35.50)


@pytest.mark.network
def test_aplicar_classifica_etf_pelo_universo_curado(banco, monkeypatch):
    """BOVA11 é ETF no screener; a classe não pode virar "acao" por omissão."""
    monkeypatch.setattr(escrita, "_espelhar", lambda: None)

    escrita.aplicar(montar(tipo="compra", ticker="bova11", shares="10", preco="130"))

    assert banco.posicoes().positions[0].asset_class == "etf"


@pytest.mark.network
def test_aplicar_remocao_apaga_o_historico(banco, monkeypatch):
    monkeypatch.setattr(escrita, "_espelhar", lambda: None)
    _comprar(banco, shares=100)

    texto = escrita.aplicar(montar(tipo="remocao", ticker="petr4"))

    assert "Removi" in texto
    assert banco.posicoes().positions == ()
    assert banco.total_movimentacoes("PETR4.SA") == 0


@pytest.mark.network
def test_espelho_em_json_acompanha_a_gravacao(banco, tmp_path, monkeypatch):
    """O espelho é o que mantém o Streamlit local e a leitura degradada de pé."""
    import src.config as config_mod

    espelho = tmp_path / "portfolio.json"
    monkeypatch.setattr(config_mod, "PORTFOLIO_PATH", espelho)

    escrita.aplicar(montar(tipo="compra", ticker="petr4", shares="100", preco="35,50"))

    assert espelho.exists()
    salva = config_mod.load_portfolio(espelho)
    assert salva.positions[0].ticker == "PETR4.SA"
    assert salva.positions[0].avg_price == pytest.approx(35.50)


# --- Serialização da proposta (vai e volta da sessão em SQLite) -------------
def test_proposta_sobrevive_a_ida_e_volta_pela_sessao():
    """A proposta é guardada como JSON entre a pergunta e o "sim"."""
    original = montar(tipo="compra", ticker="petr4", shares="100", preco="35,50",
                      data="12/10")
    original.avisos.append("⚠️ teste")

    recriada = escrita.Proposta.from_dict(original.as_dict())

    assert recriada.tipo == original.tipo
    assert recriada.ticker == original.ticker
    assert recriada.shares == original.shares
    assert recriada.preco == original.preco
    assert recriada.data == original.data
    assert recriada.avisos == original.avisos
    assert recriada.total == original.total
