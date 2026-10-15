"""Infra dos testes.

Os testes batem nas APIs reais de propósito: mock de dados de mercado dá uma
falsa sensação de segurança. Em troca, precisamos separar dois tipos de falha:

  - **rede/API indisponível** (sem internet, rate limit, Yahoo fora) → `skip`,
    porque não há defeito no nosso código;
  - **contrato quebrado** (coluna faltando, tipo errado, exceção escapando) →
    **falha**, porque é exatamente isso que o sistema precisa suportar.
"""

from __future__ import annotations

import logging
import pathlib
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


@pytest.fixture(autouse=True)
def sem_banco_por_padrao(monkeypatch, request):
    """Esconde `DATABASE_URL` de todos os testes que não a pediram.

    `load_portfolio()` passou a preferir o Postgres quando a variável existe.
    Como o `.env` de desenvolvimento a define, sem isso toda a suíte offline
    mudaria de caminho silenciosamente ao rodar na minha máquina e passaria a
    depender de um banco remoto — o oposto do que esses testes verificam.

    Quem precisa do banco pede a fixture `banco`, que a devolve.
    """
    if "banco" in request.fixturenames:
        return
    monkeypatch.delenv("DATABASE_URL", raising=False)


@pytest.fixture
def banco(monkeypatch):
    """Banco Postgres real, isolado por schema próprio. Pula se não houver.

    Mesma convenção do resto da suíte: infraestrutura ausente é `skip` com
    motivo, contrato quebrado é falha. Cada teste recebe um schema recém-criado
    com a migração aplicada, então um teste não vê o ledger do outro.
    """
    import os
    import uuid

    url = os.getenv("DATABASE_URL")
    if not url:
        pytest.skip("DATABASE_URL não configurada — teste de banco pulado")

    try:
        import psycopg
    except ImportError:
        pytest.skip("psycopg não instalado")

    schema = f"t_{uuid.uuid4().hex[:12]}"
    sql = (pathlib.Path(__file__).resolve().parents[1] / "deploy" / "sql" / "001_inicial.sql")
    migracao = sql.read_text(encoding="utf-8")

    try:
        conexao = psycopg.connect(url, connect_timeout=15, autocommit=True)
    except Exception as exc:  # noqa: BLE001
        pytest.skip(f"banco indisponível ({exc.__class__.__name__})")

    with conexao:
        with conexao.cursor() as cur:
            cur.execute(f'create schema "{schema}"')
            cur.execute(f'set search_path to "{schema}"')
            # `begin/commit` do arquivo brigam com autocommit; o schema já isola.
            cur.execute(migracao.replace("begin;", "").replace("commit;", ""))

    from src.data import repo

    separador = "&" if "?" in url else "?"
    monkeypatch.setenv("DATABASE_URL", f"{url}{separador}options=-csearch_path%3D{schema}")
    repo.reset_pool()

    yield repo

    repo.reset_pool()
    try:
        with psycopg.connect(url, connect_timeout=15, autocommit=True) as limpeza:
            limpeza.execute(f'drop schema "{schema}" cascade')
    except Exception:  # noqa: BLE001 — schema órfão não invalida o teste
        logging.getLogger(__name__).warning("não foi possível apagar o schema %s", schema)
