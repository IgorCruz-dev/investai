"""Aplica, em ordem, as migrações de `supabase/migrations` no projeto novo.

    .venv/bin/python scripts/aplicar_supabase.py --conferir
    .venv/bin/python scripts/aplicar_supabase.py

Usa `DATABASE_URL` do `.env`. Recusa host fora do Supabase e schema já criado
sem histórico de migração, para não reaplicar o Money em uma base existente.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path
from urllib.parse import urlparse

from dotenv import dotenv_values

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from investai import migrations  # noqa: E402

PASTA = ROOT / "supabase" / "migrations"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--conferir", action="store_true", help="lista as pendentes sem aplicá-las")
    args = parser.parse_args()

    url = dotenv_values(ROOT / ".env").get("DATABASE_URL") or ""
    host = urlparse(url).hostname or ""
    if not host.endswith((".supabase.co", ".supabase.com")):
        print("DATABASE_URL precisa apontar para o Postgres do projeto Supabase novo.", file=sys.stderr)
        return 1

    try:
        import psycopg

        with psycopg.connect(url, connect_timeout=10, prepare_threshold=None) as conn:
            existe = conn.execute("select to_regclass('public.schema_migrations') is not null").fetchone()[0]
            money = conn.execute("select to_regclass('public.perfis') is not null").fetchone()[0]
            if money and not existe:
                print("O schema do Money já existe sem histórico de migração. Confira o estado antes de aplicar.", file=sys.stderr)
                return 1

        pendentes = migrations.pendentes(url, PASTA)
        with psycopg.connect(url, connect_timeout=10, prepare_threshold=None) as conn:
            conn.execute("alter table public.schema_migrations enable row level security")
        print(f"{len(pendentes)} migração(ões) pendente(s):")
        for m in pendentes:
            print(f"  {m.nome}")
        if args.conferir or not pendentes:
            return 0

        aplicadas = migrations.aplicar(url, PASTA)
        print(f"{len(aplicadas)} migração(ões) aplicada(s).")
        return 0
    except Exception as exc:  # noqa: BLE001 — não imprimir a URI nem a senha
        print(f"Falha: {exc.__class__.__name__}: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
