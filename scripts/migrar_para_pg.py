"""Prepara o Postgres: aplica o esquema, semeia o catálogo e sobe o que existe em disco.

    .venv/bin/python scripts/migrar_para_pg.py            # aplica e semeia
    .venv/bin/python scripts/migrar_para_pg.py --conferir  # só mostra o estado

Repetível de propósito: a migração é idempotente, a semeadura não sobrescreve o
que já está lá, e as posições do JSON só sobem se o ledger ainda estiver vazio —
rodar duas vezes não duplica compra nenhuma.
"""

from __future__ import annotations

import argparse
import logging
import sys
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from src.analysis.screener import UNIVERSE  # noqa: E402
from src.config import PORTFOLIO_PATH, PROFILE_PATH, load_portfolio, load_profile  # noqa: E402
from src.data import repo  # noqa: E402
from src.utils.formatters import money  # noqa: E402

logging.basicConfig(level=logging.INFO, format="%(message)s")
log = logging.getLogger("migracao")

SQL = ROOT / "deploy" / "sql" / "001_inicial.sql"


def aplicar_esquema() -> None:
    """Roda a migração. Idempotente: `create table if not exists` em tudo."""
    import psycopg

    with psycopg.connect(repo.url(), connect_timeout=20, autocommit=True) as conn:
        conn.execute(SQL.read_text(encoding="utf-8"))
    log.info("esquema aplicado (%s)", SQL.relative_to(ROOT))


def semear_ativos() -> int:
    """Põe os 38 ativos do universo curado no catálogo.

    `validado=True`: são os papéis que o screener consulta no yfinance todo dia,
    então a existência deles já está provada em produção. Ticker que você comprar
    fora dessa lista entra como não validado e o cron confere.
    """
    novos = 0
    for ativo in UNIVERSE:
        antes = repo._executar("select 1 from ativos where ticker = %s",
                               (ativo.ticker,), buscar="um")
        repo.garantir_ativo(ativo.ticker, ativo.name, ativo.asset_class,
                            ativo.sector, validado=True)
        if not antes:
            novos += 1
    log.info("catálogo: %d ativos (%d novos)", len(UNIVERSE), novos)
    return novos


def subir_carteira_do_json() -> int:
    """Converte `config/portfolio.json` em movimentações de ajuste.

    Vira `ajuste` e não `compra` porque o arquivo guarda o **estado** (cotas e
    preço médio), não o histórico que o formou. Inventar datas de compra para
    reconstruir um histórico que nunca foi registrado produziria um extrato
    falso — o ajuste diz a verdade: "a posição começa aqui, com este preço médio".
    """
    if repo.total_movimentacoes() > 0:
        log.info("ledger já tem movimentação — carteira do JSON não foi tocada")
        return 0

    # `path` explícito: queremos o arquivo, não o banco que acabamos de criar.
    carteira = load_portfolio(PORTFOLIO_PATH)
    if not carteira.positions:
        log.info("carteira em %s está vazia — nada a subir", PORTFOLIO_PATH.name)
        return 0

    subidas = 0
    for posicao in carteira.positions:
        if posicao.avg_price is None:
            log.warning("  %s ignorada: posição planejada, sem preço de compra",
                        posicao.ticker)
            continue
        repo.garantir_ativo(posicao.ticker, classe=posicao.asset_class)
        repo.registrar_movimento(repo.Movimento(
            tipo="ajuste", ticker=posicao.ticker, shares=posicao.shares,
            preco=posicao.avg_price, data=date.today(), origem="migracao",
            nota=f"posição importada de {PORTFOLIO_PATH.name}",
        ))
        log.info("  %s: %g cotas a %s", posicao.ticker, posicao.shares,
                 money(posicao.avg_price))
        subidas += 1
    return subidas


def subir_perfil_do_json() -> bool:
    perfil_arquivo = load_profile(PROFILE_PATH)
    if not perfil_arquivo.get("answers"):
        log.info("perfil em %s não existe ou está incompleto — nada a subir",
                 PROFILE_PATH.name)
        return False
    if repo.perfil().get("answers"):
        log.info("perfil já está no banco — não sobrescrito")
        return False

    respostas = perfil_arquivo.pop("answers")
    repo.salvar_perfil(respostas, perfil_arquivo)
    log.info("perfil subido: %s", perfil_arquivo.get("profile", "?"))
    return True


def conferir() -> None:
    carteira = repo.posicoes()
    log.info("")
    log.info("Estado do banco")
    log.info("  ativos no catálogo ...: %d",
             repo._executar("select count(*) as n from ativos", buscar="um")["n"])
    log.info("  movimentações ........: %d", repo.total_movimentacoes())
    log.info("  posições com cotas ...: %d", len(carteira.positions))
    for posicao in carteira.positions:
        log.info("      %s: %g cotas, preço médio %s",
                 posicao.ticker, posicao.shares, money(posicao.avg_price))
    log.info("  resultado realizado ..: %s", money(repo.resultado_realizado()))
    log.info("  perfil ...............: %s",
             repo.perfil().get("profile") or "não respondido")
    log.info("  snapshots ............: %d",
             repo._executar("select count(*) as n from snapshots", buscar="um")["n"])
    log.info("  jobs pendentes .......: %d", repo.jobs_pendentes())


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--conferir", action="store_true",
                        help="só mostra o estado, sem escrever nada")
    args = parser.parse_args()

    if not repo.configurado():
        log.error("DATABASE_URL não está no .env — nada a fazer.")
        return 1

    try:
        if args.conferir:
            conferir()
            return 0

        aplicar_esquema()
        semear_ativos()
        subir_carteira_do_json()
        subir_perfil_do_json()
        conferir()
    except Exception as exc:  # noqa: BLE001 — script de operação
        log.error("falhou: %s: %s", exc.__class__.__name__, exc)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
