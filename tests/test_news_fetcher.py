"""Testes de `src.data.news_fetcher`.

A fonte primária (Google Notícias, RSS) não precisa de chave, então a busca real
é testada de verdade. O parsing do RSS é testado com um XML fixo — não é mock de
dado de mercado, é teste de parser, e o teste de rede ao lado garante que o
formato real continua casando com ele.
"""

from __future__ import annotations

import os
from datetime import datetime, timedelta, timezone

import pytest

from src.data import news_fetcher

RSS_EXEMPLO = """<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
  <title>"VALE3 when:7d" - Google Notícias</title>
  <item>
    <title>Vale (VALE3) sob pressão: Citi diz o que está no caminho - Seu Dinheiro</title>
    <link>https://news.google.com/rss/articles/ABC123</link>
    <pubDate>Wed, 07 Oct 2026 15:22:04 GMT</pubDate>
    <description>&lt;a href="https://news.google.com/x"&gt;link&lt;/a&gt;</description>
    <source url="https://seudinheiro.com">Seu Dinheiro</source>
  </item>
  <item>
    <title>Vale (VALE3)  - TradeMap</title>
    <link>https://news.google.com/rss/articles/DEF</link>
    <pubDate>Thu, 08 Oct 2026 10:00:00 GMT</pubDate>
    <source url="https://trademap.com">TradeMap</source>
  </item>
  <item>
    <title>Cotação Vale (VALE3) hoje: veja preços, gráficos e notícias em Tempo Real - Money Times</title>
    <link>https://news.google.com/rss/articles/GHI</link>
    <pubDate>Thu, 08 Oct 2026 11:00:00 GMT</pubDate>
    <source url="https://moneytimes.com">Money Times</source>
  </item>
  <item>
    <title>Vale (VALE3) sob pressão: Citi diz o que está no caminho - Seu Dinheiro</title>
    <link>https://news.google.com/rss/articles/DUPLICADA</link>
    <pubDate>Wed, 07 Oct 2026 16:00:00 GMT</pubDate>
    <source url="https://seudinheiro.com">Seu Dinheiro</source>
  </item>
  <item>
    <title>Ibovespa perde fôlego pelo 2º dia e cai abaixo dos 205 mil pontos - Suno</title>
    <link>https://news.google.com/rss/articles/JKL</link>
    <pubDate>Fri, 09 Oct 2026 18:30:00 GMT</pubDate>
    <source url="https://suno.com.br">Suno</source>
  </item>
</channel></rss>"""


# --- Google Notícias: query e parsing --------------------------------------
def test_query_usa_o_ticker_que_e_inambiguo():
    """"Vale" casa com "vale a pena"; "VALE3" só casa com a mineradora."""
    params = news_fetcher.google_news_params("VALE3.SA", 7)
    assert params["q"] == "VALE3 when:7d"
    assert params["hl"] == "pt-BR" and params["gl"] == "BR"

    # Janela acompanha o parâmetro de dias.
    assert news_fetcher.google_news_params("PETR4.SA", 15)["q"] == "PETR4 when:15d"


def test_query_de_ticker_americano_usa_locale_en():
    params = news_fetcher.google_news_params("AAPL", 7)
    assert params["q"] == "AAPL stock when:7d"
    assert params["hl"] == "en-US" and params["gl"] == "US"


def test_parse_rss_extrai_o_contrato_completo():
    articles = news_fetcher.parse_google_rss(RSS_EXEMPLO, limit=5)

    assert articles, "deveria extrair ao menos um artigo"
    primeiro = articles[0]
    assert set(primeiro) == set(news_fetcher.ARTICLE_FIELDS)
    # O sufixo " - Veículo" sai do título porque o veículo tem campo próprio.
    assert primeiro["title"] == "Vale (VALE3) sob pressão: Citi diz o que está no caminho"
    assert primeiro["source"] == "Seu Dinheiro"
    assert primeiro["published"].startswith("2026-10-07T15:22:04")
    assert primeiro["url"].startswith("https://news.google.com/")
    # O RSS do Google não traz resumo — melhor vazio que um link HTML inútil.
    assert primeiro["description"] == ""


def test_parse_rss_descarta_paginas_de_cotacao_e_duplicatas():
    titulos = [a["title"] for a in news_fetcher.parse_google_rss(RSS_EXEMPLO, limit=10)]

    assert len(titulos) == 2, titulos
    assert any("Citi" in t for t in titulos)
    assert any("Ibovespa" in t for t in titulos)
    # Página perene de cotação não é fato novo.
    assert not any("Cotação" in t for t in titulos)
    # "Vale (VALE3)" sozinho é página de cotação, não manchete.
    assert "Vale (VALE3)" not in titulos
    # Mesma manchete republicada entra uma única vez.
    assert len(set(titulos)) == len(titulos)


def test_parse_rss_respeita_o_limite():
    assert len(news_fetcher.parse_google_rss(RSS_EXEMPLO, limit=1)) == 1


def test_parse_rss_invalido_levanta_valueerror_tratavel():
    with pytest.raises(ValueError):
        news_fetcher.parse_google_rss("<não é xml", limit=5)


def test_pubdate_invalida_nao_quebra_o_parsing():
    assert news_fetcher._parse_pubdate("") == ""
    assert news_fetcher._parse_pubdate("data estranha") == "data estranha"
    assert news_fetcher._parse_pubdate("Wed, 07 Oct 2026 15:22:04 GMT").startswith("2026-10-07")


# --- Relevância (usada pela Currents, que busca por palavra) ---------------
@pytest.mark.parametrize("titulo,descricao,esperado_mantem", [
    ("Abel acha sistema e leva Palmeiras à semi da Liberta", "futebol", False),
    ("Opinião: Vale dar uma chance ao bar das importadoras", "gastronomia", False),
    ("Vale notifica ex-conselheiro por vazamento de dados", "mineradora aciona", True),
    ("ADRs da Vale e de bancos sobem nos EUA", "mercado", True),
])
def test_relevancia_exige_contexto_financeiro(titulo, descricao, esperado_mantem):
    """Nome de empresa que é palavra comum ("Vale") precisa de contexto."""
    score = news_fetcher.relevance_score({"title": titulo, "description": descricao}, "Vale")
    assert (score >= news_fetcher.MIN_RELEVANCE_SCORE) is esperado_mantem


def test_relevancia_pontua_titulo_acima_da_descricao():
    no_titulo = news_fetcher.relevance_score(
        {"title": "Petrobras eleva produção", "description": ""}, "Petrobras")
    na_descricao = news_fetcher.relevance_score(
        {"title": "Lula exalta gasolina subsidiada", "description": "Petrobras e o diesel"}, "Petrobras")
    assert no_titulo > na_descricao >= news_fetcher.MIN_RELEVANCE_SCORE


def test_parse_currents_ordena_por_relevancia_e_apara_descricao():
    payload = {"news": [
        {"title": "Vale dar uma chance ao bar", "description": "gastronomia", "url": "https://n"},
        {"title": "Mercado reage", "description": "A Vale subiu com o minério", "url": "https://b"},
        {"title": "Vale fecha acordo com MPF", "description": "x" * 900, "url": "https://a"},
    ]}
    articles = news_fetcher.parse_currents(payload, limit=5, term="Vale")

    assert [a["title"] for a in articles] == ["Vale fecha acordo com MPF", "Mercado reage"]
    assert len(articles[0]["description"]) == 400
    assert all(set(a) == set(news_fetcher.ARTICLE_FIELDS) for a in articles)


def test_start_date_da_currents_fica_abaixo_do_limite_da_api():
    """A Currents devolve 400 se a janela alcançar 7 dias exatos."""
    now = datetime(2026, 10, 12, 12, 0, tzinfo=timezone.utc)

    for days in (7, 15, 365):
        inicio = datetime.fromisoformat(news_fetcher.start_date_for(days, now))
        assert timedelta(days=6) < now - inicio < timedelta(days=news_fetcher.CURRENTS_MAX_DAYS)

    inicio = datetime.fromisoformat(news_fetcher.start_date_for(3, now))
    assert timedelta(days=2) < now - inicio < timedelta(days=3)
    # Precisa ser ISO-8601 com hora: a API recusa `start_date` só com a data.
    assert "T" in news_fetcher.start_date_for(7, now)


# --- Orquestração -----------------------------------------------------------
def test_cadeia_de_fontes(monkeypatch):
    monkeypatch.setenv("CURRENTS_API_KEY", "chave")
    assert news_fetcher.provider_chain("auto") == ["google", "currents"]
    assert news_fetcher.provider_chain("google") == ["google"]
    assert news_fetcher.provider_chain("currents") == ["currents"]

    monkeypatch.delenv("CURRENTS_API_KEY", raising=False)
    assert news_fetcher.provider_chain("auto") == ["google"], "sem chave, não tenta a Currents"


def test_company_name_e_search_terms():
    assert news_fetcher.company_name("PETR4.SA") == "Petrobras"
    assert news_fetcher.company_name("XPTO3.SA") == "XPTO3"   # fora do mapa
    assert news_fetcher.company_name("AAPL") == "AAPL"
    assert news_fetcher.search_terms("ITUB4.SA") == "Itaú Unibanco"


def test_lista_de_tickers_vazia_nao_chama_rede():
    assert news_fetcher.fetch_financial_news([]) == {}


def test_fonte_que_falha_nao_derruba_a_busca(monkeypatch):
    """Exceção numa fonte vira lista vazia para aquele ativo, não exceção."""
    def explode(ticker, days, limit):
        raise ConnectionError("rede caiu")

    monkeypatch.setitem(news_fetcher.PROVIDERS, "google", explode)
    monkeypatch.delenv("CURRENTS_API_KEY", raising=False)

    news = news_fetcher.fetch_financial_news(["PETR4.SA"], provider="google", use_cache=False)
    assert news == {"PETR4.SA": []}


def test_fallback_entra_quando_a_primaria_vem_vazia(monkeypatch):
    monkeypatch.setenv("CURRENTS_API_KEY", "chave")
    monkeypatch.setitem(news_fetcher.PROVIDERS, "google", lambda t, d, l: [])
    monkeypatch.setitem(
        news_fetcher.PROVIDERS, "currents",
        lambda t, d, l: [{"title": "da reserva", "description": "", "url": "u",
                          "published": "", "source": "Currents"}],
    )
    news = news_fetcher.fetch_financial_news(["PETR4.SA"], provider="auto", use_cache=False)
    assert [a["title"] for a in news["PETR4.SA"]] == ["da reserva"]


def test_flatten_news_anexa_o_ticker():
    agrupado = {"PETR4.SA": [{"title": "T1"}], "VALE3.SA": [{"title": "T2"}]}
    plano = news_fetcher.flatten_news(agrupado)
    assert {a["ticker"] for a in plano} == {"PETR4.SA", "VALE3.SA"}
    assert news_fetcher.flatten_news({}) == []


# --- Busca real (sem chave: a fonte primária é aberta) ---------------------
@pytest.mark.network
def test_busca_real_no_google_traz_noticias_relevantes(require_internet):
    news = news_fetcher.fetch_financial_news(
        ["PETR4.SA", "ITUB4.SA"], days=7, provider="google", use_cache=False
    )
    if not any(news.values()):
        pytest.skip("Google Notícias não respondeu agora")

    for ticker, articles in news.items():
        assert len(articles) <= 5, "máximo de 5 artigos por ativo"
        for article in articles:
            assert set(article) == set(news_fetcher.ARTICLE_FIELDS)
            assert article["title"] and article["url"]
            # Contrato de data: ISO-8601 (ou vazio), nunca RFC-822 cru.
            assert not article["published"] or "T" in article["published"]

    petr = news.get("PETR4.SA") or []
    if petr:
        titulos = " ".join(a["title"] for a in petr).upper()
        assert "PETR" in titulos or "PETROBRAS" in titulos.upper(), titulos


@pytest.mark.network
def test_busca_real_na_currents_quando_ha_chave(require_internet):
    if not os.getenv("CURRENTS_API_KEY"):
        pytest.skip("CURRENTS_API_KEY não configurada — a Currents é apenas reserva")

    news = news_fetcher.fetch_financial_news(
        ["PETR4.SA"], days=7, provider="currents", use_cache=False
    )
    if not news.get("PETR4.SA"):
        pytest.skip("Currents não devolveu artigos relevantes agora")

    for article in news["PETR4.SA"]:
        assert set(article) == set(news_fetcher.ARTICLE_FIELDS)
        assert article["title"]
