"""Filtro quantitativo sobre um universo curado de ativos da B3.

Por que universo curado em vez de "toda a bolsa": o yfinance não dá uma lista
confiável de tickers da B3, e varrer centenas de papéis gastaria centenas de
requisições (com bloqueio por IP garantido). A curadoria aqui é dos ativos mais
líquidos de cada setor — o filtro quantitativo decide entre eles com dados reais.

Nenhuma decisão aqui é opinião: cada ativo passa (ou não) por critérios
objetivos, e o resultado carrega os números que justificaram a aprovação.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Any

from src.analysis.quantitative import calculate_indicators
from src.onboarding.profile import ARROJADO, CONSERVADOR, MODERADO

logger = logging.getLogger(__name__)

ACAO, ETF, FII = "acao", "etf", "fii"


@dataclass(frozen=True)
class Asset:
    ticker: str
    name: str
    asset_class: str
    sector: str
    note: str = ""


#: Universo: ações líquidas por setor, ETFs amplos e FIIs de tijolo/papel grandes.
UNIVERSE: tuple[Asset, ...] = (
    # --- ETFs (diversificação ampla) ---
    Asset("BOVA11.SA", "iShares Ibovespa", ETF, "Índice Brasil", "Replica o Ibovespa"),
    Asset("IVVB11.SA", "iShares S&P 500", ETF, "Índice EUA", "S&P 500 em reais, exposição ao dólar"),
    Asset("SMAL11.SA", "iShares Small Caps", ETF, "Small caps Brasil"),
    Asset("DIVO11.SA", "It Now IDIV", ETF, "Dividendos Brasil"),
    # --- Ações: financeiro ---
    Asset("ITUB4.SA", "Itaú Unibanco", ACAO, "Financeiro"),
    Asset("BBAS3.SA", "Banco do Brasil", ACAO, "Financeiro"),
    Asset("BBDC4.SA", "Bradesco", ACAO, "Financeiro"),
    Asset("B3SA3.SA", "B3", ACAO, "Financeiro"),
    Asset("BPAC11.SA", "BTG Pactual", ACAO, "Financeiro"),
    # --- Ações: energia e petróleo ---
    Asset("PETR4.SA", "Petrobras", ACAO, "Petróleo e gás"),
    Asset("PRIO3.SA", "PRIO", ACAO, "Petróleo e gás"),
    Asset("ELET3.SA", "Eletrobras", ACAO, "Energia elétrica"),
    Asset("EQTL3.SA", "Equatorial", ACAO, "Energia elétrica"),
    Asset("TAEE11.SA", "Taesa", ACAO, "Energia elétrica"),
    Asset("CPLE6.SA", "Copel", ACAO, "Energia elétrica"),
    Asset("SBSP3.SA", "Sabesp", ACAO, "Saneamento"),
    # --- Ações: materiais básicos ---
    Asset("VALE3.SA", "Vale", ACAO, "Mineração"),
    Asset("GGBR4.SA", "Gerdau", ACAO, "Siderurgia"),
    Asset("SUZB3.SA", "Suzano", ACAO, "Papel e celulose"),
    Asset("KLBN11.SA", "Klabin", ACAO, "Papel e celulose"),
    # --- Ações: consumo e varejo ---
    Asset("ABEV3.SA", "Ambev", ACAO, "Bebidas"),
    Asset("LREN3.SA", "Lojas Renner", ACAO, "Varejo"),
    Asset("RADL3.SA", "Raia Drogasil", ACAO, "Varejo farmacêutico"),
    Asset("RENT3.SA", "Localiza", ACAO, "Aluguel de veículos"),
    Asset("JBSS3.SA", "JBS", ACAO, "Alimentos"),
    # --- Ações: indústria, saúde e tecnologia ---
    Asset("WEGE3.SA", "WEG", ACAO, "Bens industriais"),
    Asset("EMBR3.SA", "Embraer", ACAO, "Bens industriais"),
    Asset("RDOR3.SA", "Rede D'Or", ACAO, "Saúde"),
    Asset("HAPV3.SA", "Hapvida", ACAO, "Saúde"),
    Asset("TOTS3.SA", "Totvs", ACAO, "Tecnologia"),
    Asset("VIVT3.SA", "Vivo", ACAO, "Telecomunicações"),
    # --- FIIs (renda mensal) ---
    Asset("HGLG11.SA", "CSHG Logística", FII, "Galpões logísticos"),
    Asset("KNRI11.SA", "Kinea Renda Imobiliária", FII, "Híbrido: lajes e galpões"),
    Asset("MXRF11.SA", "Maxi Renda", FII, "Papel (CRI)"),
    Asset("XPML11.SA", "XP Malls", FII, "Shopping centers"),
    Asset("VISC11.SA", "Vinci Shopping Centers", FII, "Shopping centers"),
    Asset("KNCR11.SA", "Kinea Rendimentos", FII, "Papel (CRI pós-fixado)"),
    Asset("HGRU11.SA", "CSHG Renda Urbana", FII, "Varejo e educação"),
)

#: Critérios por perfil. Valores escolhidos para serem explicáveis, não ótimos.
PROFILE_CRITERIA: dict[str, dict[str, Any]] = {
    CONSERVADOR: {"max_volatility": 35.0, "max_pe": 20.0, "max_debt_equity": 120.0,
                  "min_dividend_yield": 3.0, "reject_downtrend": True},
    MODERADO: {"max_volatility": 45.0, "max_pe": 30.0, "max_debt_equity": 200.0,
               "min_dividend_yield": 0.0, "reject_downtrend": True},
    ARROJADO: {"max_volatility": 70.0, "max_pe": 45.0, "max_debt_equity": 300.0,
               "min_dividend_yield": 0.0, "reject_downtrend": False},
}

#: Liquidez mínima: volume financeiro médio diário (preço × volume) em 30 dias.
MIN_DAILY_VOLUME_BRL = 5_000_000.0


@dataclass
class Candidate:
    asset: Asset
    indicators: dict[str, Any]
    fundamentals: dict[str, Any]
    score: float = 0.0
    reasons: list[str] = field(default_factory=list)
    rejections: list[str] = field(default_factory=list)

    @property
    def approved(self) -> bool:
        return not self.rejections

    def summary(self) -> dict[str, Any]:
        """Resumo enxuto para o prompt do LLM e para a interface."""
        return {
            "ticker": self.asset.ticker,
            "name": self.asset.name,
            "asset_class": self.asset.asset_class,
            "sector": self.asset.sector,
            "score": round(self.score, 1),
            "price": self.indicators.get("price_current"),
            "change_30d": self.indicators.get("price_change_30d"),
            "change_1y": self.indicators.get("price_change_1y"),
            "rsi_14": self.indicators.get("rsi_14"),
            "volatility_30d": self.indicators.get("volatility_30d"),
            "trend": self.indicators.get("trend_signal"),
            "pe_ratio": self.fundamentals.get("pe_ratio"),
            "dividend_yield": self.fundamentals.get("dividend_yield"),
            "debt_to_equity": self.fundamentals.get("debt_to_equity"),
            "reasons": self.reasons,
        }


def universe_for(allocation: dict[str, float]) -> list[Asset]:
    """Ativos relevantes para as classes que têm peso na alocação."""
    wanted = {cls for cls, weight in (allocation or {}).items() if weight > 0}
    seen: set[str] = set()
    assets: list[Asset] = []
    for asset in UNIVERSE:
        if asset.asset_class in wanted and asset.ticker not in seen:
            seen.add(asset.ticker)
            assets.append(asset)
    return assets


def _daily_volume_brl(indicators: dict[str, Any]) -> float | None:
    price = indicators.get("price_current")
    volume = indicators.get("volume_avg_30d")
    if price is None or volume is None:
        return None
    return float(price) * float(volume)


def evaluate(asset: Asset, prices: Any, fundamentals: dict[str, Any],
             criteria: dict[str, Any]) -> Candidate:
    """Aplica os critérios a um ativo e devolve o candidato com o porquê."""
    indicators = calculate_indicators(prices)
    candidate = Candidate(asset=asset, indicators=indicators, fundamentals=fundamentals or {})

    if indicators.get("price_current") is None:
        candidate.rejections.append("sem dados de preço")
        return candidate

    volume_brl = _daily_volume_brl(indicators)
    if volume_brl is not None and volume_brl < MIN_DAILY_VOLUME_BRL:
        candidate.rejections.append(
            f"liquidez baixa (R$ {volume_brl/1e6:.1f} mi/dia)"
        )

    volatility = indicators.get("volatility_30d")
    if volatility is not None and volatility > criteria["max_volatility"]:
        candidate.rejections.append(
            f"volatilidade de {volatility:.0f}% acima do limite do perfil "
            f"({criteria['max_volatility']:.0f}%)"
        )

    if criteria["reject_downtrend"] and indicators.get("trend_signal") == "BAIXA":
        candidate.rejections.append("tendência de baixa (MM20 < MM50 < MM200)")

    # Fundamentos só valem para ações: ETF e FII não têm P/L comparável.
    if asset.asset_class == ACAO:
        pe = (fundamentals or {}).get("pe_ratio")
        if pe is not None:
            if pe <= 0:
                candidate.rejections.append("P/L negativo (prejuízo no período)")
            elif pe > criteria["max_pe"]:
                candidate.rejections.append(f"P/L de {pe:.1f} acima do limite ({criteria['max_pe']:.0f})")

        debt = (fundamentals or {}).get("debt_to_equity")
        if debt is not None and debt > criteria["max_debt_equity"]:
            candidate.rejections.append(
                f"dívida/patrimônio de {debt:.0f} acima do limite ({criteria['max_debt_equity']:.0f})"
            )

        dy = (fundamentals or {}).get("dividend_yield")
        if criteria["min_dividend_yield"] > 0:
            if dy is None:
                candidate.rejections.append("sem dividend yield informado")
            elif dy < criteria["min_dividend_yield"]:
                candidate.rejections.append(
                    f"dividend yield de {dy:.1f}% abaixo do mínimo "
                    f"({criteria['min_dividend_yield']:.0f}%)"
                )

    candidate.score, candidate.reasons = _score(candidate)
    return candidate


def _score(candidate: Candidate) -> tuple[float, list[str]]:
    """Pontuação 0-100 com os motivos em texto — tudo derivado de dado real."""
    indicators, fundamentals = candidate.indicators, candidate.fundamentals
    score, reasons = 50.0, []

    trend = indicators.get("trend_signal")
    if trend == "ALTA":
        score += 10
        reasons.append("tendência de alta (MM20 > MM50 > MM200)")
    elif trend == "BAIXA":
        score -= 10
        reasons.append("tendência de baixa")

    rsi = indicators.get("rsi_14")
    if rsi is not None:
        if rsi < 30:
            score += 8
            reasons.append(f"RSI {rsi:.0f}: sobrevendido, preço descontado no curto prazo")
        elif rsi > 70:
            score -= 8
            reasons.append(f"RSI {rsi:.0f}: sobrecomprado, entrada esticada")

    volatility = indicators.get("volatility_30d")
    if volatility is not None:
        if volatility < 25:
            score += 6
            reasons.append(f"volatilidade baixa ({volatility:.0f}% ao ano)")
        elif volatility > 50:
            score -= 6
            reasons.append(f"volatilidade alta ({volatility:.0f}% ao ano)")

    if candidate.asset.asset_class == ACAO:
        pe = fundamentals.get("pe_ratio")
        if pe is not None and 0 < pe <= 10:
            score += 8
            reasons.append(f"P/L de {pe:.1f}, múltiplo baixo")
        elif pe is not None and pe > 25:
            score -= 5
            reasons.append(f"P/L de {pe:.1f}, múltiplo alto")

        dy = fundamentals.get("dividend_yield")
        if dy is not None and dy >= 5:
            score += 8
            reasons.append(f"dividend yield de {dy:.1f}%")

        debt = fundamentals.get("debt_to_equity")
        if debt is not None and debt < 60:
            score += 5
            reasons.append(f"endividamento baixo (D/PL {debt:.0f})")

    change_1y = indicators.get("price_change_1y")
    if change_1y is not None and change_1y > 0:
        score += 3
        reasons.append(f"alta de {change_1y:.0f}% em 12 meses")

    return max(0.0, min(100.0, score)), reasons


def screen_detailed(
    profile_name: str,
    market_data: dict[str, dict[str, Any]],
    allocation: dict[str, float] | None = None,
) -> tuple[dict[str, list[Candidate]], list[Candidate]]:
    """Avalia o universo e devolve `(aprovados por classe, reprovados)`.

    Os reprovados voltam com o motivo preenchido, porque "por que PETR4 não
    entrou na minha carteira" é informação útil na interface — e deixa claro que
    o filtro é regra, não opinião.
    """
    criteria = PROFILE_CRITERIA.get(profile_name, PROFILE_CRITERIA[MODERADO])
    assets = universe_for(allocation) if allocation else list(UNIVERSE)

    by_class: dict[str, list[Candidate]] = {}
    rejected: list[Candidate] = []

    for asset in assets:
        payload = (market_data or {}).get(asset.ticker) or {}
        candidate = evaluate(asset, payload.get("prices"), payload.get("fundamentals", {}), criteria)
        if candidate.approved:
            by_class.setdefault(asset.asset_class, []).append(candidate)
        else:
            logger.debug("%s reprovado: %s", asset.ticker, "; ".join(candidate.rejections))
            rejected.append(candidate)

    for candidates in by_class.values():
        candidates.sort(key=lambda c: c.score, reverse=True)
    rejected.sort(key=lambda c: c.asset.ticker)
    return by_class, rejected


def screen(profile_name: str, market_data: dict[str, dict[str, Any]],
           allocation: dict[str, float] | None = None) -> dict[str, list[Candidate]]:
    """Só os aprovados por classe, do melhor ao pior."""
    approved, _rejected = screen_detailed(profile_name, market_data, allocation)
    return approved
