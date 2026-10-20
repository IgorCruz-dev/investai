"""App Streamlit do InvestAI — orquestra dados, análise e exibição."""

from __future__ import annotations

import logging
from datetime import datetime
from typing import Any

import streamlit as st

from investai.analysis import llm_analyst
from investai.analysis.quantitative import calculate_all_indicators, calculate_portfolio_metrics
from investai.config import DEFAULT_PERIOD, NEWS_DAYS, load_portfolio, load_profile
from investai.dashboard.components import (
    briefing_view,
    charts,
    news_view,
    onboarding,
    portfolio_view,
)
from investai.data import market_data, news_fetcher
from investai.utils.cache import cache
from investai.utils.formatters import datetime_br

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)

STATE_DATA = "investai_data"
STATE_BRIEFING = "briefing"
STATE_FORCE_ONBOARDING = "force_onboarding"


def load_everything(tickers: list[str], period: str, use_cache: bool = True) -> dict[str, Any]:
    """Busca mercado + notícias e calcula indicadores. Nunca levanta exceção."""
    bundle = market_data.get_portfolio_data(tickers, period=period, use_cache=use_cache)
    return {
        "market_data": bundle,
        "fundamentals": {t: payload.get("fundamentals", {}) for t, payload in bundle.items()},
        "indicators": calculate_all_indicators(bundle),
        "news": news_fetcher.fetch_financial_news(tickers, days=NEWS_DAYS, use_cache=use_cache),
        "fetched_at": datetime.now(),
    }


def load_universe_data(tickers: list[str]) -> dict[str, Any]:
    """Preços + fundamentals do universo do screener (usado no onboarding)."""
    return market_data.get_portfolio_data(tickers, period=DEFAULT_PERIOD)


def _status_line(container, label: str, ok: bool, detail: str = "") -> None:
    icon = "🟢" if ok else "🔴"
    container.markdown(f"{icon} **{label}**" + (f" — {detail}" if detail else ""))


def render_sidebar_controls() -> bool:
    """Título e botão de atualização. Devolve True se o usuário clicou."""
    st.sidebar.title("InvestAI")
    st.sidebar.caption("Personal Investment Intelligence Agent")
    return st.sidebar.button("🔄 Atualizar Dados", type="primary")


def render_sidebar_status(container, portfolio, data: dict[str, Any]) -> None:
    """Preenche timestamp e status das APIs.

    Desenhado num container reservado *antes* da busca e preenchido *depois*,
    senão o status refletiria o estado anterior aos dados chegarem.
    """
    fetched_at = (data or {}).get("fetched_at")
    container.markdown(
        f"**Última atualização:** {datetime_br(fetched_at) if fetched_at else 'nunca nesta sessão'}"
    )
    container.divider()
    container.markdown("**Status das APIs**")

    market = (data or {}).get("market_data") or {}
    loaded = [t for t, payload in market.items()
              if payload.get("prices") is not None and not payload["prices"].empty]
    _status_line(
        container, "yfinance", bool(loaded),
        f"{len(loaded)}/{len(market)} ativos carregados" if market else "sem dados",
    )

    news = (data or {}).get("news") or {}
    with_articles = sum(1 for articles in news.values() if articles)
    fontes = " → ".join(news_fetcher.provider_chain())
    _status_line(
        container, f"Notícias ({fontes})", bool(with_articles),
        f"notícias em {with_articles}/{len(news)} ativos" if news else "nenhuma notícia",
    )

    key_ok = llm_analyst.probe()
    _status_line(container, "Anthropic API", key_ok,
                 "chave configurada" if key_ok else "ANTHROPIC_API_KEY ausente")

    container.divider()
    tipo = "planejada" if portfolio.planned else "real"
    container.markdown(
        f"**Carteira ({tipo}):** {len(portfolio)} ativo(s) · moeda {portfolio.currency}  \n"
        f"**Período do histórico:** {DEFAULT_PERIOD}"
    )

    profile = load_profile()
    if profile.get("profile"):
        container.markdown(
            f"**Perfil:** {profile['profile']} · score {profile.get('risk_score', '?')}/100"
        )

    if container.button("📋 Refazer onboarding"):
        st.session_state[STATE_FORCE_ONBOARDING] = True
        st.session_state.pop(STATE_DATA, None)
        st.rerun()
    container.caption("Ou edite `config/portfolio.json` na mão.")


def render() -> None:
    st.set_page_config(page_title="InvestAI", page_icon="📈", layout="wide")

    portfolio = load_portfolio()
    data: dict[str, Any] = st.session_state.get(STATE_DATA, {})

    refresh = render_sidebar_controls()
    status_slot = st.sidebar.container()  # preenchido depois da busca

    # Sem carteira (ou a pedido do usuário) o onboarding vem antes de tudo:
    # não há o que analisar sem saber o que a pessoa tem e quem ela é.
    needs_onboarding = (
        not portfolio.positions
        or st.session_state.get(STATE_FORCE_ONBOARDING)
        or onboarding.is_active()
    )
    if needs_onboarding:
        render_sidebar_status(status_slot, portfolio, data)
        onboarding.render(
            load_market_data=load_universe_data,
            currency=portfolio.currency,
            use_llm=llm_analyst.probe(),
        )
        if portfolio.positions:
            st.divider()
            if st.button("Voltar ao dashboard sem mudar nada"):
                st.session_state.pop(STATE_FORCE_ONBOARDING, None)
                st.rerun()
        return

    if refresh:
        cache.invalidate()
        st.session_state.pop(STATE_BRIEFING, None)
        with st.spinner("Buscando dados de mercado e notícias..."):
            data = load_everything(portfolio.tickers, DEFAULT_PERIOD, use_cache=False)
        st.session_state[STATE_DATA] = data
    elif not data:
        with st.spinner("Buscando dados de mercado e notícias..."):
            data = load_everything(portfolio.tickers, DEFAULT_PERIOD)
        st.session_state[STATE_DATA] = data

    render_sidebar_status(status_slot, portfolio, data)

    metrics = calculate_portfolio_metrics(portfolio, data["market_data"], data["indicators"])

    st.title("📈 InvestAI")
    st.caption(
        "Dados de mercado via yfinance · notícias via Currents API · análise qualitativa via Claude. "
        "Conteúdo informativo — não é recomendação de investimento."
    )

    tab_portfolio, tab_technical, tab_briefing, tab_news = st.tabs(
        ["Carteira", "Análise Técnica", "Briefing Semanal", "Notícias"]
    )

    with tab_portfolio:
        portfolio_view.render(metrics, portfolio.currency, planned=portfolio.planned)

    with tab_technical:
        charts.render(data["market_data"], data["indicators"])

    with tab_briefing:
        briefing_view.render(
            generate=lambda: llm_analyst.generate_briefing(
                portfolio_data=metrics,
                indicators=data["indicators"],
                news=data["news"],
                fundamentals=data["fundamentals"],
                currency=portfolio.currency,
            ),
            state_key=STATE_BRIEFING,
            api_ready=llm_analyst.probe(),
        )

    with tab_news:
        news_view.render(data["news"], portfolio.tickers)
