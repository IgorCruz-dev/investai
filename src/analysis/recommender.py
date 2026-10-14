"""Monta uma carteira sugerida a partir do perfil + dados reais de mercado.

Divisão de responsabilidades, de propósito:

- `src.onboarding.profile` decide **as camadas** (quanto em renda fixa, ETF, FII,
  ação) de forma determinística, a partir do questionário;
- `src.analysis.screener` decide **quais ativos** podem entrar, por critérios
  objetivos sobre dados reais;
- este módulo distribui os pesos dentro de cada camada e pede ao Claude a
  justificativa de cada escolha — sempre dentro da lista já aprovada.

O LLM nunca escolhe um ticker fora dos candidatos aprovados nem muda o peso das
camadas: se a resposta dele divergir, a validação descarta e cai no rateio
determinístico. Isso mantém a recomendação auditável.

Isto é material informativo e educacional, não recomendação formal de
investimento (ver aviso no topo do dashboard).
"""

from __future__ import annotations

import json
import logging
import math
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

from src.analysis.screener import ACAO, ETF, FII, Candidate, screen_detailed
from src.config import (
    LLM_EFFORT,
    LLM_MAX_TOKENS,
    LLM_MODEL,
    LLM_TIMEOUT,
    Portfolio,
    Position,
    anthropic_key,
)
from src.onboarding.profile import InvestorProfile
from src.utils.formatters import money, number, percent

logger = logging.getLogger(__name__)

#: Quantos ativos por classe entram na carteira sugerida. Mais que isso, para
#: quem começa com pouco, significa posições minúsculas e custo de acompanhar
#: alto sem ganho de diversificação.
MAX_ASSETS_PER_CLASS = {ETF: 2, FII: 3, ACAO: 5}

RENDA_FIXA_LABEL = "Tesouro Selic / CDB liquidez diária"

#: Valor mínimo por posição. Dividir R$ 1.000 entre 5 ações gera posições de
#: R$ 30 que não compram nem uma cota — melhor concentrar em menos ativos.
MIN_POSITION_BRL = 300.0

SYSTEM_PROMPT = """Você é um analista financeiro especializado em ações, ETFs e fundos imobiliários brasileiros.
Sua tarefa é distribuir pesos dentro de uma alocação JÁ DEFINIDA e justificar cada ativo.

REGRAS INVIOLÁVEIS:
- Use APENAS os ativos da lista de candidatos aprovados. Nunca sugira outro ticker.
- Respeite o peso total de cada classe (a soma dos pesos dos ativos de uma classe
  deve ser igual ao peso daquela classe na alocação).
- Justifique cada ativo citando explicitamente o dado que embasou a escolha
  (P/L, dividend yield, volatilidade, tendência, dívida/patrimônio, setor).
- Priorize diversificação setorial: não concentre a carteira em um só setor.
- Nunca prometa retorno. Seja explícito sobre incertezas e riscos.
- Escreva em português do Brasil, linguagem clara, sem jargão desnecessário.
- NÃO inclua a linha de renda fixa na lista de posições: ela é fixa e já está definida.
  Responda apenas com os ativos negociados em bolsa (ações, ETFs e FIIs).
"""

RESPONSE_SCHEMA: dict[str, Any] = {
    "type": "object",
    "additionalProperties": False,
    "required": ["positions", "summary", "risk_notes", "next_steps"],
    "properties": {
        "positions": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": ["ticker", "weight_pct", "rationale"],
                "properties": {
                    "ticker": {"type": "string"},
                    "weight_pct": {"type": "number"},
                    "rationale": {"type": "string"},
                },
            },
        },
        "summary": {"type": "string", "description": "Resumo em markdown da estratégia da carteira"},
        "risk_notes": {"type": "string", "description": "Principais riscos desta carteira, em markdown"},
        "next_steps": {"type": "array", "items": {"type": "string"}},
    },
}


@dataclass
class RecommendedPosition:
    ticker: str
    name: str
    asset_class: str
    weight_pct: float
    amount: float
    price: float | None = None
    shares: float = 0.0
    rationale: str = ""
    sector: str = ""

    @property
    def invested(self) -> float:
        if self.price is None:
            return self.amount
        return self.shares * self.price


@dataclass
class Recommendation:
    profile: str = ""
    allocation: dict[str, float] = field(default_factory=dict)
    positions: list[RecommendedPosition] = field(default_factory=list)
    summary: str = ""
    risk_notes: str = ""
    next_steps: list[str] = field(default_factory=list)
    source: str = "quantitativo"   # "claude" quando a justificativa veio do LLM
    generated_at: datetime | None = None
    error: str | None = None
    rejected: dict[str, list[str]] = field(default_factory=dict)

    @property
    def ok(self) -> bool:
        return bool(self.positions)

    @property
    def leftover(self) -> float:
        """Sobra de caixa por não ser possível comprar fração de cota."""
        return round(sum(p.amount - p.invested for p in self.positions), 2)

    def to_portfolio(self, currency: str = "BRL") -> Portfolio:
        """Converte em carteira **planejada** (sem preço de compra, sem P&L).

        Para renda fixa não existe cota: o campo `shares` guarda o valor em
        reais, e o cálculo da carteira trata essa classe com preço unitário 1.
        """
        return Portfolio(
            positions=tuple(
                Position(
                    ticker=p.ticker,
                    shares=round(p.amount if p.asset_class == "renda_fixa" else p.shares, 4),
                    avg_price=None,          # nada comprado ainda
                    asset_class=p.asset_class,
                    target_weight=p.weight_pct,
                )
                for p in self.positions
            ),
            currency=currency,
            planned=True,
        )


# --- Rateio determinístico --------------------------------------------------
def _pick(candidates: list[Candidate], limit: int) -> list[Candidate]:
    """Melhores candidatos, evitando concentrar o mesmo setor."""
    chosen: list[Candidate] = []
    sectors: set[str] = set()
    for candidate in candidates:
        sector = candidate.asset.sector
        if sector in sectors and len(chosen) < limit:
            continue  # tenta primeiro diversificar setor
        chosen.append(candidate)
        sectors.add(sector)
        if len(chosen) >= limit:
            break
    if len(chosen) < limit:  # sem diversidade suficiente, completa pelo score
        for candidate in candidates:
            if candidate not in chosen:
                chosen.append(candidate)
            if len(chosen) >= limit:
                break
    return chosen


def distribute(profile: InvestorProfile,
               by_class: dict[str, list[Candidate]]) -> list[RecommendedPosition]:
    """Divide cada camada entre os melhores candidatos, em pesos iguais."""
    positions: list[RecommendedPosition] = []
    investable = profile.investable_amount

    for asset_class, class_weight in (profile.allocation or {}).items():
        if class_weight <= 0:
            continue

        if asset_class == "renda_fixa":
            positions.append(RecommendedPosition(
                ticker=RENDA_FIXA_LABEL, name="Renda fixa pós-fixada", asset_class="renda_fixa",
                weight_pct=class_weight, amount=round(investable * class_weight / 100, 2),
                price=None, shares=1.0, sector="Renda fixa",
                rationale=(
                    "Camada de estabilidade e liquidez. Acompanha a Selic, tem liquidez diária e "
                    "serve de colchão para não precisar vender ação em queda."
                ),
            ))
            continue

        candidates = by_class.get(asset_class) or []
        if not candidates:
            logger.warning("Nenhum candidato aprovado para a classe %s", asset_class)
            continue

        class_amount = investable * class_weight / 100
        max_assets = MAX_ASSETS_PER_CLASS.get(asset_class, 3)
        if class_amount > 0:
            # Com pouco dinheiro, melhor menos ativos do que posições inviáveis.
            affordable = int(class_amount // MIN_POSITION_BRL)
            max_assets = max(1, min(max_assets, affordable or 1))

        chosen = _pick(candidates, max_assets)
        weight_each = class_weight / len(chosen)

        for candidate in chosen:
            price = candidate.indicators.get("price_current")
            amount = round(investable * weight_each / 100, 2)
            positions.append(RecommendedPosition(
                ticker=candidate.asset.ticker,
                name=candidate.asset.name,
                asset_class=asset_class,
                sector=candidate.asset.sector,
                weight_pct=round(weight_each, 2),
                amount=amount,
                price=price,
                shares=float(math.floor(amount / price)) if price else 0.0,
                rationale="; ".join(candidate.reasons) or "aprovado nos critérios do perfil",
            ))

    return positions


# --- Contexto para o LLM ----------------------------------------------------
def build_recommendation_context(profile: InvestorProfile,
                                 by_class: dict[str, list[Candidate]],
                                 positions: list[RecommendedPosition]) -> str:
    lines = [
        "# PERFIL DO INVESTIDOR",
        f"- Perfil calculado: {profile.profile} (score de risco {profile.risk_score:.0f}/100)",
        f"- Horizonte: {profile.horizon_years:.1f} anos",
        f"- Valor a investir agora: {money(profile.investable_amount)}",
        f"- Aporte mensal: {money(profile.monthly_contribution)}",
        f"- Custo de vida mensal: {money(profile.monthly_expenses)}",
        f"- Reserva de emergência: {money(profile.emergency_current)} de "
        f"{money(profile.emergency_target)} (faltam {money(profile.emergency_gap)})",
        "",
        "## RESPOSTAS RELEVANTES DO QUESTIONÁRIO",
    ]
    for key in ("priority", "knowledge", "main_goal", "horizon", "liquidity_need",
                "drawdown_reaction", "volatility_preference", "international", "experience"):
        value = profile.answers.get(key)
        if value:
            lines.append(f"- {key}: {value}")

    if profile.prerequisites:
        lines += ["", "## PRÉ-REQUISITOS IDENTIFICADOS"]
        for pre in profile.prerequisites:
            marca = "BLOQUEANTE" if pre.blocking else "atenção"
            valor = f" — {money(pre.amount)}" if pre.amount else ""
            lines.append(f"- [{marca}] {pre.title}{valor}")

    lines += ["", "## ALOCAÇÃO POR CLASSE (definida por regra, não negociável)"]
    for asset_class, weight in (profile.allocation or {}).items():
        if weight > 0:
            lines.append(f"- {asset_class}: {percent(weight, signed=False)}")

    if profile.notes:
        lines += ["", "## AJUSTES APLICADOS À ALOCAÇÃO"]
        lines += [f"- {note}" for note in profile.notes]

    lines += ["", "## CANDIDATOS APROVADOS NO FILTRO QUANTITATIVO",
              "(use apenas estes tickers; os dados abaixo vêm do yfinance)"]
    for asset_class, candidates in by_class.items():
        if not candidates:
            continue
        lines.append(f"### classe {asset_class} (máximo {MAX_ASSETS_PER_CLASS.get(asset_class, 3)} ativos)")
        for candidate in candidates:
            s = candidate.summary()
            lines.append(
                f"- {s['ticker']} ({s['name']}, {s['sector']}): preço {money(s['price'])} | "
                f"score {number(s['score'], 0)} | P/L {number(s['pe_ratio'])} | "
                f"DY {percent(s['dividend_yield'], signed=False)} | "
                f"D/PL {number(s['debt_to_equity'], 0)} | "
                f"volatilidade {percent(s['volatility_30d'], signed=False)} | "
                f"RSI {number(s['rsi_14'], 0)} | tendência {s['trend']} | "
                f"12m {percent(s['change_1y'])}"
            )

    lines += ["", "## RATEIO PADRÃO (pesos iguais dentro de cada classe)",
              "Você pode ajustar os pesos dentro de cada classe, mantendo o total da classe:"]
    for position in positions:
        lines.append(
            f"- {position.ticker}: {percent(position.weight_pct, signed=False)} "
            f"({money(position.amount)})"
        )
    return "\n".join(lines)


def _merge_llm_positions(positions: list[RecommendedPosition],
                         llm_positions: list[dict[str, Any]],
                         allocation: dict[str, float],
                         investable: float) -> list[RecommendedPosition] | None:
    """Aplica pesos e justificativas do LLM, validando contra as regras.

    Devolve `None` quando a resposta viola o contrato (ticker desconhecido ou
    peso de classe divergente) — nesse caso o rateio determinístico prevalece.
    """
    # Comparação sem caixa: a linha de renda fixa tem caixa mista no rótulo.
    by_ticker = {p.ticker.upper(): p for p in positions}
    updates: dict[str, tuple[float, str]] = {}

    for item in llm_positions or []:
        ticker = str(item.get("ticker", "")).strip().upper()
        position = by_ticker.get(ticker)
        if position is None:
            logger.warning("LLM sugeriu ticker fora dos candidatos: %s", ticker)
            return None
        if position.asset_class == "renda_fixa":
            continue  # camada fixa: peso definido por regra, não pelo LLM
        try:
            weight = float(item.get("weight_pct"))
        except (TypeError, ValueError):
            return None
        if weight <= 0:
            continue
        updates[position.ticker] = (weight, str(item.get("rationale", "")).strip())

    if not updates:
        return None

    merged: list[RecommendedPosition] = []
    for position in positions:
        if position.asset_class == "renda_fixa":
            merged.append(position)  # camada de renda fixa não é negociada pelo LLM
            continue
        if position.ticker not in updates:
            continue  # LLM optou por não incluir este ativo
        weight, rationale = updates[position.ticker]
        merged.append(RecommendedPosition(
            ticker=position.ticker, name=position.name, asset_class=position.asset_class,
            sector=position.sector, weight_pct=round(weight, 2),
            amount=round(investable * weight / 100, 2), price=position.price,
            shares=float(math.floor(investable * weight / 100 / position.price)) if position.price else 0.0,
            rationale=rationale or position.rationale,
        ))

    # Validação: o peso de cada classe deve bater com a alocação (tolerância de 2 p.p.).
    for asset_class, target in (allocation or {}).items():
        if target <= 0 or asset_class == "renda_fixa":
            continue
        total = sum(p.weight_pct for p in merged if p.asset_class == asset_class)
        if abs(total - target) > 2.0:
            logger.warning(
                "LLM devolveu %.1f%% para a classe %s, esperado %.1f%% — usando rateio padrão",
                total, asset_class, target,
            )
            return None

    return merged


# --- API pública ------------------------------------------------------------
def recommend(profile: InvestorProfile, market_data: dict[str, dict[str, Any]],
              use_llm: bool = True, currency: str = "BRL") -> Recommendation:
    """Gera a carteira sugerida. Nunca levanta exceção."""
    by_class, rejected_candidates = screen_detailed(
        profile.profile, market_data, profile.allocation
    )
    positions = distribute(profile, by_class)

    rejected: dict[str, list[str]] = {}
    for candidate in rejected_candidates:
        rejected.setdefault(candidate.asset.asset_class, []).append(
            f"{candidate.asset.ticker} ({candidate.asset.name}): "
            + "; ".join(candidate.rejections)
        )

    recommendation = Recommendation(
        profile=profile.profile,
        allocation=profile.allocation,
        positions=positions,
        generated_at=datetime.now(),
        summary=_fallback_summary(profile, positions),
        risk_notes=_fallback_risks(profile),
        next_steps=_fallback_next_steps(profile),
        rejected=rejected,
    )

    if not positions:
        recommendation.error = (
            "Nenhum ativo passou pelos critérios do seu perfil com os dados atuais. "
            "Tente atualizar os dados de mercado ou revise o questionário."
        )
        return recommendation

    # A camada de renda fixa não depende de cotação, então ela sai mesmo com o
    # yfinance fora do ar — mas aí a carteira está incompleta e isso precisa
    # ficar explícito, em vez de parecer uma recomendação deliberada.
    if all(p.asset_class == "renda_fixa" for p in positions):
        recommendation.error = (
            "Não foi possível avaliar nenhum ativo de bolsa com os dados disponíveis agora "
            "(yfinance indisponível ou sem histórico). Abaixo está apenas a camada de renda "
            "fixa; atualize os dados e gere a recomendação de novo para a parte de risco."
        )
        return recommendation

    if not use_llm or not anthropic_key():
        return recommendation

    context = build_recommendation_context(profile, by_class, positions)
    try:
        import anthropic

        client = anthropic.Anthropic(timeout=LLM_TIMEOUT, max_retries=2)
        with client.messages.stream(
            model=LLM_MODEL,
            max_tokens=LLM_MAX_TOKENS,
            system=SYSTEM_PROMPT,
            thinking={"type": "adaptive"},
            output_config={
                "effort": LLM_EFFORT,
                "format": {"type": "json_schema", "schema": RESPONSE_SCHEMA},
            },
            messages=[{"role": "user", "content":
                       "Monte a carteira sugerida com base no perfil e nos candidatos abaixo.\n\n"
                       + context}],
        ) as stream:
            message = stream.get_final_message()
    except Exception as exc:  # noqa: BLE001 — fronteira: cai no determinístico
        logger.warning("Recomendação sem apoio do LLM (%s)", exc)
        recommendation.error = (
            f"Não foi possível consultar o Claude ({exc}). A carteira abaixo veio apenas do "
            "filtro quantitativo."
        )
        return recommendation

    text = "".join(b.text for b in message.content if b.type == "text").strip()
    try:
        payload = json.loads(text)
    except json.JSONDecodeError as exc:
        logger.warning("Resposta do LLM não era JSON válido: %s", exc)
        return recommendation

    merged = _merge_llm_positions(
        positions, payload.get("positions"), profile.allocation, profile.investable_amount
    )
    if merged:
        recommendation.positions = merged
        recommendation.source = "claude"
        recommendation.summary = str(payload.get("summary") or recommendation.summary)
        recommendation.risk_notes = str(payload.get("risk_notes") or recommendation.risk_notes)
        steps = payload.get("next_steps")
        if isinstance(steps, list) and steps:
            recommendation.next_steps = [str(s) for s in steps]

    return recommendation


# --- Textos do modo determinístico ------------------------------------------
def _fallback_summary(profile: InvestorProfile, positions: list[RecommendedPosition]) -> str:
    if not positions:
        return ""
    linhas = [
        f"Carteira sugerida para perfil **{profile.profile}** "
        f"(score {profile.risk_score:.0f}/100, horizonte de {profile.horizon_years:.0f} anos), "
        f"com {money(profile.investable_amount)} disponíveis para investir agora.",
        "",
        "A divisão por classe vem de regra determinística baseada no seu questionário, e os "
        "ativos de cada classe foram escolhidos por filtro quantitativo sobre dados reais "
        "(liquidez, múltiplos, endividamento, volatilidade e tendência).",
    ]
    return "\n".join(linhas)


def _fallback_risks(profile: InvestorProfile) -> str:
    riscos = [
        "- **Concentração em Brasil:** mesmo com ETF internacional, a maior parte da carteira "
        "fica exposta ao ciclo econômico e político brasileiro.",
        "- **Oscilação de curto prazo:** a parte de ações e FIIs pode cair 20% ou mais em "
        "crises, sem que isso signifique que a tese está errada.",
    ]
    if profile.emergency_gap > 0:
        riscos.append(
            "- **Reserva incompleta:** enquanto ela não estiver pronta, qualquer imprevisto "
            "pode forçar a venda de ativos no pior momento."
        )
    if profile.horizon_years < 5:
        riscos.append(
            f"- **Horizonte curto ({profile.horizon_years:.0f} anos):** há risco real de "
            "precisar resgatar em um momento de queda."
        )
    return "\n".join(riscos)


def _fallback_next_steps(profile: InvestorProfile) -> list[str]:
    steps: list[str] = []
    for pre in profile.prerequisites:
        steps.append(pre.title)
    steps.append("Abrir conta em uma corretora e executar as compras aos poucos, não tudo de uma vez")
    if profile.monthly_contribution > 0:
        steps.append(
            f"Automatizar o aporte mensal de {money(profile.monthly_contribution)} e rebalancear "
            "a carteira a cada 6 meses"
        )
    steps.append("Reavaliar o perfil depois da primeira queda forte de mercado que você viver")
    return steps
