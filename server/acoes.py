"""Execução das intenções do roteador — o trabalho que o `resolver()` não faz.

Separado do roteador de propósito: `resolver()` é puro e testável sem rede, e é
aqui que mora o I/O. Quase toda ação é uma chamada às funções que já existem em
`src/agent/tools.py` — elas são `BetaFunctionTool`, mas continuam sendo função
Python normal e podem ser chamadas direto, sem modelo nenhum no meio. Era o
caminho mais curto para custo zero sem reescrever formatação que já está em
produção e testada.
"""

from __future__ import annotations

import logging
from datetime import date, datetime, timezone
from typing import Any

from server import bridge_client, store
from server.config import MONTHLY_BUDGET_USD, WEB_URL
from server.roteador import Intencao, texto_do_menu
from src.agent import tools
from src.data import repo
from src.portfolio import escrita
from src.utils.formatters import money, number, percent
from src.utils.tickers import curto

logger = logging.getLogger(__name__)


def executar(intencao: Intencao, numero: str) -> str:
    """Roda a intenção e devolve o texto para enviar. Nunca levanta exceção."""
    nome = intencao.nome
    args = intencao.args

    if intencao.texto:
        if nome in ("nao_entendi", "vazia"):
            store.gravar_sessao(numero, {"menu_mostrado": True}, store.TTL_FLUXO)
        return intencao.texto

    try:
        acao = ACOES.get(nome)
        if acao is None:
            logger.error("Intenção sem ação: %s", nome)
            return texto_do_menu("Não consegui tratar isso. 🤔")
        resposta = acao(numero, args)
    except repo.SemBanco as exc:
        logger.warning("banco indisponível em %s: %s", nome, exc)
        return ("Não consegui falar com o banco de dados agora. "
                "A consulta de mercado continua funcionando — tente em instantes.")
    except repo.ErroDeEscrita as exc:
        return f"O banco recusou: {exc}"
    except Exception as exc:  # noqa: BLE001 — fronteira: nada vaza para o celular
        logger.exception("Falha ao executar %s", nome)
        return f"Deu problema aqui ao tratar isso ({exc.__class__.__name__}). Pode tentar de novo?"

    if args.get("pendencia_descartada"):
        resposta = "_(descartei a confirmação que estava pendente)_\n\n" + resposta
    return resposta


# --- Leitura ----------------------------------------------------------------
def _ajuda(numero: str, args: dict) -> str:
    store.gravar_sessao(numero, {"menu_mostrado": True}, store.TTL_FLUXO)
    return texto_do_menu("Sou o *InvestAI*, seu assistente de investimentos.")


def _carteira(numero: str, args: dict) -> str:
    texto = tools.consultar_carteira()
    pendentes = _avisos_de_catalogo()
    return texto + pendentes


def _avisos_de_catalogo() -> str:
    """Avisa sobre ticker que entrou pela web e o cron ainda não confirmou."""
    try:
        invalidos = repo.tickers_invalidos()
        pendentes = repo.tickers_pendentes()
    except Exception:  # noqa: BLE001
        return ""
    avisos = []
    if invalidos:
        avisos.append(f"⚠️ Não encontrei no mercado: {', '.join(curto(t) for t in invalidos)}. "
                      "Confira o código.")
    if pendentes:
        avisos.append(f"_{len(pendentes)} ticker(s) aguardando conferência no mercado._")
    return ("\n\n" + "\n".join(avisos)) if avisos else ""


def _cotacao(numero: str, args: dict) -> str:
    codigos = args.get("tickers") or []
    texto = tools.cotacao(", ".join(codigos))
    if args.get("oferecer_analise") and len(codigos) == 1:
        texto += (f"\n\n_Quer a leitura completa? Manda */analise {curto(codigos[0])}* "
                  "— usa IA e custa ~US$ 0,02._")
    return texto


def _noticias(numero: str, args: dict) -> str:
    return tools.buscar_noticias(args.get("ticker") or "")


def _perfil(numero: str, args: dict) -> str:
    texto = tools.status_do_perfil()
    if "Nenhum perfil salvo" in texto:
        return ("Você ainda não respondeu o questionário de perfil.\n\n"
                "São 18 perguntas, em 4 blocos, e dá para parar no meio e voltar depois. "
                "Sem ele eu não tenho base para falar de alocação.\n\n"
                "Manda */onboarding* quando quiser começar.")
    return texto


def _alocacao(numero: str, args: dict) -> str:
    """Alocação-alvo contra a real, e o que ainda falta antes de investir."""
    perfil = repo.perfil()
    if not perfil.get("profile"):
        return ("Preciso do seu perfil para falar de alocação-alvo. "
                "Manda */onboarding* — são 18 perguntas.")

    alvo = perfil.get("allocation") or {}
    linhas = [f"*Alocação-alvo* — perfil {perfil['profile']}"]

    atual = _pesos_por_classe()
    nomes = {"renda_fixa": "Renda fixa", "etf": "ETFs", "fii": "FIIs", "acao": "Ações"}
    for classe, peso_alvo in sorted(alvo.items(), key=lambda kv: -kv[1]):
        agora = atual.get(classe)
        comparacao = (f" · hoje {percent(agora, signed=False)}"
                      if agora is not None else " · hoje 0%")
        linhas.append(f"- {nomes.get(classe, classe)}: "
                      f"{percent(peso_alvo, signed=False)}{comparacao}")

    falta = perfil.get("emergency_gap") or 0
    if falta > 0:
        linhas += ["", f"Reserva de emergência: faltam {money(falta)} "
                       f"de {money(perfil.get('emergency_target'))}."]

    bloqueios = [p for p in (perfil.get("prerequisites") or []) if p.get("blocking")]
    if bloqueios:
        linhas += ["", "*Antes de tudo:*"]
        linhas += [f"- {p['title']}" for p in bloqueios]
    outros = [p for p in (perfil.get("prerequisites") or []) if not p.get("blocking")]
    if outros:
        linhas += ["", "Em paralelo:"]
        linhas += [f"- {p['title']}" for p in outros]

    return "\n".join(linhas)


def _pesos_por_classe() -> dict[str, float]:
    """Peso real de cada classe, a valor de mercado. `{}` se não deu para buscar."""
    try:
        from src.analysis.quantitative import (
            calculate_all_indicators, calculate_portfolio_metrics,
        )
        from src.data import market_data

        carteira = repo.posicoes()
        if not carteira.positions:
            return {}
        bundle = market_data.get_portfolio_data(carteira.tickers)
        metricas = calculate_portfolio_metrics(
            carteira, bundle, calculate_all_indicators(bundle))
        classes = {p.ticker: p.asset_class for p in carteira.positions}
        pesos: dict[str, float] = {}
        for linha in metricas.to_dict("records"):
            classe = classes.get(linha["ticker"], "acao")
            peso = linha.get("weight_pct")
            if peso == peso:  # não-NaN
                pesos[classe] = pesos.get(classe, 0.0) + float(peso)
        return pesos
    except Exception as exc:  # noqa: BLE001
        logger.warning("não foi possível calcular os pesos reais: %s", exc)
        return {}


def _sugestao(numero: str, args: dict) -> str:
    return tools.recomendar_carteira()


def _extrato(numero: str, args: dict) -> str:
    ticker = args.get("ticker") or None
    linhas_db = repo.movimentacoes(limite=10, ticker=ticker)
    if not linhas_db:
        alvo = f" de {curto(ticker)}" if ticker else ""
        return (f"Nenhuma movimentação{alvo} registrada ainda.\n\n"
                "Para registrar: *comprei 100 PETR4 a 35,50*")

    rotulos = {"compra": "Compra", "venda": "Venda", "ajuste": "Ajuste"}
    titulo = f"*Extrato* — {curto(ticker)}" if ticker else "*Extrato* — últimas movimentações"
    saida = [titulo]
    for m in linhas_db:
        quantidade = float(m["shares"])
        saida.append(
            f"_#{m['id']}_ {m['data'].strftime('%d/%m/%y')} · "
            f"{rotulos.get(m['tipo'], m['tipo'])} "
            f"{number(quantidade, 0 if quantidade == int(quantidade) else 2)} "
            f"{curto(m['ticker'])} a {money(float(m['preco']))}"
            + (f" + {money(float(m['taxas']))}" if float(m["taxas"]) else "")
        )

    total = repo.total_movimentacoes(ticker)
    if total > len(linhas_db):
        saida.append(f"_(+{total - len(linhas_db)} não listadas)_")

    realizado = repo.resultado_realizado()
    if realizado:
        saida += ["", f"Resultado realizado: {money(realizado)}"]
    saida += ["", "_Para apagar uma linha: /desfazer (a última) ou use a interface web._"]
    return "\n".join(saida)


def _status(numero: str, args: dict) -> str:
    gasto = store.gasto_do_mes()
    ponte = bridge_client.status()
    linhas = [
        "*Status do InvestAI*",
        f"Ponte do WhatsApp: {'conectada ✅' if ponte.get('conectado') else 'desconectada ❌'}",
        f"Gasto de API no mês: {money(gasto, 'USD')} de {money(MONTHLY_BUDGET_USD, 'USD')} "
        f"({percent(gasto / MONTHLY_BUDGET_USD * 100 if MONTHLY_BUDGET_USD else 0, signed=False)})",
    ]

    try:
        carteira = repo.posicoes()
        linhas.append(f"Banco: ok · {len(carteira.positions)} posição(ões), "
                      f"{repo.total_movimentacoes()} movimentação(ões)")
        snapshot = repo.ultimo_snapshot()
        if snapshot:
            quando = datetime.fromisoformat(snapshot["generatedAt"])
            idade = (datetime.now(quando.tzinfo) - quando).total_seconds() / 60
            linhas.append(f"Último snapshot: há {idade:.0f} min")
        else:
            linhas.append("Último snapshot: nenhum ainda")
        pendentes = repo.jobs_pendentes()
        if pendentes:
            linhas.append(f"Fila: {pendentes} trabalho(s) pendente(s)")
    except repo.SemBanco:
        linhas.append("Banco: *indisponível* ❌")

    if WEB_URL:
        linhas += ["", f"Interface: {WEB_URL}"]
    return "\n".join(linhas)


def _web(numero: str, args: dict) -> str:
    if not WEB_URL:
        return ("A interface web ainda não está publicada. "
                "Quando estiver, o endereço aparece aqui e no */status*.")
    return f"Sua interface: {WEB_URL}\n\n_Entra com a senha que você definiu._"


def _limpar(numero: str, args: dict) -> str:
    store.limpar_historico(numero)
    store.limpar_sessao(numero)
    return "Pronto, esqueci nossa conversa anterior. 🧹"


# --- Escrita ----------------------------------------------------------------
def _movimento(numero: str, args: dict) -> str:
    return _propor(numero, escrita.montar(
        tipo=args["tipo"], ticker=args.get("ticker"), shares=args.get("shares"),
        preco=args.get("preco"), data=args.get("data"),
    ))


def _ajustar(numero: str, args: dict) -> str:
    return _propor(numero, escrita.montar(
        tipo="ajuste", ticker=args.get("ticker"), shares=args.get("shares"),
        preco=args.get("preco"),
    ))


def _remover(numero: str, args: dict) -> str:
    return _propor(numero, escrita.montar(tipo="remocao", ticker=args.get("ticker")))


def _propor(numero: str, proposta: escrita.Proposta) -> str:
    """Guarda a proposta na sessão e devolve o texto de confirmação.

    O "FALTA_PRECO" não é erro: é a pergunta que falta. Fica pendente como
    `falta_preco`, e a próxima mensagem com um número (ou "mercado") completa.
    """
    if proposta.erro == "FALTA_PRECO":
        contexto = ""
        try:
            from src.data import market_data

            precos = market_data.get_stock_data(proposta.ticker)
            if not precos.empty:
                atual = float(precos["Close"].dropna().iloc[-1])
                contexto = (f"\nHoje está em {money(atual)} — responda *mercado* "
                            "para usar esse preço.")
        except Exception:  # noqa: BLE001
            logger.debug("sem cotação para sugerir", exc_info=True)

        store.gravar_sessao(numero, {"fluxo": "confirmacao", "etapa": "falta_preco",
                                     "proposta": proposta.as_dict()},
                            store.TTL_CONFIRMACAO)
        return (f"A que preço por cota você {'comprou' if proposta.tipo == 'compra' else 'vendeu'} "
                f"{number(proposta.shares, 0)} {curto(proposta.ticker)}?{contexto}")

    if not proposta.ok:
        return proposta.erro

    store.gravar_sessao(numero, {"fluxo": "confirmacao", "proposta": proposta.as_dict()},
                        store.TTL_CONFIRMACAO)
    return escrita.texto_confirmacao(proposta)


def _confirmar(numero: str, args: dict) -> str:
    """O "sim". Cada etapa pendente tem o seu efeito, e a sessão é limpa antes.

    Limpar antes de executar importa: se a gravação falhar, a pendência não fica
    para trás esperando um segundo "sim" que gravaria em duplicidade.
    """
    sessao = store.ler_sessao(numero)
    etapa = sessao.get("etapa")

    if etapa == "falta_preco":
        return ("Ainda falta o preço por cota. Responda só o número "
                "(ex: *35,50*) ou *mercado*.")

    if etapa == "briefing":
        store.limpar_sessao(numero)
        return _briefing(numero, args)

    if etapa == "desfazer":
        id_mov = sessao.get("id_movimento")
        store.limpar_sessao(numero)
        if not id_mov:
            return "Perdi a referência do que desfazer. Manda */desfazer* de novo."
        if not repo.apagar_movimento(int(id_mov)):
            return f"A movimentação _#{id_mov}_ já não existe."
        escrita._espelhar()
        return (f"Desfeito. 🗑️ A movimentação _#{id_mov}_ foi apagada e a posição "
                f"foi recalculada.\n\n{escrita.resumo_carteira()}")

    if etapa == "onboarding":
        store.limpar_sessao(numero)
        from server import onboarding_chat

        return onboarding_chat.gravar(numero, sessao.get("respostas") or {})

    dados = sessao.get("proposta")
    if not dados:
        return ("Não tenho nada pendente para confirmar — a confirmação vence em "
                "10 minutos. Manda o pedido de novo.")

    store.limpar_sessao(numero)
    return escrita.aplicar(escrita.Proposta.from_dict(dados), origem="whatsapp")


def _informar_preco(numero: str, args: dict) -> str:
    """Completa uma proposta que estava só esperando o preço."""
    sessao = store.ler_sessao(numero)
    dados = sessao.get("proposta")
    if not dados:
        return "Essa pergunta expirou. Manda o registro de novo."

    bruto = (args.get("preco") or "").strip()
    preco: Any = bruto
    if bruto.lower() in ("mercado", "a mercado", "preco de mercado", "preço de mercado"):
        from src.data import market_data

        cotacoes = market_data.get_stock_data(dados["ticker"])
        if cotacoes.empty:
            return "Não consegui a cotação agora. Me diga o preço por cota."
        preco = float(cotacoes["Close"].dropna().iloc[-1])

    store.limpar_sessao(numero)
    return _propor(numero, escrita.montar(
        tipo=dados["tipo"], ticker=dados["ticker"], shares=dados["shares"], preco=preco,
    ))


def _cancelar(numero: str, args: dict) -> str:
    store.limpar_sessao(numero)
    return "Descartado, não gravei nada. 👍"


def _desfazer(numero: str, args: dict) -> str:
    ultimo = repo.ultimo_movimento()
    if not ultimo:
        return "Não há movimentação para desfazer."

    rotulos = {"compra": "compra", "venda": "venda", "ajuste": "ajuste"}
    store.gravar_sessao(numero, {"fluxo": "confirmacao", "etapa": "desfazer",
                                 "id_movimento": int(ultimo["id"])},
                        store.TTL_CONFIRMACAO)
    return "\n".join([
        "*Desfazer* — confirma?",
        f"_#{ultimo['id']}_ {ultimo['data'].strftime('%d/%m/%y')} · "
        f"{rotulos.get(ultimo['tipo'], ultimo['tipo'])} de "
        f"{number(float(ultimo['shares']), 0)} {curto(ultimo['ticker'])} "
        f"a {money(float(ultimo['preco']))}",
        "",
        "Responda *sim* para apagar ou *não* para manter.",
    ])


# --- IA (as três únicas rotas que custam) -----------------------------------
def _confirmar_briefing(numero: str, args: dict) -> str:
    """O briefing é a operação mais cara e demorada: confirma antes de gastar."""
    store.gravar_sessao(numero, {"fluxo": "confirmacao", "etapa": "briefing"},
                        store.TTL_CONFIRMACAO)
    return ("O briefing semanal analisa a carteira inteira com IA: leva cerca de "
            "1 minuto e custa ~US$ 0,10.\n\nGero agora? Responda *sim* ou *não*.")


def _briefing(numero: str, args: dict) -> str:
    from src.analysis import briefing

    resultado = briefing.montar()
    if resultado.error:
        return f"Não consegui gerar o briefing: {resultado.error}"

    custo = briefing.custo_estimado(resultado)
    uso = resultado.usage or {}
    store.registrar_gasto(numero, custo, uso.get("input_tokens") or 0,
                          uso.get("output_tokens") or 0)
    logger.info("Briefing gerado | US$ %.4f", custo)
    return ("📊 *Seu briefing do InvestAI*\n\n" + resultado.text
            + f"\n\n_Custou {money(custo, 'USD')}._")


def _analise(numero: str, args: dict) -> str:
    from src.analysis.analise_ativo import gerar

    resultado = gerar(args["ticker"])
    if not resultado.ok:
        return resultado.erro or "Não consegui montar a análise agora."

    store.registrar_gasto(numero, resultado.custo_estimado,
                          resultado.input_tokens, resultado.output_tokens)
    logger.info("Análise de %s | US$ %.4f", args["ticker"], resultado.custo_estimado)
    return resultado.texto + f"\n\n_Custou {money(resultado.custo_estimado, 'USD')}._"


def _pergunta(numero: str, args: dict) -> str:
    """O agente completo, com as 8 ferramentas. Caminho caro, por escolha explícita."""
    from src.agent.assistant import responder

    historico = store.carregar_historico(numero)
    resultado = responder(args["texto_livre"], historico)
    if not resultado.ok:
        return f"Deu problema aqui: {resultado.erro}"

    store.salvar_historico(numero, resultado.historico)
    store.registrar_gasto(numero, resultado.custo_estimado, resultado.input_tokens,
                          resultado.output_tokens, resultado.cache_read_tokens)
    return resultado.texto


# --- Onboarding -------------------------------------------------------------
def _onboarding(numero: str, args: dict) -> str:
    from server import onboarding_chat

    return onboarding_chat.iniciar(numero)


def _onboarding_resposta(numero: str, args: dict) -> str:
    from server import onboarding_chat

    return onboarding_chat.responder(numero, args["resposta"])


ACOES: dict[str, Any] = {
    "ajuda": _ajuda,
    "carteira": _carteira,
    "cotacao": _cotacao,
    "noticias": _noticias,
    "perfil": _perfil,
    "alocacao": _alocacao,
    "sugestao": _sugestao,
    "extrato": _extrato,
    "status": _status,
    "web": _web,
    "limpar": _limpar,
    "movimento": _movimento,
    "ajustar": _ajustar,
    "remover": _remover,
    "desfazer": _desfazer,
    "confirmar": _confirmar,
    "informar_preco": _informar_preco,
    "cancelar": _cancelar,
    "confirmar_briefing": _confirmar_briefing,
    "briefing": _briefing,
    "analise": _analise,
    "pergunta": _pergunta,
    "onboarding": _onboarding,
    "onboarding_resposta": _onboarding_resposta,
}
