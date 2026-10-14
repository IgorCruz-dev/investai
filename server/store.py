"""Estado do servidor em SQLite: conversas, idempotência e gastos.

SQLite porque é um assistente de uma pessoa só: zero infraestrutura, um arquivo,
e a VM da Oracle faz backup junto com o disco.
"""

from __future__ import annotations

import json
import logging
import sqlite3
import threading
from contextlib import contextmanager
from datetime import datetime, timezone
from typing import Any, Iterator

from server.config import DB_PATH

logger = logging.getLogger(__name__)

_lock = threading.Lock()

SCHEMA = """
CREATE TABLE IF NOT EXISTS conversas (
    numero      TEXT PRIMARY KEY,
    historico   TEXT NOT NULL,
    atualizado  TEXT NOT NULL
);

-- Idempotência: a Meta reenvia o webhook quando não recebe 200 a tempo.
CREATE TABLE IF NOT EXISTS mensagens_processadas (
    message_id  TEXT PRIMARY KEY,
    numero      TEXT,
    recebido    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS gastos (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    numero          TEXT,
    custo_usd       REAL NOT NULL,
    input_tokens    INTEGER DEFAULT 0,
    output_tokens   INTEGER DEFAULT 0,
    cache_tokens    INTEGER DEFAULT 0,
    criado          TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_gastos_criado ON gastos(criado);
"""


@contextmanager
def _conexao() -> Iterator[sqlite3.Connection]:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH, timeout=10)
    conn.row_factory = sqlite3.Row
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


def init() -> None:
    with _lock, _conexao() as conn:
        conn.executescript(SCHEMA)


def _agora() -> str:
    return datetime.now(timezone.utc).isoformat()


# --- Conversas --------------------------------------------------------------
def carregar_historico(numero: str) -> list[dict[str, Any]]:
    try:
        with _conexao() as conn:
            linha = conn.execute(
                "SELECT historico FROM conversas WHERE numero = ?", (numero,)
            ).fetchone()
        return json.loads(linha["historico"]) if linha else []
    except (sqlite3.Error, json.JSONDecodeError) as exc:
        logger.warning("Histórico ilegível de %s (%s) — recomeçando a conversa", numero, exc)
        return []


def salvar_historico(numero: str, historico: list[dict[str, Any]]) -> None:
    try:
        payload = json.dumps(historico, default=str, ensure_ascii=False)
    except (TypeError, ValueError) as exc:
        logger.error("Histórico não serializável para %s: %s", numero, exc)
        return
    with _lock, _conexao() as conn:
        conn.execute(
            "INSERT INTO conversas (numero, historico, atualizado) VALUES (?, ?, ?) "
            "ON CONFLICT(numero) DO UPDATE SET historico = excluded.historico, "
            "atualizado = excluded.atualizado",
            (numero, payload, _agora()),
        )


def limpar_historico(numero: str) -> None:
    with _lock, _conexao() as conn:
        conn.execute("DELETE FROM conversas WHERE numero = ?", (numero,))


# --- Idempotência -----------------------------------------------------------
def ja_processada(message_id: str) -> bool:
    """True se a mensagem já foi tratada. Registra na primeira vez que a vê."""
    if not message_id:
        return False
    with _lock, _conexao() as conn:
        try:
            conn.execute(
                "INSERT INTO mensagens_processadas (message_id, recebido) VALUES (?, ?)",
                (message_id, _agora()),
            )
            return False
        except sqlite3.IntegrityError:
            return True


# --- Gastos -----------------------------------------------------------------
def registrar_gasto(numero: str, custo_usd: float, entrada: int = 0,
                    saida: int = 0, cache: int = 0) -> None:
    with _lock, _conexao() as conn:
        conn.execute(
            "INSERT INTO gastos (numero, custo_usd, input_tokens, output_tokens, "
            "cache_tokens, criado) VALUES (?, ?, ?, ?, ?, ?)",
            (numero, float(custo_usd), entrada, saida, cache, _agora()),
        )


def gasto_do_mes() -> float:
    inicio = datetime.now(timezone.utc).replace(
        day=1, hour=0, minute=0, second=0, microsecond=0
    ).isoformat()
    try:
        with _conexao() as conn:
            linha = conn.execute(
                "SELECT COALESCE(SUM(custo_usd), 0) AS total FROM gastos WHERE criado >= ?",
                (inicio,),
            ).fetchone()
        return float(linha["total"])
    except sqlite3.Error as exc:
        logger.warning("Não foi possível somar os gastos: %s", exc)
        return 0.0


def estatisticas() -> dict[str, Any]:
    try:
        with _conexao() as conn:
            conversas = conn.execute("SELECT COUNT(*) AS n FROM conversas").fetchone()["n"]
            mensagens = conn.execute("SELECT COUNT(*) AS n FROM mensagens_processadas").fetchone()["n"]
        return {"conversas": conversas, "mensagens": mensagens, "gasto_mes_usd": round(gasto_do_mes(), 4)}
    except sqlite3.Error as exc:
        return {"erro": str(exc)}
