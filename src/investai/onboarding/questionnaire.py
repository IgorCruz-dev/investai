"""Questionário de onboarding: perfil do investidor e objetivos.

Combina duas origens:

1. **As 5 perguntas úteis do diagnóstico da AUVP (Raul Sena)** — nota honesta
   para a própria situação financeira, comprometimento com os objetivos,
   prioridade dos próximos 12 meses, nível de conhecimento e faixa de renda.
   O formulário original tem 14 campos, mas 9 são captação de lead (nome,
   WhatsApp, "como descobriu", disposição de pagar o curso) e não dizem nada
   sobre perfil de investimento.

2. **As dimensões de suitability** que a regulação brasileira exige para
   recomendar produto a investidor (CVM/ANBIMA) e que faltavam no formulário:
   reserva de emergência, dívidas caras, horizonte, necessidade de liquidez,
   capacidade de aporte, estabilidade de renda, reação a queda e experiência
   com produtos. Sem elas não é possível sustentar uma alocação.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Literal

QuestionKind = Literal["scale", "choice", "multi", "number"]


@dataclass(frozen=True)
class Choice:
    value: str
    label: str
    #: Pontos de tolerância a risco (0 = mais conservador). `None` = não pontua.
    risk_points: int | None = None
    help: str = ""


@dataclass(frozen=True)
class Question:
    key: str
    prompt: str
    kind: QuestionKind
    step: str
    choices: tuple[Choice, ...] = ()
    help: str = ""
    required: bool = True
    min_value: float = 0.0
    max_value: float = 1_000_000.0
    step_value: float = 100.0
    source: str = "suitability"  # "auvp" quando vem do diagnóstico do Raul Sena

    def choice(self, value: str) -> Choice | None:
        return next((c for c in self.choices if c.value == value), None)


STEPS: tuple[tuple[str, str], ...] = (
    ("situacao", "Sua situação hoje"),
    ("capacidade", "Capacidade financeira"),
    ("objetivos", "Objetivos e prazo"),
    ("risco", "Tolerância a risco"),
)

QUESTIONS: tuple[Question, ...] = (
    # ---------------- Bloco 1: situação (base AUVP) ----------------
    Question(
        key="financial_health", step="situacao", kind="scale", source="auvp",
        prompt="Sendo honesto, que nota você daria para a sua situação financeira atual?",
        help="1 = muito ruim, 10 = excelente. Vale responder sem romantizar.",
        min_value=1, max_value=10, step_value=1,
    ),
    Question(
        key="commitment", step="situacao", kind="scale", source="auvp",
        prompt="Que nota você daria para o seu comprometimento com seus objetivos de vida?",
        help="1 = baixo, 10 = total.",
        min_value=1, max_value=10, step_value=1,
    ),
    Question(
        key="priority", step="situacao", kind="choice", source="auvp",
        prompt="Qual é sua PRINCIPAL prioridade financeira para os próximos 12 meses?",
        choices=(
            Choice("patrimonio", "Construir um patrimônio sólido através de investimentos"),
            Choice("renda_passiva", "Aumentar minha renda e criar fontes de renda passiva"),
            Choice("dividas", "Quitar dívidas e organizar minha vida financeira"),
            Choice("bens", "Comprar bens que preciso (carro, casa, moto…)"),
            Choice("manter", "Manter minha situação atual, estou satisfeito assim"),
        ),
    ),
    Question(
        key="knowledge", step="situacao", kind="choice", source="auvp",
        prompt="Sobre seu conhecimento em investimentos…",
        choices=(
            Choice("iniciante", "Sou iniciante e estou pronto pra aprender", risk_points=0),
            Choice("tentei", "Já tentei investir, mas me perdi no caminho", risk_points=1),
            Choice("sem_consistencia", "Já invisto, mas sem consistência ou clareza", risk_points=2),
            Choice("profissionalizar", "Quero profissionalizar minha forma de investir", risk_points=3),
        ),
    ),
    Question(
        key="income_range", step="situacao", kind="choice", source="auvp",
        prompt="Quanto você ganha em média por mês?",
        choices=(
            Choice("estudante", "Sou estudante"),
            Choice("desempregado", "Sou desempregado"),
            Choice("ate_4500", "Menos de R$ 4.500"),
            Choice("4500_10k", "De R$ 4.500 a R$ 10 mil"),
            Choice("10k_25k", "De R$ 10 mil a R$ 25 mil"),
            Choice("25k_60k", "De R$ 25 mil a R$ 60 mil"),
            Choice("acima_60k", "Mais de R$ 60 mil"),
        ),
    ),

    # ---------------- Bloco 2: capacidade ----------------
    Question(
        key="monthly_expenses", step="capacidade", kind="number",
        prompt="Qual é o seu custo de vida mensal, em reais?",
        help="Usado para dimensionar a reserva de emergência (6 meses de despesas).",
        min_value=0, max_value=500_000, step_value=100,
    ),
    Question(
        key="initial_amount", step="capacidade", kind="number",
        prompt="Quanto você tem disponível para começar a investir agora?",
        help="Dinheiro livre, que não é da reserva de emergência já existente.",
        min_value=0, max_value=100_000_000, step_value=500,
    ),
    Question(
        key="monthly_contribution", step="capacidade", kind="number",
        prompt="Quanto você consegue aportar por mês, de forma realista?",
        min_value=0, max_value=1_000_000, step_value=100,
    ),
    Question(
        key="emergency_fund", step="capacidade", kind="choice",
        prompt="Você tem reserva de emergência?",
        help="Dinheiro de liquidez imediata para imprevistos, separado dos investimentos.",
        choices=(
            Choice("nenhuma", "Não tenho", risk_points=0),
            Choice("ate_3m", "Tenho menos de 3 meses de despesas", risk_points=1),
            Choice("3_6m", "Tenho de 3 a 6 meses de despesas", risk_points=2),
            Choice("acima_6m", "Tenho mais de 6 meses de despesas", risk_points=3),
        ),
    ),
    Question(
        key="expensive_debt", step="capacidade", kind="choice",
        prompt="Você tem dívidas de juros altos (cartão de crédito, cheque especial, empréstimo pessoal)?",
        choices=(
            Choice("significativas", "Sim, valores significativos", risk_points=0),
            Choice("pequenas", "Sim, mas valores pequenos", risk_points=1),
            Choice("nenhuma", "Não tenho", risk_points=3),
        ),
    ),
    Question(
        key="income_stability", step="capacidade", kind="choice",
        prompt="Como é a estabilidade da sua renda?",
        choices=(
            Choice("instavel", "Instável — não sei quanto entra mês que vem", risk_points=0),
            Choice("variavel", "Variável — autônomo, comissionado ou PJ", risk_points=1),
            Choice("estavel", "Estável — CLT, servidor ou renda previsível", risk_points=3),
        ),
    ),

    # ---------------- Bloco 3: objetivos ----------------
    Question(
        key="main_goal", step="objetivos", kind="choice",
        prompt="Qual é o objetivo principal deste dinheiro?",
        choices=(
            Choice("reserva", "Formar e proteger minha reserva", risk_points=0),
            Choice("meta_curta", "Uma meta específica em poucos anos (imóvel, carro, intercâmbio)", risk_points=1),
            Choice("renda_passiva", "Construir renda passiva mensal", risk_points=2),
            Choice("aposentadoria", "Aposentadoria / independência financeira", risk_points=3),
            Choice("crescimento", "Crescimento máximo do patrimônio no longo prazo", risk_points=4),
        ),
    ),
    Question(
        key="horizon", step="objetivos", kind="choice",
        prompt="Em quanto tempo você pretende usar esse dinheiro?",
        choices=(
            Choice("ate_1a", "Menos de 1 ano", risk_points=0),
            Choice("1_3a", "De 1 a 3 anos", risk_points=1),
            Choice("3_5a", "De 3 a 5 anos", risk_points=2),
            Choice("5_10a", "De 5 a 10 anos", risk_points=3),
            Choice("acima_10a", "Mais de 10 anos", risk_points=4),
        ),
    ),
    Question(
        key="liquidity_need", step="objetivos", kind="choice",
        prompt="Qual a chance de você precisar resgatar antes do prazo?",
        choices=(
            Choice("alta", "Alta — pode acontecer a qualquer momento", risk_points=0),
            Choice("media", "Média — só em caso de imprevisto", risk_points=2),
            Choice("baixa", "Baixa — esse dinheiro pode ficar parado", risk_points=3),
        ),
    ),
    Question(
        key="international", step="objetivos", kind="choice",
        prompt="Você quer exposição a ativos no exterior (dólar, bolsa americana)?",
        choices=(
            Choice("sim", "Sim, quero diversificar para fora do Brasil"),
            Choice("indiferente", "Tanto faz, decida pelos dados"),
            Choice("nao", "Não, prefiro ficar só no Brasil"),
        ),
    ),

    # ---------------- Bloco 4: risco ----------------
    Question(
        key="drawdown_reaction", step="risco", kind="choice",
        prompt="Sua carteira cai 30% em um mês de crise. O que você faz?",
        help="A resposta honesta aqui vale mais que qualquer teoria sobre risco.",
        choices=(
            Choice("vendo_tudo", "Vendo tudo para não perder mais", risk_points=0),
            Choice("vendo_parte", "Vendo parte e espero para entender", risk_points=1),
            Choice("nao_faco_nada", "Não faço nada e sigo o plano", risk_points=3),
            Choice("aporto_mais", "Aproveito e aporto mais", risk_points=4),
        ),
    ),
    Question(
        key="volatility_preference", step="risco", kind="choice",
        prompt="Entre estas opções, qual te descreve melhor?",
        choices=(
            Choice("previsivel", "Prefiro ganho menor, mas previsível", risk_points=0),
            Choice("equilibrio", "Aceito alguma oscilação por um retorno melhor", risk_points=2),
            Choice("agressivo", "Aceito oscilação forte buscando o maior retorno", risk_points=4),
        ),
    ),
    Question(
        key="experience", step="risco", kind="multi",
        prompt="Com quais produtos você já investiu?",
        required=False,
        choices=(
            Choice("poupanca", "Poupança", risk_points=0),
            Choice("renda_fixa", "Tesouro Direto, CDB, LCI/LCA", risk_points=1),
            Choice("fundos", "Fundos de investimento", risk_points=1),
            Choice("acoes", "Ações", risk_points=2),
            Choice("fiis", "Fundos imobiliários", risk_points=2),
            Choice("exterior", "Ativos no exterior (ETFs, stocks, BDRs)", risk_points=2),
            Choice("cripto", "Criptomoedas", risk_points=2),
        ),
    ),
)

QUESTIONS_BY_KEY: dict[str, Question] = {q.key: q for q in QUESTIONS}

#: Perguntas de carteira existente (fora do scoring de perfil).
HAS_PORTFOLIO_QUESTION = Question(
    key="has_portfolio", step="situacao", kind="choice",
    prompt="Você já tem uma carteira de investimentos ativa em bolsa?",
    choices=(
        Choice("sim", "Sim, já tenho ações / ETFs / FIIs comprados"),
        Choice("nao", "Ainda não comprei nada"),
    ),
)


def questions_for_step(step: str) -> list[Question]:
    return [q for q in QUESTIONS if q.step == step]


def missing_answers(answers: dict[str, Any]) -> list[str]:
    """Chaves obrigatórias ainda não respondidas."""
    return [
        q.key for q in QUESTIONS
        if q.required and (answers.get(q.key) in (None, "", []) )
    ]
