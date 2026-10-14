"""Cliente da ponte Baileys — como o Python devolve a resposta ao WhatsApp.

A ponte roda em `127.0.0.1` e fala com o WhatsApp; aqui só postamos o texto.
Não há Cloud API, template nem janela de 24 horas: a conexão é a mesma de um
aparelho vinculado, então o assistente pode falar a qualquer momento.
"""

from __future__ import annotations

import logging

import requests

from server.config import BRIDGE_SECRET, BRIDGE_URL
from src.utils.resilience import PermanentError, retry

logger = logging.getLogger(__name__)

TIMEOUT = 30.0


@retry(attempts=3)
def _post(caminho: str, payload: dict) -> dict:
    resposta = requests.post(
        f"{BRIDGE_URL}{caminho}",
        json=payload,
        headers={"X-Bridge-Secret": BRIDGE_SECRET},
        timeout=TIMEOUT,
    )
    if resposta.status_code == 503:
        # A ponte está de pé, mas o WhatsApp não está pareado: re-tentar em
        # segundos não resolve. Falha direto, com o motivo.
        raise PermanentError("WhatsApp não conectado — pareie a ponte (bridge/) com o QR code")
    if resposta.status_code >= 500:
        raise ConnectionError(f"ponte indisponível (HTTP {resposta.status_code})")
    if resposta.status_code != 200:
        raise ValueError(f"ponte respondeu HTTP {resposta.status_code}: {resposta.text[:200]}")
    return resposta.json()


def enviar_texto(numero: str, texto: str, jid: str = "") -> bool:
    """Envia a resposta. A quebra em partes é feita pela ponte."""
    if not texto.strip():
        return False
    try:
        _post("/send", {"numero": numero, "jid": jid, "texto": texto})
        return True
    except Exception as exc:  # noqa: BLE001
        logger.error("Falha ao enviar mensagem para %s: %s", numero[:6] + "…", exc)
        return False


def status() -> dict:
    """Estado da ponte — usado em `/health` para saber se o WhatsApp está ligado."""
    try:
        resposta = requests.get(f"{BRIDGE_URL}/status", timeout=5)
        return resposta.json() if resposta.status_code == 200 else {"conectado": False}
    except Exception as exc:  # noqa: BLE001
        return {"conectado": False, "erro": str(exc)}
