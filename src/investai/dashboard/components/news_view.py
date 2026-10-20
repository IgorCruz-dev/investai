"""Aba 4 — notícias por ativo."""

from __future__ import annotations

import streamlit as st

from investai.utils.formatters import date_br


def render(news: dict[str, list[dict[str, str]]], tickers: list[str] | None = None) -> None:
    if not news:
        st.info(
            "Nenhuma notícia disponível agora. A busca usa o Google Notícias (sem chave) e, "
            "como reserva, a Currents API — se as duas falharem, o restante do sistema "
            "(incluindo o briefing) continua funcionando apenas com os dados quantitativos."
        )
        return

    for ticker in (tickers or list(news)):
        articles = news.get(ticker)
        if articles is None:
            continue
        st.subheader(ticker)
        if not articles:
            st.caption("Sem notícias nos últimos dias para este ativo.")
            st.divider()
            continue
        for article in articles:
            published = date_br(article.get("published", "")[:10])
            source = (article.get("source") or "").strip()
            meta = f"`{published}`" + (f" · **{source}**" if source else "")
            st.markdown(f"**{article.get('title', 'Sem título')}**  \n{meta}")
            if article.get("description"):
                st.write(article["description"])
            if article.get("url"):
                st.markdown(f"[Abrir notícia]({article['url']})")
            st.write("")
        st.divider()
