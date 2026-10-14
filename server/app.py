"""Servidor do assistente InvestAI.

Topologia (sem Meta, sem webhook público):

    WhatsApp ↔ ponte Baileys (Node, 127.0.0.1:8900) ↔ este servidor (Python, :8000)

A ponte recebe a mensagem e chama `POST /bridge/message`; respondemos 202 na
hora e processamos em segundo plano, porque o agente leva de 5 a 60 segundos e
não faz sentido segurar a conexão da ponte nesse tempo. A resposta volta pelo
`POST /send` da ponte.
"""

from __future__ import annotations

import logging
from typing import Any

from fastapi import BackgroundTasks, FastAPI, Header, HTTPException, Query
from pydantic import BaseModel, Field

from server import bridge_client, store
from server.config import (
    ALLOWED_NUMBERS,
    BRIDGE_SECRET,
    CRON_TOKEN,
    MONTHLY_BUDGET_USD,
    configurado,
)
from src.agent.assistant import responder, resposta_rapida, saudacao

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)
logger = logging.getLogger("investai.server")

app = FastAPI(title="InvestAI", docs_url=None, redoc_url=None)

COMANDOS_AJUDA = {"/ajuda", "ajuda", "/start", "/help", "menu"}
COMANDOS_LIMPAR = {"/limpar", "/reset", "esquece tudo"}


class MensagemEntrante(BaseModel):
    numero: str = Field(min_length=8, max_length=20)
    texto: str = ""
    jid: str = ""
    message_id: str = ""


@app.on_event("startup")
def _startup() -> None:
    store.init()
    faltando = configurado()
    if faltando:
        logger.warning("Configuração incompleta — faltam: %s", ", ".join(faltando))
    else:
        logger.info("Servidor pronto | %d número(s) autorizado(s)", len(ALLOWED_NUMBERS))


@app.get("/health")
def health() -> dict[str, Any]:
    return {
        "status": "ok",
        "configuracao_faltando": configurado(),
        "orcamento_mensal_usd": MONTHLY_BUDGET_USD,
        "ponte": bridge_client.status(),
        **store.estatisticas(),
    }


# --- Mensagens --------------------------------------------------------------
@app.post("/bridge/message", status_code=202)
def receber(
    mensagem: MensagemEntrante,
    background: BackgroundTasks,
    x_bridge_secret: str | None = Header(default=None),
) -> dict[str, str]:
    if BRIDGE_SECRET and x_bridge_secret != BRIDGE_SECRET:
        logger.warning("Chamada à /bridge/message com segredo inválido")
        raise HTTPException(status_code=403, detail="segredo inválido")

    numero = "".join(c for c in mensagem.numero if c.isdigit())

    # A ponte já filtra, mas repetimos: duas trancas na porta que gasta dinheiro.
    if ALLOWED_NUMBERS and numero not in ALLOWED_NUMBERS:
        logger.warning("Mensagem de número não autorizado: %s", numero[:6] + "…")
        return {"status": "ignorado"}

    if mensagem.message_id and store.ja_processada(mensagem.message_id):
        logger.info("Mensagem %s já processada — ignorada", mensagem.message_id[:18])
        return {"status": "duplicada"}

    texto = (mensagem.texto or "").strip()
    if not texto:
        return {"status": "vazia"}

    background.add_task(_processar, numero, texto, mensagem.jid)
    return {"status": "recebido"}


def _processar(numero: str, texto: str, jid: str = "") -> None:
    """Roda o agente e devolve a resposta pela ponte. Nunca levanta exceção."""
    enviar = lambda msg: bridge_client.enviar_texto(numero, msg, jid)  # noqa: E731

    try:
        normalizado = texto.strip().lower()
        if normalizado in COMANDOS_AJUDA:
            enviar(saudacao())
            return
        if normalizado in COMANDOS_LIMPAR:
            store.limpar_historico(numero)
            enviar("Pronto, esqueci nossa conversa anterior. 🧹")
            return

        # "oi", "valeu" e afins não justificam uma chamada de modelo.
        rapida = resposta_rapida(texto)
        if rapida:
            enviar(rapida)
            logger.info("Resposta local para %s (sem custo)", numero[:6] + "…")
            return

        gasto = store.gasto_do_mes()
        if gasto >= MONTHLY_BUDGET_USD:
            enviar(
                f"Atingi o limite de gasto deste mês (US$ {gasto:.2f} de "
                f"US$ {MONTHLY_BUDGET_USD:.2f}). Para liberar, aumente "
                "INVESTAI_MONTHLY_BUDGET_USD no servidor."
            )
            return

        historico = store.carregar_historico(numero)
        resultado = responder(texto, historico)

        if resultado.ok:
            store.salvar_historico(numero, resultado.historico)
            enviar(resultado.texto)
        else:
            enviar(f"Deu problema aqui: {resultado.erro}")

        store.registrar_gasto(
            numero, resultado.custo_estimado, resultado.input_tokens,
            resultado.output_tokens, resultado.cache_read_tokens,
        )
        logger.info(
            "Respondido %s | ferramentas=%s | US$ %.4f",
            numero[:6] + "…", resultado.ferramentas_usadas or "-", resultado.custo_estimado,
        )
    except Exception:  # noqa: BLE001 — fronteira final
        logger.exception("Falha ao processar mensagem de %s", numero[:6] + "…")
        enviar("Tive um problema inesperado aqui. Pode tentar de novo?")


# --- Briefing semanal (cron) ------------------------------------------------
@app.post("/cron/briefing")
def cron_briefing(background: BackgroundTasks, token: str = Query("")) -> dict[str, Any]:
    """Dispara o briefing semanal. Protegido por token: o endpoint gasta créditos."""
    if not CRON_TOKEN or token != CRON_TOKEN:
        raise HTTPException(status_code=403, detail="token inválido")
    if not ALLOWED_NUMBERS:
        raise HTTPException(status_code=400, detail="nenhum número autorizado configurado")

    background.add_task(_enviar_briefing_semanal)
    return {"status": "agendado", "destinatarios": len(ALLOWED_NUMBERS)}


def _enviar_briefing_semanal() -> None:
    """Gera o briefing e manda. Sem Cloud API não há janela de 24h nem template."""
    from src.agent.tools import gerar_briefing

    try:
        texto = gerar_briefing()  # a ferramenta já trata os próprios erros
    except Exception as exc:  # noqa: BLE001
        logger.exception("Falha ao gerar o briefing semanal")
        texto = f"Não consegui gerar o briefing desta semana ({exc.__class__.__name__})."

    cabecalho = "📊 *Seu briefing semanal do InvestAI*\n\n"
    for numero in ALLOWED_NUMBERS:
        if bridge_client.enviar_texto(numero, cabecalho + texto):
            logger.info("Briefing semanal enviado para %s", numero[:6] + "…")
        else:
            logger.error("Falha ao enviar o briefing para %s", numero[:6] + "…")
