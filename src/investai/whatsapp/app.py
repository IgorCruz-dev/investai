"""Servidor do assistente InvestAI.

Topologia (sem Meta, sem webhook público):

    WhatsApp ↔ ponte Baileys (Node, 127.0.0.1:8900) ↔ este servidor (Python, :8000)

A ponte recebe a mensagem e chama `POST /bridge/message`; respondemos 202 na
hora e processamos em segundo plano, porque o agente leva de 5 a 60 segundos e
não faz sentido segurar a conexão da ponte nesse tempo. A resposta volta pelo
`POST /send` da ponte.
"""

from __future__ import annotations

import contextlib
import logging
from typing import Any

from fastapi import BackgroundTasks, FastAPI, Header, HTTPException, Query
from pydantic import BaseModel, Field

from investai import tenants
from investai.agent.assistant import responder, resposta_rapida, saudacao
from investai.whatsapp import actions, bridge_client, router, store
from investai.whatsapp.config import (
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
        autorizados = tenants.telefones_autorizados()
        if tenants.multiusuario():
            logger.info("Servidor pronto | %d usuário(s): %s", len(autorizados),
                        ", ".join(t.id for t in tenants.todos()))
        else:
            logger.info("Servidor pronto | %d número(s) autorizado(s)", len(autorizados))


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
    # Em modo multiusuário o registro é a lista branca — um número fora dele não
    # tem banco para consultar, então autorizá-lo não significaria nada.
    autorizados = tenants.telefones_autorizados()
    if autorizados and numero not in autorizados:
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
    """Resolve a intenção, executa e responde pela ponte. Nunca levanta exceção.

    O usuário é resolvido **aqui**, e não em `receber()`: `BackgroundTasks`
    executa esta função noutro contexto, e um `ContextVar` setado lá fora não
    atravessaria para cá.
    """
    enviar = lambda msg: bridge_client.enviar_texto(numero, msg, jid)  # noqa: E731

    dono = tenants.por_telefone(numero)
    if dono is None and tenants.multiusuario():
        # A lista branca é o registro, então não deveria chegar aqui — mas um
        # registro editado entre `receber()` e esta linha cairia neste caso, e
        # mandar a query para um banco arbitrário é o único desfecho inaceitável.
        logger.error("Sem usuário para %s — mensagem descartada", numero[:6] + "…")
        enviar("Seu número não está cadastrado neste assistente.")
        return

    escopo = tenants.usar(dono) if dono is not None else contextlib.nullcontext()

    try:
        with escopo:
            if not ROTEADOR:
                _processar_pelo_agente(numero, texto, enviar)
                return

            sessao = store.ler_sessao(numero)
            intencao = router.resolver(texto, sessao)

            # O teto de gasto só vale para as três rotas que chamam a API.
            # Bloquear a consulta de carteira porque o briefing estourou o
            # orçamento seria punir justamente o caminho que não custa nada.
            if intencao.usa_llm:
                # Teto por pessoa: cada um gasta no próprio cartão, com o
                # teto do próprio registro. O gasto de um não bloqueia a IA do
                # outro — era o que aconteceria com um teto compartilhado.
                teto = dono.budget_usd if dono is not None else MONTHLY_BUDGET_USD
                gasto = store.gasto_do_mes(numero if dono is not None else None)
                if gasto >= teto:
                    enviar(
                        f"Atingi o limite de gasto deste mês (US$ {gasto:.2f} de "
                        f"US$ {teto:.2f}). As consultas sem IA (carteira, cotação, "
                        "extrato) continuam funcionando."
                    )
                    return
                if intencao.aviso:
                    # A rota de IA leva de 20 s a 1 min: dizer que está
                    # trabalhando evita a dúvida de "chegou minha mensagem?".
                    enviar(intencao.aviso)

            resposta = actions.executar(intencao, numero)
            enviar(resposta)
            logger.info("Respondido %s | usuário=%s | intenção=%s%s",
                        numero[:6] + "…", dono.id if dono else "padrão",
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
    destinatarios = tenants.telefones_autorizados()
    if not destinatarios:
        raise HTTPException(status_code=400, detail="nenhum número autorizado configurado")

    background.add_task(_enviar_briefing_semanal)
    return {"status": "agendado", "destinatarios": len(destinatarios)}


def _enviar_briefing_semanal() -> None:
    """Gera e manda o briefing de cada pessoa. Sem Cloud API não há janela de 24h.

    Um briefing **por carteira**: antes era um texto só, enviado a todo número
    da lista branca, o que com mais de uma pessoa significaria mandar a carteira
    de alguém para todo mundo.
    """
    from investai.agent.tools import gerar_briefing

    cabecalho = "📊 *Seu briefing semanal do InvestAI*\n\n"

    for dono in tenants.todos():
        escopo = tenants.usar(dono) if tenants.multiusuario() else contextlib.nullcontext()
        with escopo:
            try:
                texto = gerar_briefing()  # a ferramenta já trata os próprios erros
            except Exception as exc:  # noqa: BLE001
                logger.exception("Falha ao gerar o briefing de %s", dono.id)
                texto = f"Não consegui gerar o briefing desta semana ({exc.__class__.__name__})."

            if not dono.telefone:
                logger.warning("Usuário %s sem telefone — briefing não enviado", dono.id)
                continue
            if bridge_client.enviar_texto(dono.telefone, cabecalho + texto):
                logger.info("Briefing enviado para %s (%s)", dono.id, dono.telefone[:6] + "…")
            else:
                logger.error("Falha ao enviar o briefing para %s", dono.id)
