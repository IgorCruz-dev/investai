"""Ferramentas que o Claude pode chamar — a ponte entre o assistente e o sistema.

Cada ferramenta é uma função fina sobre os módulos que já existem: nada de
lógica financeira nova aqui. O que este módulo adiciona é a **fronteira de
segurança**: toda ferramenta devolve texto curto e legível (nunca um DataFrame
cru), trata o próprio erro e jamais levanta exceção para o laço do agente.

O formato de saída é pensado para WhatsApp: linhas curtas, sem tabela, sem
markdown pesado — o que o app do WhatsApp não renderiza vira ruído.
"""

from __future__ import annotations

import logging
from datetime import datetime

from anthropic import beta_tool

from investai.analysis.quantitative import (
    calculate_all_indicators,
    calculate_indicators,
    calculate_portfolio_metrics,
    portfolio_totals,
)
from investai.analysis.recommender import recommend
from investai.analysis.screener import UNIVERSE
from investai.config import load_portfolio, load_profile
from investai.data import market_data, news_fetcher
from investai.onboarding.profile import build_profile
from investai.utils.formatters import money, number, percent
from investai.utils.tickers import normalizar

logger = logging.getLogger(__name__)

#: Quantas posições/ativos listar antes de resumir — mensagem de WhatsApp longa
#: demais vira rolagem infinita no celular.
MAX_LINHAS = 12


#: A regra de ticker mora em `src/utils/tickers.py`, porque o roteador e a
#: validação de escrita precisam da mesma. Mantido com o nome antigo aqui para
#: não quebrar quem já importava daqui.
_normalizar = normalizar


def _erro(contexto: str, exc: Exception) -> str:
    logger.warning("%s: %s", contexto, exc)
    return f"Não consegui {contexto} agora ({exc.__class__.__name__}). Tente de novo em instantes."


# --------------------------------------------------------------------------
@beta_tool
def consultar_carteira() -> str:
    """Mostra a carteira do usuário: posições, valor atual, P&L e pesos.

    Use sempre que a pergunta envolver "minha carteira", "quanto eu tenho",
    "como está meu patrimônio" ou o resultado das posições.
    """
    try:
        portfolio = load_portfolio()
        if not portfolio.positions:
            # Texto endereçado ao USUÁRIO, não ao modelo: desde o roteador,
            # esta string vai direto para o celular sem o Claude no meio.
            return ("Sua carteira está vazia — nenhuma posição registrada ainda.\n\n"
                    "Para registrar a primeira: *comprei 100 PETR4 a 35,50*")

        bundle = market_data.get_portfolio_data(portfolio.tickers)
        indicators = calculate_all_indicators(bundle)
        metrics = calculate_portfolio_metrics(portfolio, bundle, indicators)
        totals = portfolio_totals(metrics)
        moeda = portfolio.currency

        planejada = " (carteira planejada: nada comprado ainda)" if portfolio.planned else ""
        linhas = [f"Carteira{planejada} — {money(totals['total_value'], moeda)}"]
        if totals["pnl_abs"] is not None:
            linhas.append(
                f"Resultado: {money(totals['pnl_abs'], moeda)} ({percent(totals['pnl_pct'])}) "
                f"sobre custo de {money(totals['total_cost'], moeda)}"
            )

        ordenadas = metrics.sort_values("weight_pct", ascending=False)
        for row in ordenadas.head(MAX_LINHAS).to_dict("records"):
            pnl = (f" | P&L {money(row['pnl_abs'], moeda)} ({percent(row['pnl_pct'])})"
                   if row["pnl_abs"] == row["pnl_abs"] else "")
            linhas.append(
                f"- {row['ticker']}: {number(row['shares'], 0)} cotas, "
                f"{money(row['position_value'], moeda)}, peso {percent(row['weight_pct'], signed=False)}"
                f"{pnl} | 7d {percent(row['change_7d'])}"
            )
        if len(ordenadas) > MAX_LINHAS:
            linhas.append(f"(+{len(ordenadas) - MAX_LINHAS} posições não listadas)")
        return "\n".join(linhas)
    except Exception as exc:  # noqa: BLE001
        return _erro("consultar a carteira", exc)


@beta_tool
def analisar_ativo(ticker: str) -> str:
    """Análise técnica e fundamentalista de um ativo específico.

    Traz preço, variações, médias móveis, RSI, volatilidade, tendência e os
    fundamentos disponíveis (P/L, dividend yield, dívida/patrimônio).

    Args:
        ticker: Código do papel. Aceita "PETR4", "PETR4.SA" ou "AAPL".
    """
    code = _normalizar(ticker)
    if not code:
        return "Informe o código do ativo, por exemplo PETR4 ou AAPL."
    try:
        prices = market_data.get_stock_data(code)
        if prices.empty:
            return (f"Não encontrei dados de {code}. Confira o código — papéis da B3 "
                    "levam o sufixo .SA (ex: PETR4.SA) e ações americanas vão sem sufixo.")

        ind = calculate_indicators(prices)
        fund = market_data.get_fundamentals(code)
        nome = fund.get("name") or code

        linhas = [
            f"{code} — {nome}",
            f"Preço: {money(ind['price_current'])} | tendência {ind['trend_signal']}",
            f"Variações: 7d {percent(ind['price_change_7d'])} · 30d {percent(ind['price_change_30d'])} · "
            f"90d {percent(ind['price_change_90d'])} · 12m {percent(ind['price_change_1y'])}",
            f"Médias: MM20 {number(ind['ma_20'])} · MM50 {number(ind['ma_50'])} · MM200 {number(ind['ma_200'])}",
            f"RSI(14): {number(ind['rsi_14'], 1)}"
            + (" — sobrecomprado" if (ind["rsi_14"] or 0) > 70
               else " — sobrevendido" if (ind["rsi_14"] or 100) < 30 else ""),
            f"Volatilidade anualizada: {percent(ind['volatility_30d'], signed=False)}",
        ]
        if fund:
            linhas.append(
                f"Fundamentos: P/L {number(fund.get('pe_ratio'))} · "
                f"DY {percent(fund.get('dividend_yield'), signed=False)} · "
                f"D/PL {number(fund.get('debt_to_equity'), 0)}"
            )
        return "\n".join(linhas)
    except Exception as exc:  # noqa: BLE001
        return _erro(f"analisar {code}", exc)


@beta_tool
def cotacao(tickers: str) -> str:
    """Preço atual e variação de um ou mais ativos, sem a análise completa.

    Args:
        tickers: Um ou mais códigos separados por vírgula, ex: "PETR4, VALE3".
    """
    codes = [_normalizar(t) for t in (tickers or "").split(",")]
    codes = [c for c in codes if c][:8]
    if not codes:
        return "Informe ao menos um código, por exemplo: PETR4, VALE3."
    try:
        bundle = market_data.get_portfolio_data(codes)
        linhas = []
        for code in codes:
            prices = (bundle.get(code) or {}).get("prices")
            if prices is None or prices.empty:
                linhas.append(f"- {code}: sem dados")
                continue
            ind = calculate_indicators(prices)
            linhas.append(
                f"- {code}: {money(ind['price_current'])} | "
                f"7d {percent(ind['price_change_7d'])} | 30d {percent(ind['price_change_30d'])}"
            )
        return "\n".join(linhas)
    except Exception as exc:  # noqa: BLE001
        return _erro("buscar as cotações", exc)


@beta_tool
def buscar_noticias(ticker: str = "") -> str:
    """Notícias dos últimos 7 dias, de um ativo ou de toda a carteira.

    Args:
        ticker: Código do ativo. Vazio = notícias de todos os ativos da carteira.
    """
    try:
        if ticker:
            codes = [_normalizar(ticker)]
        else:
            portfolio = load_portfolio()
            codes = portfolio.tickers[:5]
            if not codes:
                return ("Sua carteira está vazia, então não sei de quais ativos buscar "
                    "notícia. Me diga um código, por exemplo: *notícias PETR4*")

        news = news_fetcher.fetch_financial_news(codes)
        if not any(news.values()):
            return "Nenhuma notícia relevante encontrada nos últimos 7 dias para esses ativos."

        linhas = []
        for code, artigos in news.items():
            if not artigos:
                continue
            linhas.append(f"{code}:")
            for artigo in artigos[:4]:
                data = (artigo.get("published") or "")[:10]
                fonte = artigo.get("source") or ""
                linhas.append(f"- [{data}] {artigo['title']}" + (f" ({fonte})" if fonte else ""))
        return "\n".join(linhas)
    except Exception as exc:  # noqa: BLE001
        return _erro("buscar notícias", exc)


@beta_tool
def gerar_briefing() -> str:
    """Gera o briefing semanal completo da carteira (análise do mercado + recomendações).

    É uma operação cara e demorada (cerca de 1 minuto). Use apenas quando o
    usuário pedir explicitamente o briefing ou uma análise completa da carteira —
    para perguntas pontuais, prefira `consultar_carteira` ou `analisar_ativo`.
    """
    try:
        from investai.analysis.briefing import montar

        resultado = montar()
        if resultado.error:
            return f"Não consegui gerar o briefing: {resultado.error}"
        return resultado.text
    except Exception as exc:  # noqa: BLE001
        return _erro("gerar o briefing", exc)


@beta_tool
def recomendar_carteira() -> str:
    """Sugere uma carteira com base no perfil do usuário e no mercado atual.

    Usa o perfil salvo no onboarding (tolerância a risco, horizonte, reserva de
    emergência) e o filtro quantitativo sobre os ativos líquidos da B3.
    """
    try:
        perfil_salvo = load_profile()
        if not perfil_salvo.get("answers"):
            return ("Para sugerir uma carteira eu preciso do seu perfil — sem ele não "
                    "há base para definir alocação.\n\n"
                    "Manda */onboarding*: são 18 perguntas, em 4 blocos.")

        profile = build_profile(perfil_salvo["answers"])
        bundle = market_data.get_portfolio_data([a.ticker for a in UNIVERSE])
        rec = recommend(profile, bundle, use_llm=False)  # o agente já explica; evita LLM aninhado

        if not rec.ok:
            return f"Não consegui montar a recomendação: {rec.error}"

        linhas = [
            f"Perfil {profile.profile} (score {profile.risk_score:.0f}/100), "
            f"{money(profile.investable_amount)} para investir agora:"
        ]
        for pos in rec.positions:
            cotas = "" if pos.asset_class == "renda_fixa" else f", {pos.shares:.0f} cotas"
            linhas.append(
                f"- {pos.ticker}: {percent(pos.weight_pct, signed=False)} "
                f"({money(pos.amount)}{cotas}) — {pos.rationale[:110]}"
            )
        for pre in profile.prerequisites:
            marca = "ANTES DE TUDO" if pre.blocking else "atenção"
            linhas.append(f"[{marca}] {pre.title}")
        return "\n".join(linhas)
    except Exception as exc:  # noqa: BLE001
        return _erro("montar a recomendação", exc)


@beta_tool
def status_do_perfil() -> str:
    """Mostra o perfil de investidor salvo: classificação, score, reserva e alocação-alvo.

    Use quando o usuário perguntar sobre o próprio perfil, tolerância a risco ou
    quanto deveria ter em cada classe de ativo.
    """
    try:
        perfil = load_profile()
        if not perfil.get("profile"):
            return ("Nenhum perfil salvo ainda.\n\n"
                    "Manda */onboarding* para responder o questionário — 18 perguntas, "
                    "e dá para parar no meio e voltar depois.")
        alocacao = " · ".join(
            f"{k}: {percent(v, signed=False)}" for k, v in (perfil.get("allocation") or {}).items()
        )
        return "\n".join([
            f"Perfil: {perfil['profile']} (score {perfil.get('risk_score')}/100)",
            f"Horizonte: {perfil.get('horizon_years')} anos | "
            f"aporte mensal {money(perfil.get('monthly_contribution'))}",
            f"Reserva de emergência: {money(perfil.get('emergency_current'))} de "
            f"{money(perfil.get('emergency_target'))}",
            f"Alocação-alvo: {alocacao}",
        ])
    except Exception as exc:  # noqa: BLE001
        return _erro("consultar o perfil", exc)


@beta_tool
def data_de_hoje() -> str:
    """Data e hora atuais. Use para situar prazos, "esta semana" e vencimentos."""
    agora = datetime.now()
    dias = ["segunda", "terça", "quarta", "quinta", "sexta", "sábado", "domingo"]
    return f"{dias[agora.weekday()]}-feira, {agora.strftime('%d/%m/%Y, %H:%M')}"


#: Ordem estável — o cache de prompt depende da lista de ferramentas não mudar.
FERRAMENTAS = [
    consultar_carteira,
    analisar_ativo,
    cotacao,
    buscar_noticias,
    gerar_briefing,
    recomendar_carteira,
    status_do_perfil,
    data_de_hoje,
]
