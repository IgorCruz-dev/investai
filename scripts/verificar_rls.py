"""Confere o isolamento do investimento para o dono, outra conta e visitante.

Também exercita o caminho de escrita da aba Investimentos como `authenticated`,
que é outro caminho do verificado por `verificar_costura.py`: aquele roda como
`postgres`, que ignora RLS e tem todos os grants.

Executa tudo em uma transação revertida. Não precisa da senha do usuário.
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
            dono = conn.execute("select dono from public.instalacao").fetchone()
            if not dono:
                raise RuntimeError("cadastre a conta pessoal antes de conferir o RLS")

            ticker = f"TSTX{uuid4().int % 100:02d}.SA"
            assert conn.execute(
                "select count(*) from public.ativos where ticker = %s", (ticker,)
            ).fetchone()[0] == 0, "ticker de teste já existe"
            conn.execute("insert into public.ativos (ticker) values (%s)", (ticker,))

            conn.execute("set local role authenticated")
            conn.execute("select set_config('request.jwt.claim.sub', %s, true)", (str(dono[0]),))
            assert conn.execute("select auth.uid()").fetchone()[0] == dono[0]
            assert conn.execute(
                "select count(*) from public.ativos where ticker = %s", (ticker,)
            ).fetchone()[0] == 1
            conn.execute("insert into public.jobs (tipo) values ('snapshot')")
            print("Dono autenticado: leitura e escrita permitidas.")

            # ===== o caminho de escrita da aba =====
            # A aba grava como `authenticated`, e `recomputar_posicoes` não é
            # security definer: o gatilho apaga e reescreve `posicoes` com os
            # grants de quem inseriu a movimentação. Um grant faltando aqui
            # quebraria "registrar compra" sem aparecer em nenhum outro teste.
            meu = f"TSTW{uuid4().int % 100:02d}.SA"
            assert conn.execute(
                "select count(*) from public.ativos where ticker = %s", (meu,)
            ).fetchone()[0] == 0, "ticker de teste já existe"
            conn.execute("insert into public.ativos (ticker) values (%s)", (meu,))
            compra = conn.execute(
                "insert into public.movimentacoes "
                "(tipo, ticker, shares, preco, taxas, data, origem) "
                "values ('compra', %s, 3, 10, 1, current_date, 'web') returning id",
                (meu,),
            ).fetchone()[0]
            assert conn.execute(
                "select shares, custo_total from public.posicoes where ticker = %s", (meu,)
            ).fetchone() == (3, 31.00)
            assert conn.execute(
                "select tipo, valor from public.transacoes where movimentacao_id = %s",
                (compra,),
            ).fetchone() == ("despesa", 31.00)
            print("Dono autenticado: compra gerou posição e despesa de R$ 31,00.")

            try:
                with conn.transaction():
                    conn.execute(
                        "insert into public.movimentacoes "
                        "(tipo, ticker, shares, preco, data, origem) "
                        "values ('venda', %s, 4, 12, current_date, 'web')",
                        (meu,),
                    )
            except psycopg.errors.CheckViolation as erro:
                # A aba casa esta frase para explicar a recusa ao usuário.
                assert "excede a posição" in str(erro), erro
            else:
                raise AssertionError("o banco aceitou venda maior que a posição")
            print("Dono autenticado: venda acima da posição recusada com a frase que a aba exibe.")

            conn.execute("update public.movimentacoes set preco = 11 where id = %s", (compra,))
            assert conn.execute(
                "select valor from public.transacoes where movimentacao_id = %s", (compra,)
            ).fetchone()[0] == 34.00
            conn.execute("delete from public.movimentacoes where id = %s", (compra,))
            assert conn.execute(
                "select count(*) from public.posicoes where ticker = %s", (meu,)
            ).fetchone()[0] == 0
            print("Dono autenticado: edição e exclusão da movimentação permitidas.")

            # ===== o caminho do onboarding =====
            # O PWA grava as 18 respostas, enfileira o cálculo e depois marca o
            # plano como aceito — tudo como `authenticated`. São três tabelas e
            # três grants que nenhum outro teste toca.
            conn.execute(
                "insert into public.perfil_investidor (id, respostas, derivado) "
                "values (1, %s, '{}') on conflict (id) do update set respostas = excluded.respostas",
                ('{"financial_health": 7}',),
            )
            conn.execute(
                "update public.perfil_investidor set respostas = %s where id = 1",
                ('{"financial_health": 8}',),
            )
            conn.execute("insert into public.jobs (tipo) values ('recomendacao')")
            plano = conn.execute(
                "insert into public.planos (payload) values ('{\"posicoes\": []}') returning id"
            ).fetchone()[0]
            conn.execute(
                "update public.planos set aceito_em = now() where id = %s", (plano,)
            )
            assert conn.execute(
                "select aceito_em is not null from public.planos where id = %s", (plano,)
            ).fetchone()[0] is True
            print("Dono autenticado: perfil gravado, cálculo enfileirado e plano aceito.")

            conn.execute("select set_config('request.jwt.claim.sub', %s, true)", (str(uuid4()),))
            assert conn.execute(
                "select count(*) from public.ativos where ticker = %s", (ticker,)
            ).fetchone()[0] == 0
            assert conn.execute("select count(*) from public.jobs").fetchone()[0] == 0
            print("Outra conta: dados ocultos.")

            conn.execute("set local role anon")
            assert conn.execute(
                "select count(*) from public.ativos where ticker = %s", (ticker,)
            ).fetchone()[0] == 0
            assert conn.execute("select public.cadastro_disponivel()").fetchone()[0] is False
            print("Visitante: dados ocultos e cadastro fechado.")
        finally:
            conn.rollback()
            print("Transação revertida; nenhum dado de teste persistiu.")


if __name__ == "__main__":
    main()
