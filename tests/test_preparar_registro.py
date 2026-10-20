"""Testes da montagem das connection strings do registro.

Trocar usuário e senha numa URL e acrescentar `-pooler` ao host parece trivial,
mas é onde um erro silencioso dói mais: a pessoa do outro lado recebe uma string
que não conecta e não tem como saber o motivo. Em especial, perder a query
(`?sslmode=require`) faz o Neon recusar a conexão com uma mensagem que não
aponta para a causa.
"""

from __future__ import annotations

import importlib.util
from pathlib import Path

import pytest

RAIZ = Path(__file__).resolve().parents[1]
URL = ("postgresql://neondb_owner:npg_segredo@ep-cool-name-12345.sa-east-1"
       ".aws.neon.tech/neondb?sslmode=require")


@pytest.fixture(scope="module")
def pr():
    """Carrega o script por caminho: `scripts/` não é pacote importável."""
    caminho = RAIZ / "scripts" / "preparar_registro.py"
    spec = importlib.util.spec_from_file_location("preparar_registro", caminho)
    modulo = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(modulo)
    return modulo


# --- Credenciais ------------------------------------------------------------
def test_troca_usuario_e_senha_preservando_o_resto(pr):
    nova = pr.trocar_credenciais(URL, "investai_inscricao", "uma-senha-qualquer")
    assert nova.startswith("postgresql://investai_inscricao:")
    assert "ep-cool-name-12345.sa-east-1.aws.neon.tech" in nova
    assert nova.endswith("/neondb?sslmode=require")


def test_a_senha_de_dono_nao_sobra_na_string_de_inscricao(pr):
    """O vazamento mais caro possível aqui: entregar a credencial de dono."""
    nova = pr.trocar_credenciais(URL, "investai_inscricao", "outra-senha")
    assert "npg_segredo" not in nova
    assert "neondb_owner" not in nova


def test_senha_com_simbolo_e_escapada(pr):
    """`/`, `+` e `=` numa senha quebrariam o parsing da URL se forem crus."""
    nova = pr.trocar_credenciais(URL, "investai_inscricao", "a/b+c=d")
    assert "a%2Fb%2Bc%3Dd" in nova
    assert "a/b+c=d" not in nova

    from urllib.parse import unquote, urlsplit

    assert unquote(urlsplit(nova).password) == "a/b+c=d"


def test_porta_explicita_sobrevive(pr):
    com_porta = URL.replace(".neon.tech/", ".neon.tech:5432/")
    nova = pr.trocar_credenciais(com_porta, "investai_inscricao", "senha")
    assert ":5432/" in nova


# --- Pooler -----------------------------------------------------------------
def test_pooler_entra_no_primeiro_rotulo_do_host(pr):
    assert "ep-cool-name-12345-pooler.sa-east-1.aws.neon.tech" in pr.com_pooler(URL)


def test_pooler_preserva_a_query(pr):
    """Sem `sslmode=require` o Neon recusa, e o erro não aponta para a causa."""
    assert pr.com_pooler(URL).endswith("?sslmode=require")


def test_pooler_e_idempotente(pr):
    """Rodar o script duas vezes não pode gerar `-pooler-pooler`."""
    uma = pr.com_pooler(URL)
    assert pr.com_pooler(uma) == uma
    assert "-pooler-pooler" not in uma


def test_pooler_mantem_usuario_e_senha(pr):
    nova = pr.com_pooler(URL)
    assert "neondb_owner:npg_segredo@" in nova
