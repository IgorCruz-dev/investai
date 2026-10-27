"""Aplica as migrações legadas pendentes no banco desta instalação.

    .venv/bin/python scripts/migrar.py                 # o banco desta máquina (.env)
    .venv/bin/python scripts/migrar.py --conferir       # só diz o que falta, não aplica
    .venv/bin/python scripts/migrar.py --baseline       # banco que JÁ tem o schema:
                                                        # registra sem executar

As migrações do PWA ficam em `supabase/migrations` e seguem outro fluxo.
"""

from __future__ import annotations

import argparse
import logging
import sys
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

logging.basicConfig(level=logging.INFO, format="%(message)s")
log = logging.getLogger("migrar")

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
    parser.add_argument("--baseline", action="store_true",
                        help="banco que JÁ tem o schema: registra as pendentes sem executar")
    args = parser.parse_args()

    from investai.data import repo

    url = repo.url()
    if not url:
        log.error("DATABASE_URL não configurada — rode `python -m investai.setup`")
        return 1
    host = urlparse(url).hostname or ""
    if host.endswith((".supabase.co", ".supabase.com")):
        log.error("Este runner é legado. Use `python scripts/aplicar_supabase.py` no Supabase.")
        return 1
    return 0 if _tratar("esta máquina", url, None, args.conferir, args.baseline) else 1


if __name__ == "__main__":
    raise SystemExit(main())
