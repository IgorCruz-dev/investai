"""Verifica compra → despesa, edição e exclusão em transação revertida.

Roda contra o Supabase de `DATABASE_URL`. Não deixa usuário, ativo, movimento
nem lançamento de teste no banco.
"""

from __future__ import annotations

from pathlib import Path
from uuid import uuid4

import psycopg
from dotenv import dotenv_values

ROOT = Path(__file__).resolve().parents[1]


def main() -> None:
    url = dotenv_values(ROOT / ".env").get("DATABASE_URL")
    if not url:
        raise RuntimeError("DATABASE_URL ausente")

    with psycopg.connect(url, connect_timeout=10, prepare_threshold=None) as conn:
        try:
            cadastro_aberto = conn.execute("select public.cadastro_disponivel()").fetchone()[0]
            if cadastro_aberto:
                usuario = uuid4()
                conn.execute(
                    "insert into auth.users (id, email, encrypted_password) values (%s, %s, '')",
                    (usuario, f"costura-{usuario}@example.invalid"),
                )
            else:
                usuario = conn.execute("select dono from public.instalacao").fetchone()[0]
                assert conn.execute("select count(*) from auth.users").fetchone()[0] == 1
            assert conn.execute("select public.cadastro_disponivel()").fetchone()[0] is False
            assert conn.execute("select public.meu_usuario()").fetchone()[0] == usuario
            try:
                with conn.transaction():
                    conn.execute(
                        "insert into auth.users (id, email, encrypted_password) values (%s, %s, '')",
                        (uuid4(), f"outra-conta-{usuario}@example.invalid"),
                    )
            except psycopg.errors.CheckViolation:
                pass
            else:
                raise AssertionError("o banco aceitou uma segunda conta")
            try:
                with conn.transaction():
                    conn.execute("delete from auth.users where id = %s", (usuario,))
            except psycopg.errors.ForeignKeyViolation:
                pass
            else:
                raise AssertionError("a exclusão do dono liberou a carteira antiga")
            print("Cadastro: segunda conta recusada e dono protegido contra exclusão acidental.")
            assert conn.execute(
                "select count(*) from public.ativos where ticker = 'TEST3.SA'"
            ).fetchone()[0] == 0, "TEST3.SA já existe no catálogo"
            conn.execute("insert into public.ativos (ticker) values ('TEST3.SA')")
            movimento = conn.execute(
                "insert into public.movimentacoes "
                "(tipo, ticker, shares, preco, taxas, data, origem) "
                "values ('compra', 'TEST3.SA', 2, 10.50, 0.50, current_date, 'web') "
                "returning id"
            ).fetchone()[0]

            def lancamento():
                return conn.execute(
                    "select t.tipo, t.valor, t.user_id, c.nome "
                    "from public.transacoes t left join public.categorias c on c.id = t.categoria_id "
                    "where t.movimentacao_id = %s",
                    (movimento,),
                ).fetchone()

            assert lancamento() == ("despesa", 21.50, usuario, "Investimento")
            posicao = conn.execute(
                "select shares, custo_total from public.posicoes where ticker = 'TEST3.SA'"
            ).fetchone()
            assert posicao == (2, 21.50)
            print("Compra: despesa de R$ 21,50 e posição criadas corretamente.")

            id_lancamento = conn.execute(
                "select id from public.transacoes where movimentacao_id = %s", (movimento,)
            ).fetchone()[0]
            for comando in (
                "update public.transacoes set valor = 1 where id = %s",
                "delete from public.transacoes where id = %s",
            ):
                try:
                    with conn.transaction():
                        conn.execute(comando, (id_lancamento,))
                except psycopg.errors.CheckViolation:
                    pass
                else:
                    raise AssertionError("edição direta do lançamento foi aceita")
            print("Proteção: edição e exclusão diretas do lançamento recusadas.")

            conn.execute("update public.movimentacoes set preco = 11 where id = %s", (movimento,))
            assert lancamento()[1] == 22.50
            print("Edição: lançamento atualizado para R$ 22,50.")

            conn.execute("delete from public.movimentacoes where id = %s", (movimento,))
            assert lancamento() is None
            assert conn.execute(
                "select count(*) from public.posicoes where ticker = 'TEST3.SA'"
            ).fetchone()[0] == 0
            print("Exclusão: lançamento e posição removidos.")

            antigo = conn.execute(
                "insert into public.movimentacoes "
                "(tipo, ticker, shares, preco, data, origem) "
                "values ('compra', 'TEST3.SA', 1, 9, current_date, 'onboarding') "
                "returning id"
            ).fetchone()[0]
            assert conn.execute(
                "select count(*) from public.transacoes where movimentacao_id = %s",
                (antigo,),
            ).fetchone()[0] == 0
            print("Onboarding: posição sem despesa retroativa.")
        finally:
            conn.rollback()
            print("Transação revertida; nenhum dado de teste persistiu.")


if __name__ == "__main__":
    main()
