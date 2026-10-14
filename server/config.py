"""Configuração do servidor do assistente — tudo por variável de ambiente."""

from __future__ import annotations

import os
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent.parent
load_dotenv(ROOT / ".env")

# --- Ponte Baileys ----------------------------------------------------------
BRIDGE_URL = os.getenv("BRIDGE_URL", "http://127.0.0.1:8900").rstrip("/")
#: Segredo compartilhado entre a ponte (Node) e o servidor (Python).
BRIDGE_SECRET = os.getenv("BRIDGE_SECRET", "")

#: Números autorizados a conversar (só dígitos, com DDI). A ponte também filtra,
#: mas repetimos aqui: se alguém chamar o servidor direto, a trava continua de pé.
ALLOWED_NUMBERS = {
    "".join(c for c in n if c.isdigit())
    for n in os.getenv("WHATSAPP_ALLOWED_NUMBERS", "").split(",")
    if n.strip()
}

# --- Operação ---------------------------------------------------------------
DB_PATH = Path(os.getenv("INVESTAI_DB", ROOT / "cache" / "investai.db"))
CRON_TOKEN = os.getenv("INVESTAI_CRON_TOKEN", "")
MONTHLY_BUDGET_USD = float(os.getenv("INVESTAI_MONTHLY_BUDGET_USD", "5"))


def configurado() -> list[str]:
    """O que falta configurar — aparece em `/health` e no start do servidor."""
    faltando = []
    if not BRIDGE_SECRET:
        faltando.append("BRIDGE_SECRET")
    if not ALLOWED_NUMBERS:
        faltando.append("WHATSAPP_ALLOWED_NUMBERS")
    if not CRON_TOKEN:
        faltando.append("INVESTAI_CRON_TOKEN")
    return faltando
