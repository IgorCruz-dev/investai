"""Aplica as migrações pendentes nos bancos.

    .venv/bin/python scripts/migrar.py                 # o banco desta máquina (.env)
    .venv/bin/python scripts/migrar.py --conferir       # só diz o que falta, não aplica
    .venv/bin/python scripts/migrar.py --todos          # todos os usuários do registro
    .venv/bin/python scripts/migrar.py --usuario kaua   # só o banco de uma pessoa
    .venv/bin/python scripts/migrar.py --registro       # o banco de REGISTRO central
    .venv/bin/python scripts/migrar.py --baseline       # banco que JÁ tem o schema:
                                                        # registra sem executar

Com um banco por pessoa, uma tabela nova precisa chegar a todos os bancos — e
quem está atrás vê erro de coluna inexistente num caminho que nem tocou. É
isso que o `--todos` resolve, e o `--conferir` responde antes de doer.
"""

from __future__ import annotations

import argparse
import logging
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

logging.basicConfig(level=logging.INFO, format="%(message)s")
log = logging.getLogger("migrar")

DIR_REGISTRO = ROOT / "deploy" / "registro"


def _tratar(nome: str, url: str, diretorio: Path | None, conferir: bool,
            baseline: bool = False) -> bool:
    """Aplica, marca ou só confere um banco. `True` quando está tudo em dia."""
    from investai import migrations

    try:
        faltando = migrations.pendentes(url, diretorio)
    except Exception as exc:  # noqa: BLE001 — um banco fora não derruba os outros
        log.error("[%s] não consegui conferir: %s", nome, exc)
        return False

    if not faltando:
        log.info("[%s] em dia", nome)
        return True

    nomes = ", ".join(m.nome for m in faltando)
    if conferir:
        log.warning("[%s] %d pendente(s): %s", nome, len(faltando), nomes)
        return False

    if baseline:
        log.info("[%s] marcando %d como aplicada(s) SEM executar: %s",
                 nome, len(faltando), nomes)
        try:
            migrations.marcar_aplicadas(url, diretorio)
        except Exception as exc:  # noqa: BLE001
            log.error("[%s] falhou: %s", nome, exc)
            return False
        return True

    log.info("[%s] aplicando %d: %s", nome, len(faltando), nomes)
    try:
        migrations.aplicar(url, diretorio)
    except Exception as exc:  # noqa: BLE001
        log.error("[%s] falhou: %s", nome, exc)
        return False
    log.info("[%s] aplicado", nome)
    return True


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--conferir", action="store_true",
                        help="só mostra o que falta, sem aplicar")
    parser.add_argument("--todos", action="store_true",
                        help="todos os usuários do registro")
    parser.add_argument("--usuario", default="", help="só o banco desta pessoa")
    parser.add_argument("--registro", action="store_true",
                        help="o banco de registro central, não os de carteira")
    parser.add_argument("--baseline", action="store_true",
                        help="banco que JÁ tem o schema: registra as pendentes sem executar")
    args = parser.parse_args()

    from investai import tenants

    if args.registro:
        url = tenants.registry_url()
        if not url:
            log.error("INVESTAI_REGISTRY_URL não configurada no .env")
            return 1
        return 0 if _tratar("registro", url, DIR_REGISTRO, args.conferir,
                            args.baseline) else 1

    alvos: list[tuple[str, str]] = []
    if args.usuario:
        escolhido = tenants.por_id(args.usuario)
        if escolhido is None:
            log.error("usuário %r não está no registro", args.usuario)
            return 1
        alvos = [(escolhido.id, escolhido.database_url)]
    elif args.todos:
        alvos = [(t.id, t.database_url) for t in tenants.todos()]
    else:
        from investai.data import repo

        url = repo.url()
        if not url:
            log.error("DATABASE_URL não configurada — rode `python -m investai.setup`")
            return 1
        alvos = [("esta máquina", url)]

    falhas = sum(0 if _tratar(n, u, None, args.conferir, args.baseline) else 1
                 for n, u in alvos)
    if falhas:
        log.error("%d banco(s) fora do dia", falhas)
    return 1 if falhas else 0


if __name__ == "__main__":
    raise SystemExit(main())
