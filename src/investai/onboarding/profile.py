"""Do questionário ao perfil: score de risco, pré-requisitos e alocação-alvo.

Regra central do módulo: **ordem antes de otimização**. Para quem está começando,
a sequência financeiramente correta é dívida de juros altos → reserva de
emergência → diversificação ampla → ativos individuais. Um sistema que pula
direto para "compre estas 5 ações" dá uma resposta tecnicamente errada, por mais
bem fundamentada que a escolha das ações esteja.

Toda decisão aqui é determinística e auditável — o LLM entra depois, para
escolher e justificar ativos dentro das camadas que este módulo definiu.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Any

from investai.onboarding.questionnaire import QUESTIONS_BY_KEY

logger = logging.getLogger(__name__)

CONSERVADOR, MODERADO, ARROJADO = "Conservador", "Moderado", "Arrojado"
PROFILES = (CONSERVADOR, MODERADO, ARROJADO)

#: Meses de despesa que a reserva de emergência deve cobrir.
EMERGENCY_MONTHS = 6

#: Pesos por pergunta no score de risco. Reação a queda e horizonte pesam mais
#: porque são os dois fatores que de fato determinam se a pessoa suporta
#: volatilidade — o resto contextualiza.
RISK_WEIGHTS: dict[str, float] = {
    "drawdown_reaction": 3.0,
    "horizon": 3.0,
    "volatility_preference": 2.0,
    "main_goal": 1.5,
    "liquidity_need": 1.5,
    "emergency_fund": 1.5,
    "expensive_debt": 1.0,
    "income_stability": 1.0,
    "knowledge": 1.0,
    "experience": 1.0,
}

#: Faixas do score (0-100) → perfil. O corte de "arrojado" é alto de propósito:
#: horizonte longo e boa intenção declarada inflam o score com facilidade, e
#: suportar queda de verdade exige mais do que prazo.
PROFILE_BANDS = ((40.0, CONSERVADOR), (72.0, MODERADO), (100.1, ARROJADO))

#: Produtos cuja experiência prévia habilita o perfil arrojado.
RISKY_EXPERIENCE = frozenset({"acoes", "fiis", "exterior", "cripto", "fundos"})

#: Alocação-alvo por perfil (% do valor investível, depois dos pré-requisitos).
TARGET_ALLOCATION: dict[str, dict[str, float]] = {
    CONSERVADOR: {"renda_fixa": 70.0, "etf": 20.0, "fii": 10.0, "acao": 0.0},
    MODERADO: {"renda_fixa": 40.0, "etf": 30.0, "fii": 15.0, "acao": 15.0},
    ARROJADO: {"renda_fixa": 15.0, "etf": 35.0, "fii": 15.0, "acao": 35.0},
}

MONTHLY_INCOME_MIDPOINT: dict[str, float] = {
    "estudante": 0.0, "desempregado": 0.0, "ate_4500": 3_000.0,
    "4500_10k": 7_250.0, "10k_25k": 17_500.0, "25k_60k": 42_500.0,
    "acima_60k": 80_000.0,
}

HORIZON_YEARS: dict[str, float] = {
    "ate_1a": 0.5, "1_3a": 2.0, "3_5a": 4.0, "5_10a": 7.5, "acima_10a": 12.0,
}


@dataclass
class Prerequisite:
    """Passo que deve vir antes (ou junto) de investir em bolsa."""

    key: str
    title: str
    detail: str
    amount: float | None = None
    blocking: bool = False  # True = trava a alocação em ativos de risco


@dataclass
class InvestorProfile:
    answers: dict[str, Any] = field(default_factory=dict)
    risk_score: float = 0.0
    profile: str = MODERADO
    horizon_years: float = 0.0
    monthly_expenses: float = 0.0
    monthly_contribution: float = 0.0
    initial_amount: float = 0.0
    emergency_target: float = 0.0
    emergency_current: float = 0.0
    emergency_gap: float = 0.0
    investable_amount: float = 0.0
    prerequisites: list[Prerequisite] = field(default_factory=list)
    allocation: dict[str, float] = field(default_factory=dict)
    notes: list[str] = field(default_factory=list)

    @property
    def is_blocked(self) -> bool:
        """True quando há pré-requisito que impede alocação em risco."""
        return any(p.blocking for p in self.prerequisites)

    def to_dict(self) -> dict[str, Any]:
        return {
            "answers": self.answers,
            "risk_score": round(self.risk_score, 1),
            "profile": self.profile,
            "horizon_years": self.horizon_years,
            "monthly_expenses": self.monthly_expenses,
            "monthly_contribution": self.monthly_contribution,
            "initial_amount": self.initial_amount,
            "emergency_target": self.emergency_target,
            "emergency_current": self.emergency_current,
            "emergency_gap": self.emergency_gap,
            "investable_amount": self.investable_amount,
            "allocation": self.allocation,
            "prerequisites": [
                {"key": p.key, "title": p.title, "detail": p.detail,
                 "amount": p.amount, "blocking": p.blocking}
                for p in self.prerequisites
            ],
            "notes": self.notes,
        }


# --- Score ------------------------------------------------------------------
def _points_for(key: str, answer: Any) -> tuple[float, float] | None:
    """(pontos obtidos, pontos máximos) de uma resposta. `None` se não pontua."""
    question = QUESTIONS_BY_KEY.get(key)
    if question is None or not question.choices:
        return None

    scored = [c for c in question.choices if c.risk_points is not None]
    if not scored:
        return None
    max_points = max(c.risk_points for c in scored)

    if question.kind == "multi":
        if answer is None:
            return None  # não respondeu ≠ "nunca investi em nada"
        points = [c.risk_points for c in scored if c.value in (answer or [])]
        # Experiência conta o produto mais arriscado já usado, não a soma.
        return (float(max(points)) if points else 0.0), float(max_points)

    choice = question.choice(str(answer)) if answer is not None else None
    if choice is None or choice.risk_points is None:
        return None
    return float(choice.risk_points), float(max_points)


def calculate_risk_score(answers: dict[str, Any]) -> float:
    """Score de 0 a 100 — média ponderada das respostas que medem risco.

    Perguntas não respondidas simplesmente não entram (nem no numerador nem no
    denominador), em vez de contarem como zero e empurrarem todo mundo para
    conservador por omissão.
    """
    total_weight = 0.0
    total_points = 0.0

    for key, weight in RISK_WEIGHTS.items():
        result = _points_for(key, answers.get(key))
        if result is None:
            continue
        points, max_points = result
        if max_points <= 0:
            continue
        total_points += weight * (points / max_points)
        total_weight += weight

    if total_weight == 0:
        return 0.0
    return round(total_points / total_weight * 100, 1)


def classify(risk_score: float, answers: dict[str, Any] | None = None) -> str:
    """Perfil a partir do score, com teto para quem nunca investiu em risco.

    Quem se declara iniciante e nunca comprou ativo de risco não é arrojado por
    ter horizonte longo — a tolerância a queda só se comprova vivendo uma. Sem
    esse teto, o questionário classificaria como arrojado alguém cuja primeira
    experiência com volatilidade ainda vai acontecer.
    """
    profile = ARROJADO
    for limit, name in PROFILE_BANDS:
        if risk_score < limit:
            profile = name
            break

    answers = answers or {}
    never_risked = not (RISKY_EXPERIENCE & set(answers.get("experience") or []))
    if profile == ARROJADO and answers.get("knowledge") == "iniciante" and never_risked:
        return MODERADO
    return profile


# --- Pré-requisitos ---------------------------------------------------------
def _emergency_months(answer: str | None) -> float:
    return {"nenhuma": 0.0, "ate_3m": 1.5, "3_6m": 4.5, "acima_6m": 6.0}.get(answer or "", 0.0)


def build_prerequisites(answers: dict[str, Any], monthly_expenses: float,
                        emergency_gap: float) -> list[Prerequisite]:
    prerequisites: list[Prerequisite] = []

    debt = answers.get("expensive_debt")
    if debt == "significativas":
        prerequisites.append(Prerequisite(
            key="divida",
            title="Quitar as dívidas de juros altos antes de investir em bolsa",
            detail=(
                "Cartão de crédito e cheque especial no Brasil cobram juros muito acima do "
                "retorno esperado de qualquer carteira de ações. Enquanto a dívida existe, "
                "cada real usado para quitá-la rende mais (com certeza) do que investido."
            ),
            blocking=True,
        ))
    elif debt == "pequenas":
        prerequisites.append(Prerequisite(
            key="divida_pequena",
            title="Liquidar as dívidas pequenas de juros altos em paralelo",
            detail="Não trava o início dos investimentos, mas deve ser resolvido nos primeiros meses.",
        ))

    if emergency_gap > 0:
        prerequisites.append(Prerequisite(
            key="reserva",
            title=f"Completar a reserva de emergência ({EMERGENCY_MONTHS} meses de despesas)",
            detail=(
                "A reserva fica em liquidez diária (Tesouro Selic ou CDB com liquidez diária), "
                "não em ações: o objetivo dela é estar disponível justamente quando a bolsa "
                "estiver caindo. Sem ela, qualquer imprevisto força venda no pior momento."
            ),
            amount=round(emergency_gap, 2),
            blocking=monthly_expenses > 0 and emergency_gap >= monthly_expenses * 3,
        ))

    if answers.get("income_stability") == "instavel":
        prerequisites.append(Prerequisite(
            key="renda",
            title="Renda instável pede reserva maior e aporte conservador",
            detail="Com renda imprevisível, o risco de precisar resgatar no momento errado sobe muito.",
        ))

    return prerequisites


# --- Alocação ---------------------------------------------------------------
def _adjust_allocation(base: dict[str, float], answers: dict[str, Any],
                       horizon_years: float) -> tuple[dict[str, float], list[str]]:
    allocation = dict(base)
    notes: list[str] = []

    if horizon_years < 2:
        allocation = {"renda_fixa": 90.0, "etf": 10.0, "fii": 0.0, "acao": 0.0}
        notes.append(
            "Horizonte abaixo de 2 anos: a alocação foi forçada para renda fixa, porque ação "
            "com prazo curto é aposta, não investimento."
        )
    elif horizon_years < 4 and allocation.get("acao", 0) > 15:
        shifted = allocation["acao"] - 15
        allocation["acao"] = 15.0
        allocation["renda_fixa"] += shifted
        notes.append(
            f"Horizonte de {horizon_years:.0f} anos: a fatia de ações individuais foi limitada a "
            "15% e o excedente foi para renda fixa."
        )

    if answers.get("liquidity_need") == "alta" and allocation["renda_fixa"] < 50:
        delta = 50 - allocation["renda_fixa"]
        allocation["renda_fixa"] = 50.0
        for key in ("acao", "fii", "etf"):
            take = min(delta, allocation[key])
            allocation[key] -= take
            delta -= take
            if delta <= 0:
                break
        notes.append(
            "Alta chance de resgate antecipado: metade da carteira foi para renda fixa líquida."
        )

    if answers.get("main_goal") == "renda_passiva" and allocation["fii"] < 25 and allocation["acao"] > 0:
        shift = min(10.0, allocation["acao"])
        allocation["acao"] -= shift
        allocation["fii"] += shift
        notes.append(
            "Objetivo é renda passiva: peso maior em fundos imobiliários, que distribuem "
            "rendimento mensal."
        )

    if answers.get("knowledge") == "iniciante" and allocation["acao"] > 20:
        shift = allocation["acao"] - 20
        allocation["acao"] = 20.0
        allocation["etf"] += shift
        notes.append(
            "Perfil iniciante: parte das ações individuais virou ETF amplo, que entrega "
            "diversificação sem exigir análise ativa de cada empresa."
        )

    total = sum(allocation.values())
    if total > 0:
        allocation = {k: round(v / total * 100, 1) for k, v in allocation.items()}
    return allocation, notes


def build_profile(answers: dict[str, Any]) -> InvestorProfile:
    """Transforma as respostas do questionário no perfil completo."""
    answers = dict(answers or {})

    monthly_expenses = float(answers.get("monthly_expenses") or 0.0)
    initial_amount = float(answers.get("initial_amount") or 0.0)
    monthly_contribution = float(answers.get("monthly_contribution") or 0.0)

    risk_score = calculate_risk_score(answers)
    profile_name = classify(risk_score, answers)
    horizon_years = HORIZON_YEARS.get(answers.get("horizon", ""), 5.0)

    emergency_target = monthly_expenses * EMERGENCY_MONTHS
    emergency_current = monthly_expenses * _emergency_months(answers.get("emergency_fund"))
    emergency_gap = max(0.0, emergency_target - emergency_current)

    prerequisites = build_prerequisites(answers, monthly_expenses, emergency_gap)

    # O dinheiro vai primeiro para a reserva; só o excedente entra em risco.
    investable = max(0.0, initial_amount - emergency_gap)
    if any(p.key == "divida" for p in prerequisites):
        investable = 0.0

    allocation, notes = _adjust_allocation(
        TARGET_ALLOCATION[profile_name], answers, horizon_years
    )

    if (profile_name == MODERADO and risk_score >= PROFILE_BANDS[1][0]
            and answers.get("knowledge") == "iniciante"):
        notes.append(
            f"Seu score ({risk_score:.0f}) daria perfil arrojado, mas como você está começando "
            "e ainda não passou por uma queda real de mercado, o perfil foi limitado a moderado. "
            "Depois de alguns meses investindo, vale refazer o questionário."
        )
    if answers.get("international") == "nao":
        notes.append("Sem exposição internacional, por escolha sua: os ETFs ficam restritos ao Brasil.")
    if monthly_contribution > 0 and investable == 0 and emergency_gap > 0 and monthly_expenses > 0:
        meses = emergency_gap / monthly_contribution if monthly_contribution else 0
        # O `.replace` para trocar o separador de milhar precisa valer só para o
        # número. Aplicado à frase toda, ele comia a vírgula de "por mês," e a
        # nota saía com um ponto no meio: "por mês. a reserva fica completa".
        aporte = f"{monthly_contribution:,.0f}".replace(",", ".")
        notes.append(
            f"Com aportes de R$ {aporte} por mês, a reserva fica completa em "
            f"cerca de {meses:.0f} meses — a partir daí a alocação abaixo passa a valer."
        )

    return InvestorProfile(
        answers=answers,
        risk_score=risk_score,
        profile=profile_name,
        horizon_years=horizon_years,
        monthly_expenses=monthly_expenses,
        monthly_contribution=monthly_contribution,
        initial_amount=initial_amount,
        emergency_target=round(emergency_target, 2),
        emergency_current=round(emergency_current, 2),
        emergency_gap=round(emergency_gap, 2),
        investable_amount=round(investable, 2),
        prerequisites=prerequisites,
        allocation=allocation,
        notes=notes,
    )
