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
import os
from typing import Any

from fastapi import BackgroundTasks, FastAPI, Header, HTTPException, Query
from pydantic import BaseModel, Field

from investai.agent.assistant import responder, resposta_rapida, saudacao
from investai.whatsapp import actions, bridge_client, router, store
from investai.whatsapp.config import (
    ALLOWED_NUMBERS,
    BRIDGE_SECRET,
    CRON_TOKEN,
    MONTHLY_BUDGET_USD,
    ROTEADOR,
    configurado,
)

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
        _conferir_migracoes()


def _conferir_migracoes() -> None:
    """Avisa no start quando o Supabase está atrás nas migrações do PWA."""
    from investai import migrations

    url = os.getenv("DATABASE_URL")
    if not url:
        return
    try:
        faltando = migrations.pendentes(url, migrations.ROOT / "supabase" / "migrations")
    except Exception as exc:  # noqa: BLE001 — diagnóstico não derruba o start
        logger.warning("Não consegui conferir as migrações: %s", exc)
        return
    if faltando:
        logger.warning("Banco atrás: falta(m) %s. Rode `python scripts/aplicar_supabase.py`.",
                       ", ".join(m.nome for m in faltando))


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
    if numero not in ALLOWED_NUMBERS:
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
    """Resolve a intenção, executa e responde pela ponte. Nunca levanta exceção."""
    enviar = lambda msg: bridge_client.enviar_texto(numero, msg, jid)  # noqa: E731

    if numero not in ALLOWED_NUMBERS:
        logger.warning("Número não autorizado na fila: %s", numero[:6] + "…")
        return

    try:
        if not ROTEADOR:
            _processar_pelo_agente(numero, texto, enviar)
            return

        sessao = store.ler_sessao(numero)
        intencao = router.resolver(texto, sessao)

        # O teto de gasto só vale para as rotas que chamam a API.
        if intencao.usa_llm:
            gasto = store.gasto_do_mes()
            if gasto >= MONTHLY_BUDGET_USD:
                enviar(
                    f"Atingi o limite de gasto deste mês (US$ {gasto:.2f} de "
                    f"US$ {MONTHLY_BUDGET_USD:.2f}). As consultas sem IA "
                    "(carteira, cotação, extrato) continuam funcionando."
                )
                return
            if intencao.aviso:
                enviar(intencao.aviso)

        resposta = actions.executar(intencao, numero)
        enviar(resposta)
        logger.info("Respondido %s | intenção=%s%s", numero[:6] + "…",
                    intencao.nome, " (IA)" if intencao.usa_llm else " (custo zero)")
    except Exception:  # noqa: BLE001 — fronteira final
        logger.exception("Falha ao processar mensagem de %s", numero[:6] + "…")
        enviar("Tive um problema inesperado aqui. Pode tentar de novo?")


def _processar_pelo_agente(numero: str, texto: str, enviar) -> None:
    """Caminho antigo: tudo pelo agente com as 8 ferramentas.

    Mantido como rollback do deploy: `INVESTAI_ROTEADOR=0` no `.env` e um
    restart voltam ao comportamento que estava em produção antes do router.
    """
    normalizado = texto.strip().lower()
    if normalizado in COMANDOS_AJUDA:
        enviar(saudacao())
        return
    if normalizado in COMANDOS_LIMPAR:
        store.limpar_historico(numero)
        enviar("Pronto, esqueci nossa conversa anterior. 🧹")
        return

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


# --- Briefing semanal (cron) ------------------------------------------------
@app.post("/cron/briefing")
def cron_briefing(background: BackgroundTasks, token: str = Query("")) -> dict[str, Any]:
    """Dispara o briefing semanal. Protegido por token: o endpoint gasta créditos."""
    if not CRON_TOKEN or token != CRON_TOKEN:
        raise HTTPException(status_code=403, detail="token inválido")
    destinatarios = ALLOWED_NUMBERS
    if not destinatarios:
        raise HTTPException(status_code=400, detail="nenhum número autorizado configurado")

    background.add_task(_enviar_briefing_semanal)
    return {"status": "agendado", "destinatarios": len(destinatarios)}


def _enviar_briefing_semanal() -> None:
    """Gera o briefing da carteira pessoal e o envia aos números autorizados."""
    from investai.agent.tools import gerar_briefing

    cabecalho = "📊 *Seu briefing semanal do InvestAI*\n\n"

    def gerar(rotulo: str) -> str:
        try:
            return gerar_briefing()  # a ferramenta já trata os próprios erros
        except Exception as exc:  # noqa: BLE001
            logger.exception("Falha ao gerar o briefing de %s", rotulo)
            return f"Não consegui gerar o briefing desta semana ({exc.__class__.__name__})."

    texto = gerar("instância pessoal")
    for numero in sorted(ALLOWED_NUMBERS):
        if bridge_client.enviar_texto(numero, cabecalho + texto):
            logger.info("Briefing semanal enviado para %s", numero[:6] + "…")
        else:
            logger.error("Falha ao enviar o briefing para %s", numero[:6] + "…")
