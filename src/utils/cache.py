"""Cache simples em arquivo JSON, com TTL — evita rebuscar o que já se sabe.

Guarda DataFrames e dicts na mesma estrutura. Escrita atômica e sob lock
porque as buscas rodam em paralelo (ThreadPoolExecutor) e o Streamlit pode
recarregar o script a qualquer momento.
"""

from __future__ import annotations

import json
import logging
import os
import tempfile
import threading
import time
from io import StringIO
from pathlib import Path
from typing import Any

import pandas as pd

from src.config import CACHE_PATH, CACHE_TTL

logger = logging.getLogger(__name__)


class JsonFileCache:
    """Cache chave→valor com expiração. Nunca levanta exceção para quem chama."""

    def __init__(self, path: Path | str = CACHE_PATH, ttl: int = CACHE_TTL) -> None:
        self.path = Path(path)
        self.ttl = ttl
        self._lock = threading.Lock()

    # -- API pública --------------------------------------------------------
    def get(self, key: str) -> Any | None:
        """Devolve o valor se existir e estiver fresco; `None` caso contrário."""
        with self._lock:
            entry = self._load().get(key)
        if not isinstance(entry, dict) or "ts" not in entry:
            return None
        if time.time() - float(entry["ts"]) > self.ttl:
            return None
        try:
            return self._deserialize(entry)
        except Exception as exc:  # noqa: BLE001 — cache corrompido não derruba o app
            logger.warning("Entrada de cache ilegível (%s): %s", key, exc)
            return None

    def set(self, key: str, value: Any) -> None:
        payload = self._serialize(value)
        if payload is None:
            return
        with self._lock:
            data = self._load()
            data[key] = {"ts": time.time(), **payload}
            self._save(data)

    def invalidate(self, prefix: str | None = None) -> None:
        """Remove tudo (ou só as chaves com o prefixo dado)."""
        with self._lock:
            if prefix is None:
                self._save({})
                return
            data = self._load()
            self._save({k: v for k, v in data.items() if not k.startswith(prefix)})

    def age(self, key: str) -> float | None:
        """Idade da entrada em segundos (sem checar TTL), ou `None`."""
        with self._lock:
            entry = self._load().get(key)
        if isinstance(entry, dict) and "ts" in entry:
            return time.time() - float(entry["ts"])
        return None

    # -- (de)serialização ---------------------------------------------------
    @staticmethod
    def _serialize(value: Any) -> dict | None:
        if isinstance(value, pd.DataFrame):
            return {"kind": "frame", "value": value.to_json(orient="split", date_format="iso")}
        try:
            json.dumps(value)
        except (TypeError, ValueError) as exc:
            logger.warning("Valor não serializável descartado do cache: %s", exc)
            return None
        return {"kind": "json", "value": value}

    @staticmethod
    def _deserialize(entry: dict) -> Any:
        if entry.get("kind") == "frame":
            frame = pd.read_json(StringIO(entry["value"]), orient="split")
            if "Date" in frame.columns:
                frame["Date"] = pd.to_datetime(frame["Date"])
            return frame.reset_index(drop=True)
        return entry.get("value")

    # -- disco --------------------------------------------------------------
    def _load(self) -> dict:
        try:
            return json.loads(self.path.read_text(encoding="utf-8"))
        except FileNotFoundError:
            return {}
        except (json.JSONDecodeError, OSError, UnicodeDecodeError) as exc:
            logger.warning("Cache corrompido em %s (%s) — recomeçando vazio", self.path, exc)
            return {}

    def _save(self, data: dict) -> None:
        try:
            self.path.parent.mkdir(parents=True, exist_ok=True)
            with tempfile.NamedTemporaryFile(
                "w", dir=self.path.parent, prefix=".cache-", suffix=".tmp",
                delete=False, encoding="utf-8",
            ) as handle:
                json.dump(data, handle)
                tmp_name = handle.name
            os.replace(tmp_name, self.path)  # troca atômica
        except OSError as exc:
            logger.warning("Não foi possível gravar o cache (%s): %s", self.path, exc)


#: Instância compartilhada pelos módulos de dados.
cache = JsonFileCache()
