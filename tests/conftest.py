"""Infra dos testes.

Os testes batem nas APIs reais de propósito: mock de dados de mercado dá uma
falsa sensação de segurança. Em troca, precisamos separar dois tipos de falha:

  - **rede/API indisponível** (sem internet, rate limit, Yahoo fora) → `skip`,
    porque não há defeito no nosso código;
  - **contrato quebrado** (coluna faltando, tipo errado, exceção escapando) →
    **falha**, porque é exatamente isso que o sistema precisa suportar.
"""

from __future__ import annotations

import socket

import pytest

ONLINE_HOSTS = (("query1.finance.yahoo.com", 443), ("pypi.org", 443))


def _has_internet(timeout: float = 5.0) -> bool:
    for host, port in ONLINE_HOSTS:
        try:
            with socket.create_connection((host, port), timeout=timeout):
                return True
        except OSError:
            continue
    return False


@pytest.fixture(scope="session")
def online() -> bool:
    return _has_internet()


@pytest.fixture(scope="session")
def require_internet(online: bool) -> None:
    """Pula o teste quando não há conectividade — não é defeito do código."""
    if not online:
        pytest.skip("sem conectividade com as APIs externas")


@pytest.fixture
def skip_if_api_down():
    """Converte indisponibilidade da API em skip, preservando o motivo.

    Uso:
        prices = skip_if_api_down(market_data.get_stock_data, "PETR4.SA")
    """
    def runner(fn, *args, **kwargs):
        result = fn(*args, **kwargs)
        # `result in (...)` não serve aqui: DataFrame compara elemento a elemento.
        if hasattr(result, "empty"):
            is_empty = bool(result.empty)
        else:
            is_empty = not result
        if is_empty:
            pytest.skip(f"{fn.__name__} não devolveu dados — API externa indisponível agora")
        return result

    return runner


@pytest.fixture(autouse=True)
def isolated_cache(tmp_path, monkeypatch):
    """Cada teste usa um arquivo de cache próprio, para não contaminar os outros."""
    from src.utils import cache as cache_module

    monkeypatch.setattr(cache_module.cache, "path", tmp_path / "data_cache.json")
    return cache_module.cache
