"""Dados de mercado via yfinance.

O yfinance é uma biblioteca não oficial: pode mudar de forma, devolver campos
ausentes ou bloquear por IP. Toda função pública daqui é blindada — devolve
valor padrão em vez de levantar exceção — e passa por cache, throttle e retry.

Superfície verificada no yfinance 1.7.0:
  - `Ticker.history(period=...)` → DataFrame com DatetimeIndex chamado "Date"
    (tz-aware) e colunas Open/High/Low/Close/Adj Close/Volume/Dividends/Stock Splits.
  - Ticker inválido → DataFrame **vazio** (sem exceção) e `get_info()` quase vazio.
"""

from __future__ import annotations

import logging
from collections.abc import Iterable, Sequence
from concurrent.futures import ThreadPoolExecutor
from typing import Any

import pandas as pd
import yfinance as yf

from investai.config import DEFAULT_PERIOD, MAX_WORKERS, YF_MIN_INTERVAL, Portfolio
from investai.utils.cache import cache
from investai.utils.resilience import Throttle, retry, safe

logger = logging.getLogger(__name__)

# O yfinance loga 404 de ticker inexistente direto no stderr; nós já emitimos
# uma mensagem clara, então silenciamos o ruído dele.
logging.getLogger("yfinance").setLevel(logging.CRITICAL)

PRICE_COLUMNS = ["Date", "Open", "High", "Low", "Close", "Volume"]

#: Campos de fundamentals que tentamos extrair → chave no nosso dicionário.
FUNDAMENTAL_FIELDS = {
    "pe_ratio": ("trailingPE", "forwardPE"),
    "eps": ("trailingEps", "forwardEps"),
    "revenue": ("totalRevenue",),
    "net_income": ("netIncomeToCommon",),
    "debt_to_equity": ("debtToEquity",),
    "market_cap": ("marketCap",),
    "dividend_yield": ("dividendYield",),
}

_throttle = Throttle(YF_MIN_INTERVAL)


def empty_prices() -> pd.DataFrame:
    """DataFrame vazio com o mesmo contrato de colunas do caso de sucesso."""
    return pd.DataFrame(columns=PRICE_COLUMNS)


def _normalize(raw: pd.DataFrame) -> pd.DataFrame:
    """Índice tz-aware → coluna `Date` ingênua; mantém só as colunas do contrato."""
    frame = raw.reset_index()
    if "Date" not in frame.columns:
        for candidate in ("Datetime", "index", "date"):
            if candidate in frame.columns:
                frame = frame.rename(columns={candidate: "Date"})
                break
    if "Date" not in frame.columns:
        logger.warning("Histórico sem coluna de data: %s", list(frame.columns))
        return empty_prices()

    frame["Date"] = pd.to_datetime(frame["Date"], errors="coerce")
    if getattr(frame["Date"].dtype, "tz", None) is not None:
        frame["Date"] = frame["Date"].dt.tz_localize(None)

    missing = [c for c in PRICE_COLUMNS if c not in frame.columns]
    if missing:
        logger.warning("Histórico sem as colunas %s", missing)
        return empty_prices()

    return (
        frame[PRICE_COLUMNS]
        .dropna(subset=["Date", "Close"])
        .sort_values("Date")
        .reset_index(drop=True)
    )


@retry(attempts=3)
def _fetch_history(ticker: str, period: str) -> pd.DataFrame:
    _throttle.wait()
    return yf.Ticker(ticker).history(period=period, auto_adjust=False)


@safe(empty_prices, message="Falha ao buscar histórico")
def get_stock_data(ticker: str, period: str = DEFAULT_PERIOD, use_cache: bool = True) -> pd.DataFrame:
    """Histórico OHLCV de `ticker`.

    Devolve DataFrame com `Date, Open, High, Low, Close, Volume`. Ticker
    inválido ou falha de rede ⇒ DataFrame vazio (mesmas colunas) e log claro.
    """
    key = f"prices:{ticker}:{period}"
    if use_cache:
        cached = cache.get(key)
        if isinstance(cached, pd.DataFrame) and not cached.empty:
            logger.debug("Histórico de %s servido do cache", ticker)
            return cached

    raw = _fetch_history(ticker, period)
    if raw is None or raw.empty:
        logger.warning("Nenhum dado para '%s' — ticker inválido ou sem histórico "
                       "(use o sufixo .SA para papéis da B3)", ticker)
        return empty_prices()

    prices = _normalize(raw)
    if not prices.empty:
        cache.set(key, prices)
    return prices


@retry(attempts=3)
def _fetch_info(ticker: str) -> dict:
    _throttle.wait()
    return yf.Ticker(ticker).get_info() or {}


@safe(dict, message="Falha ao buscar fundamentals")
def get_fundamentals(ticker: str, use_cache: bool = True) -> dict[str, Any]:
    """Fundamentals de `ticker`; campos indisponíveis vêm como `None`.

    Nunca levanta exceção: falha total devolve `{}`.
    """
    key = f"fundamentals:{ticker}"
    if use_cache:
        cached = cache.get(key)
        if isinstance(cached, dict) and cached:
            return cached

    info = _fetch_info(ticker)
    if not isinstance(info, dict) or len(info) <= 1:
        # Ticker inexistente devolve um dict quase vazio em vez de erro.
        logger.warning("Fundamentals indisponíveis para '%s'", ticker)
        return {}

    fundamentals: dict[str, Any] = {"name": info.get("longName") or info.get("shortName")}
    for field, candidates in FUNDAMENTAL_FIELDS.items():
        value = None
        for candidate in candidates:
            raw_value = info.get(candidate)
            if raw_value is not None:
                try:
                    value = float(raw_value)
                except (TypeError, ValueError):
                    value = None
                break
        fundamentals[field] = value
    fundamentals["currency"] = info.get("currency")

    cache.set(key, fundamentals)
    return fundamentals


def get_portfolio_data(
    portfolio: Portfolio | Sequence[str] | Iterable[Any],
    period: str = DEFAULT_PERIOD,
    use_cache: bool = True,
) -> dict[str, dict[str, Any]]:
    """Busca preços + fundamentals de toda a carteira em paralelo.

    Aceita um `Portfolio`, uma lista de tickers ou de dicts com `ticker`.
    Devolve `{ticker: {"prices": DataFrame, "fundamentals": dict}}`. Uma
    posição que falha entra com DataFrame vazio sem afetar as outras.
    """
    tickers = _extract_tickers(portfolio)
    if not tickers:
        return {}

    results: dict[str, dict[str, Any]] = {t: {"prices": empty_prices(), "fundamentals": {}} for t in tickers}

    with ThreadPoolExecutor(max_workers=max(1, MAX_WORKERS)) as pool:
        futures = {}
        for ticker in tickers:
            futures[pool.submit(get_stock_data, ticker, period, use_cache)] = ("prices", ticker)
            futures[pool.submit(get_fundamentals, ticker, use_cache)] = ("fundamentals", ticker)

        for future, (kind, ticker) in futures.items():
            try:
                results[ticker][kind] = future.result()
            except Exception as exc:  # noqa: BLE001 — já blindado, isto é cinto duplo
                logger.error("Busca de %s (%s) falhou: %s", ticker, kind, exc)

    return results


def _extract_tickers(portfolio: Any) -> list[str]:
    if isinstance(portfolio, Portfolio):
        return portfolio.tickers
    tickers: list[str] = []
    for item in portfolio or []:
        if isinstance(item, str):
            tickers.append(item.strip().upper())
        elif isinstance(item, dict) and item.get("ticker"):
            tickers.append(str(item["ticker"]).strip().upper())
        elif hasattr(item, "ticker"):
            tickers.append(str(item.ticker).strip().upper())
    return [t for t in dict.fromkeys(tickers) if t]


def probe(ticker: str = "PETR4.SA") -> bool:
    """Checagem barata de disponibilidade do yfinance (para o status na sidebar)."""
    try:
        frame = get_stock_data(ticker, period="5d", use_cache=False)
        return not frame.empty
    except Exception:  # noqa: BLE001
        return False
