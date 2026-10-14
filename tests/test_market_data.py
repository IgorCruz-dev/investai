"""Testes de `src.data.market_data` contra a API real do yfinance."""

from __future__ import annotations

import time

import pandas as pd
import pytest

from src.data import market_data
from src.utils.resilience import PermanentError, Throttle, TransientError, retry, safe

VALID_TICKER = "PETR4.SA"
INVALID_TICKER = "ZZZZ99.SA"


# --- Contratos com dados reais ---------------------------------------------
@pytest.mark.network
def test_get_stock_data_ticker_valido(require_internet, skip_if_api_down):
    prices = skip_if_api_down(market_data.get_stock_data, VALID_TICKER, "6mo")

    assert list(prices.columns) == market_data.PRICE_COLUMNS
    assert len(prices) > 20, "6 meses deveriam render bem mais de 20 fechamentos"
    assert pd.api.types.is_datetime64_any_dtype(prices["Date"])
    assert prices["Date"].dt.tz is None, "a coluna Date deve vir sem timezone"
    assert prices["Date"].is_monotonic_increasing
    assert (prices["Close"] > 0).all()
    assert prices["Close"].notna().all()


@pytest.mark.network
def test_get_stock_data_ticker_invalido_retorna_dataframe_vazio(require_internet):
    prices = market_data.get_stock_data(INVALID_TICKER)

    assert isinstance(prices, pd.DataFrame)
    assert prices.empty
    # Contrato: colunas presentes mesmo vazio, para o resto do sistema não quebrar.
    assert list(prices.columns) == market_data.PRICE_COLUMNS


@pytest.mark.network
def test_get_fundamentals_nunca_levanta(require_internet):
    for ticker in (VALID_TICKER, INVALID_TICKER, "", "???"):
        result = market_data.get_fundamentals(ticker)
        assert isinstance(result, dict)


@pytest.mark.network
def test_get_fundamentals_ticker_valido_tem_campos_do_contrato(require_internet, skip_if_api_down):
    fundamentals = skip_if_api_down(market_data.get_fundamentals, VALID_TICKER)

    for field in market_data.FUNDAMENTAL_FIELDS:
        assert field in fundamentals, f"campo {field} ausente no contrato"
        value = fundamentals[field]
        assert value is None or isinstance(value, float)


@pytest.mark.network
def test_get_portfolio_data_isola_falhas(require_internet):
    bundle = market_data.get_portfolio_data([VALID_TICKER, INVALID_TICKER], period="1mo")

    assert set(bundle) == {VALID_TICKER, INVALID_TICKER}
    assert bundle[INVALID_TICKER]["prices"].empty, "ticker ruim não deve inventar dados"
    assert bundle[INVALID_TICKER]["fundamentals"] == {}
    if bundle[VALID_TICKER]["prices"].empty:
        pytest.skip("yfinance indisponível para o ticker válido agora")
    assert not bundle[VALID_TICKER]["prices"].empty, "ticker ruim não deve derrubar o bom"


def test_get_portfolio_data_carteira_vazia_nao_chama_rede():
    assert market_data.get_portfolio_data([]) == {}


def test_extract_tickers_aceita_formatos_variados():
    from src.config import Portfolio, Position

    assert market_data._extract_tickers(["petr4.sa", "VALE3.SA"]) == ["PETR4.SA", "VALE3.SA"]
    assert market_data._extract_tickers([{"ticker": "itub4.sa"}]) == ["ITUB4.SA"]
    assert market_data._extract_tickers(
        Portfolio(positions=(Position("PETR4.SA", 1, 1.0),))
    ) == ["PETR4.SA"]
    # Duplicatas colapsam, mantendo a ordem.
    assert market_data._extract_tickers(["A", "A", "B"]) == ["A", "B"]


# --- Núcleo de resiliência (offline: não há rede envolvida) -----------------
def test_retry_tenta_tres_vezes_e_embrulha_em_transient_error():
    calls = []

    @retry(attempts=3, base_delay=0, jitter=False, sleep=lambda _: None)
    def sempre_falha():
        calls.append(1)
        raise ConnectionError("rede caiu")

    with pytest.raises(TransientError):
        sempre_falha()
    assert len(calls) == 3


def test_retry_para_no_primeiro_sucesso():
    calls = []

    @retry(attempts=3, base_delay=0, jitter=False, sleep=lambda _: None)
    def falha_uma_vez():
        calls.append(1)
        if len(calls) < 2:
            raise TimeoutError("timeout")
        return "ok"

    assert falha_uma_vez() == "ok"
    assert len(calls) == 2


def test_retry_nao_insiste_em_erro_permanente():
    calls = []

    @retry(attempts=3, base_delay=0, jitter=False, sleep=lambda _: None)
    def chave_invalida():
        calls.append(1)
        raise PermanentError("401")

    with pytest.raises(PermanentError):
        chave_invalida()
    assert len(calls) == 1, "erro permanente não deve ser re-tentado"


def test_safe_converte_excecao_em_valor_padrao():
    @safe(dict)
    def explode():
        raise RuntimeError("boom")

    assert explode() == {}


def test_throttle_respeita_intervalo_minimo():
    throttle = Throttle(min_interval=0.2)
    start = time.monotonic()
    throttle.wait()
    throttle.wait()
    assert time.monotonic() - start >= 0.2
