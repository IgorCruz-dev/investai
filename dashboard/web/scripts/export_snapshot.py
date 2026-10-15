"""Grava `dashboard/web/data.js` — o snapshot para abrir o dashboard sem servidor.

    .venv/bin/python dashboard/web/scripts/export_snapshot.py          # carteira real
    .venv/bin/python dashboard/web/scripts/export_snapshot.py --demo   # carteira de exemplo

A lógica de montagem mora em `dashboard/web/snapshot.py`, compartilhada com o
cron que publica no Postgres para a interface na Vercel. Este script é só a
embalagem em arquivo: serve para abrir a tela offline e para conferir o visual
sem depender de banco nem de rede.
"""

from __future__ import annotations

import argparse
import json
import logging
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT))

from dashboard.web import snapshot as construtor  # noqa: E402
from src.config import Portfolio, Position, load_portfolio  # noqa: E402

logging.basicConfig(level=logging.WARNING)

SAIDA = ROOT / "dashboard" / "web" / "data.js"
BRIEFING = ROOT / "dashboard" / "web" / "scripts" / "briefing.md"

#: Carteira de demonstração do design — usada com `--demo`, para a tela ter o
#: que mostrar mesmo com a carteira real vazia.
DEMO = Portfolio(
    positions=(
        Position("PETR4.SA", 100, 35.50, "acao"),
        Position("VALE3.SA", 50, 68.00, "acao"),
        Position("ITUB4.SA", 200, 25.00, "acao"),
    ),
    currency="BRL",
)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--demo", action="store_true",
                        help="usa a carteira de exemplo em vez da sua")
    parser.add_argument("--sem-noticias", action="store_true")
    args = parser.parse_args()

    carteira = DEMO if args.demo else load_portfolio()
    if not carteira.positions:
        print("carteira vazia — use --demo para gerar o snapshot de exemplo")
        return 1

    print(f"buscando dados de {len(carteira.tickers)} ativo(s)…")
    briefing = BRIEFING.read_text(encoding="utf-8") if BRIEFING.exists() else ""
    dados = construtor.construir(carteira, com_noticias=not args.sem_noticias,
                                 briefing=briefing, use_cache=False)

    payload = json.dumps(dados, ensure_ascii=False, separators=(",", ":"), default=str)
    SAIDA.write_text(
        "/* Gerado por dashboard/web/scripts/export_snapshot.py — dados reais de mercado.\n"
        "   Em produção os dados vêm de /api/snapshot; este arquivo é o modo offline. */\n"
        f"window.INVESTAI_DATA = {payload};\n",
        encoding="utf-8",
    )
    print(f"gravado {SAIDA.relative_to(ROOT)} ({SAIDA.stat().st_size / 1024:.0f} KB)")
    print(f"  posições: {len(dados['positions'])} | evolução: {len(dados['evolution'])} dias "
          f"| notícias: {sum(len(v) for v in (dados.get('news') or {}).values())} "
          f"| briefing: {len(briefing)} chars")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
