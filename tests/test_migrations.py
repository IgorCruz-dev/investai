"""Testes do runner de migração.

O que importa: a ordem de aplicação, aplicar uma vez só, e não aplicar nada
quando o nome ou a numeração estão ambíguos. Os testes que precisam de Postgres
usam a fixture `banco` e pulam quando não há banco, como o resto da suíte.
"""

from __future__ import annotations

import pytest

from investai import migrations


def escrever(pasta, nome: str, sql: str = "select 1") -> None:
    (pasta / nome).write_text(sql, encoding="utf-8")


# --- Descoberta e ordem (sem banco) -----------------------------------------
def test_ordena_pela_versao_numerica_nao_alfabetica(tmp_path):
    """`010` vem depois de `002` — ordem alfabética erraria isso."""
    for nome in ("002_b.sql", "010_c.sql", "001_a.sql"):
        escrever(tmp_path, nome)

    assert [m.nome for m in migrations.disponiveis(tmp_path)] == [
        "001_a.sql", "002_b.sql", "010_c.sql",
    ]


def test_nome_fora_do_padrao_recusa(tmp_path):
    escrever(tmp_path, "adiciona_metas.sql")
    with pytest.raises(migrations.ErroDeMigracao, match="fora do padrão"):
        migrations.disponiveis(tmp_path)


def test_versao_duplicada_recusa(tmp_path):
    """Dois arquivos com o mesmo número aplicariam em ordem indefinida."""
    escrever(tmp_path, "002_metas.sql")
    escrever(tmp_path, "002_alertas.sql")
    with pytest.raises(migrations.ErroDeMigracao, match="duplicada"):
        migrations.disponiveis(tmp_path)


def test_o_repositorio_tem_migracoes_validas():
    """Guarda o repo de verdade: um `.sql` mal nomeado quebraria o deploy."""
    encontradas = migrations.disponiveis()
    assert encontradas, "deveria haver pelo menos a migração inicial"
    assert encontradas[0].nome == "001_initial.sql"
    assert [m.versao for m in encontradas] == sorted((m.versao for m in encontradas), key=int)


def test_hash_muda_quando_o_arquivo_muda(tmp_path):
    escrever(tmp_path, "001_a.sql", "select 1")
    antes = migrations.disponiveis(tmp_path)[0].sha256
    escrever(tmp_path, "001_a.sql", "select 2")
    assert migrations.disponiveis(tmp_path)[0].sha256 != antes


# --- Aplicação (precisa de Postgres) ----------------------------------------
@pytest.mark.network
def test_aplica_na_ordem_e_so_uma_vez(banco, tmp_path):
    import os

    url = os.environ["DATABASE_URL"]
    schema = os.environ["INVESTAI_TEST_SCHEMA"]
    escrever(tmp_path, "001_um.sql", "create table mig_um (id int)")
    escrever(tmp_path, "002_dois.sql", "create table mig_dois (id int)")

    primeira = migrations.aplicar(url, tmp_path, schema)
    assert [m.nome for m in primeira] == ["001_um.sql", "002_dois.sql"]

    # Segunda passada não tem o que fazer: é o que permite rodar no deploy
    # sem medo, e o que impede aplicar duas vezes em bancos diferentes.
    assert migrations.aplicar(url, tmp_path, schema) == []
    assert migrations.pendentes(url, tmp_path, schema) == []


@pytest.mark.network
def test_pendentes_nao_aplica_nada(banco, tmp_path):
    """O servidor usa isso no start: precisa responder sem mexer no schema."""
    import os

    url = os.environ["DATABASE_URL"]
    schema = os.environ["INVESTAI_TEST_SCHEMA"]
    escrever(tmp_path, "001_so_checagem.sql", "create table mig_nao_criar (id int)")

    assert [m.nome for m in migrations.pendentes(url, tmp_path, schema)] == ["001_so_checagem.sql"]

    import psycopg

    with psycopg.connect(url, connect_timeout=20) as conn:
        existe = conn.execute(
            "select to_regclass('mig_nao_criar') is not null"
        ).fetchone()[0]
    assert existe is False, "`pendentes()` não pode criar a tabela da migração"


@pytest.mark.network
def test_migracao_que_falha_nao_fica_registrada(banco, tmp_path):
    """Senão a próxima execução pularia uma migração que nunca rodou."""
    import os

    url = os.environ["DATABASE_URL"]
    schema = os.environ["INVESTAI_TEST_SCHEMA"]
    escrever(tmp_path, "001_ok.sql", "create table mig_ok (id int)")
    escrever(tmp_path, "002_quebrada.sql", "isso nao e sql valido")

    with pytest.raises(migrations.ErroDeMigracao, match="002_quebrada"):
        migrations.aplicar(url, tmp_path, schema)

    # A primeira continua aplicada; só a quebrada volta para a fila.
    assert [m.nome for m in migrations.pendentes(url, tmp_path, schema)] == ["002_quebrada.sql"]
