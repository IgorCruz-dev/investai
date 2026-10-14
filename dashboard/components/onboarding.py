"""Onboarding: questionário de perfil, carteira existente ou recomendação.

Fluxo:
    1. "Você já tem carteira ativa?"
       - Sim  → editor de posições (ticker + cotas + preço médio) → carteira real
       - Não  → questionário de 4 etapas → perfil → carteira sugerida
    2. A carteira sugerida pode ser adotada como **carteira planejada**: sem
       preço de compra, sem P&L inventado.
"""

from __future__ import annotations

from typing import Any, Callable

import streamlit as st

from src.analysis.screener import ACAO, ETF, FII, UNIVERSE
from src.config import Portfolio, Position, save_portfolio, save_profile
from src.onboarding.profile import InvestorProfile, build_profile
from src.onboarding.questionnaire import (
    HAS_PORTFOLIO_QUESTION,
    QUESTIONS,
    STEPS,
    Question,
    missing_answers,
    questions_for_step,
)
from src.utils.formatters import money, percent

STATE_ANSWERS = "onboarding_answers"
STATE_STEP = "onboarding_step"
STATE_PATH = "onboarding_path"       # "existing" | "new" | None
STATE_RECOMMENDATION = "onboarding_recommendation"

CLASS_LABELS = {
    "renda_fixa": "Renda fixa (reserva)",
    ETF: "ETFs (diversificação ampla)",
    FII: "Fundos imobiliários",
    ACAO: "Ações individuais",
}


# --- Widgets ----------------------------------------------------------------
def _ask(question: Question, answers: dict[str, Any]) -> Any:
    key = f"q_{question.key}"
    if question.kind == "scale":
        return st.slider(
            question.prompt, int(question.min_value), int(question.max_value),
            value=int(answers.get(question.key) or 5), help=question.help or None, key=key,
        )
    if question.kind == "number":
        return st.number_input(
            question.prompt, min_value=float(question.min_value),
            max_value=float(question.max_value), step=float(question.step_value),
            value=float(answers.get(question.key) or 0.0),
            help=question.help or None, key=key,
        )
    if question.kind == "multi":
        labels = {c.label: c.value for c in question.choices}
        current = [c.label for c in question.choices if c.value in (answers.get(question.key) or [])]
        chosen = st.multiselect(
            question.prompt, list(labels), default=current, help=question.help or None, key=key,
        )
        return [labels[label] for label in chosen]

    labels = {c.label: c.value for c in question.choices}
    values = list(labels.values())
    current = answers.get(question.key)
    index = values.index(current) if current in values else None
    chosen = st.radio(
        question.prompt, list(labels), index=index, help=question.help or None, key=key,
    )
    return labels.get(chosen) if chosen else None


# --- Etapa 0: já tem carteira? ---------------------------------------------
def _render_intro() -> None:
    st.title("📈 Bem-vindo ao InvestAI")
    st.markdown(
        "Antes de analisar qualquer coisa, preciso entender **quem você é como investidor**. "
        "São 18 perguntas rápidas, em 4 etapas — 5 delas vêm do diagnóstico do Raul Sena "
        "(AUVP) e o resto cobre as dimensões de *suitability* que a regulação brasileira "
        "exige para sugerir alocação: reserva de emergência, dívidas, prazo e tolerância a queda."
    )
    st.info(
        "**Isto não é recomendação de investimento.** O sistema produz material informativo "
        "a partir de dados públicos e explica o raciocínio de cada sugestão — a decisão, e a "
        "responsabilidade por ela, é sua.",
        icon="⚠️",
    )

    value = _ask(HAS_PORTFOLIO_QUESTION, {})
    col1, col2 = st.columns([1, 4])
    if col1.button("Começar", type="primary", disabled=value is None):
        st.session_state[STATE_PATH] = "existing" if value == "sim" else "new"
        st.session_state[STATE_STEP] = 0
        st.rerun()


# --- Caminho A: já tem carteira --------------------------------------------
def _render_existing_portfolio(currency: str = "BRL") -> None:
    st.title("Sua carteira atual")
    st.caption(
        "Selecione os ativos que você já possui e informe quantas cotas e o preço médio pago. "
        "O preço médio é o que permite calcular seu P&L real."
    )

    options = {f"{a.ticker} — {a.name}": a for a in UNIVERSE}
    chosen_labels = st.multiselect(
        "Ativos que você possui", list(options),
        help="Não achou o seu ativo? Use o campo abaixo para adicionar pelo ticker.",
    )
    extra = st.text_input(
        "Outros tickers (separados por vírgula)",
        placeholder="MGLU3.SA, AAPL",
        help="Papéis da B3 usam o sufixo .SA; ações americanas vão sem sufixo.",
    )

    entries: list[tuple[str, str, str]] = [
        (options[label].ticker, options[label].name, options[label].asset_class)
        for label in chosen_labels
    ]
    for raw in (extra or "").split(","):
        ticker = raw.strip().upper()
        if ticker and ticker not in {e[0] for e in entries}:
            entries.append((ticker, ticker, ACAO))

    if not entries:
        st.info("Selecione ao menos um ativo para continuar.")
        _render_restart()
        return

    st.divider()
    positions: list[Position] = []
    with st.form("posicoes"):
        st.markdown("**Quantidade e preço médio de cada posição**")
        for ticker, name, asset_class in entries:
            col1, col2, col3 = st.columns([2, 1, 1])
            col1.markdown(f"**{ticker}**  \n`{name}`")
            shares = col2.number_input(
                "Cotas", min_value=0.0, step=1.0, key=f"shares_{ticker}", format="%.0f",
            )
            avg_price = col3.number_input(
                "Preço médio (R$)", min_value=0.0, step=0.01, key=f"avg_{ticker}", format="%.2f",
            )
            if shares > 0:
                positions.append(Position(
                    ticker=ticker, shares=shares,
                    avg_price=avg_price if avg_price > 0 else None,
                    asset_class=asset_class,
                ))
        submitted = st.form_submit_button("Salvar carteira", type="primary")

    if submitted:
        if not positions:
            st.error("Informe a quantidade de cotas de pelo menos um ativo.")
            return
        portfolio = Portfolio(positions=tuple(positions), currency=currency)
        if save_portfolio(portfolio):
            st.success(f"Carteira salva com {len(positions)} posição(ões). Carregando o dashboard…")
            _clear_state()
            st.rerun()
        else:
            st.error("Não foi possível gravar `config/portfolio.json`. Verifique as permissões.")

    _render_restart()


# --- Caminho B: questionário ----------------------------------------------
def _render_questionnaire() -> None:
    answers: dict[str, Any] = st.session_state.setdefault(STATE_ANSWERS, {})
    step_index: int = st.session_state.get(STATE_STEP, 0)
    step_key, step_label = STEPS[step_index]

    st.title("Seu perfil de investidor")
    st.progress((step_index + 1) / len(STEPS), text=f"Etapa {step_index + 1} de {len(STEPS)} — {step_label}")

    with st.form(f"step_{step_key}"):
        collected: dict[str, Any] = {}
        for question in questions_for_step(step_key):
            collected[question.key] = _ask(question, answers)
            st.write("")
        col1, col2 = st.columns([1, 1])
        back = col1.form_submit_button("Voltar") if step_index > 0 else False
        forward = col2.form_submit_button(
            "Ver minha carteira sugerida" if step_index == len(STEPS) - 1 else "Continuar",
            type="primary",
        )

    if back:
        answers.update({k: v for k, v in collected.items() if v not in (None, "")})
        st.session_state[STATE_STEP] = step_index - 1
        st.rerun()

    if forward:
        answers.update(collected)
        st.session_state[STATE_ANSWERS] = answers
        pending = [
            q.key for q in questions_for_step(step_key)
            if q.required and collected.get(q.key) in (None, "", [])
        ]
        if pending:
            st.error("Responda todas as perguntas desta etapa para continuar.")
            return
        if step_index < len(STEPS) - 1:
            st.session_state[STATE_STEP] = step_index + 1
        else:
            st.session_state[STATE_STEP] = len(STEPS)
        st.rerun()

    _render_restart()


# --- Resultado: perfil + recomendação -------------------------------------
def _render_prerequisites(profile: InvestorProfile) -> None:
    if not profile.prerequisites:
        return
    st.subheader("Antes de investir em bolsa")
    for pre in profile.prerequisites:
        valor = f" — **{money(pre.amount)}**" if pre.amount else ""
        if pre.blocking:
            st.error(f"**{pre.title}**{valor}\n\n{pre.detail}", icon="🛑")
        else:
            st.warning(f"**{pre.title}**{valor}\n\n{pre.detail}", icon="⚠️")


def _render_profile_summary(profile: InvestorProfile) -> None:
    col1, col2, col3, col4 = st.columns(4)
    col1.metric("Perfil", profile.profile)
    col2.metric("Score de risco", f"{profile.risk_score:.0f}/100")
    col3.metric("Horizonte", f"{profile.horizon_years:.0f} anos")
    col4.metric("Para investir agora", money(profile.investable_amount))

    col1, col2, col3 = st.columns(3)
    col1.metric("Reserva de emergência (meta)", money(profile.emergency_target))
    col2.metric("Reserva atual (estimada)", money(profile.emergency_current))
    col3.metric("Falta para a reserva", money(profile.emergency_gap))

    st.markdown("**Alocação-alvo do seu perfil**")
    cols = st.columns(len(profile.allocation) or 1)
    for col, (asset_class, weight) in zip(cols, profile.allocation.items()):
        col.metric(CLASS_LABELS.get(asset_class, asset_class), percent(weight, signed=False))

    if profile.notes:
        with st.expander("Por que esta alocação, e o que foi ajustado"):
            for note in profile.notes:
                st.markdown(f"- {note}")


def _render_recommendation(recommendation: Any, profile: InvestorProfile,
                           currency: str = "BRL") -> None:
    if recommendation.error:
        st.warning(recommendation.error)
    if not recommendation.ok:
        return

    fonte = ("filtro quantitativo + análise do Claude" if recommendation.source == "claude"
             else "filtro quantitativo (sem LLM)")
    st.subheader("Carteira sugerida")
    st.caption(
        f"Fonte: {fonte}. Os ativos saíram de um universo de {len(UNIVERSE)} papéis líquidos da "
        "B3, filtrados por liquidez, múltiplos, endividamento, volatilidade e tendência — com "
        "dados reais do yfinance."
    )

    rows = []
    for position in recommendation.positions:
        rows.append({
            "Ativo": position.ticker,
            "Nome": position.name,
            "Classe": CLASS_LABELS.get(position.asset_class, position.asset_class),
            "Peso": percent(position.weight_pct, signed=False),
            "Valor": money(position.amount, currency),
            "Cotas": "—" if position.asset_class == "renda_fixa" else f"{position.shares:.0f}",
            "Preço atual": money(position.price, currency) if position.price else "—",
        })
    st.dataframe(rows, hide_index=True)

    if recommendation.leftover > 0:
        st.caption(
            f"Sobra de {money(recommendation.leftover, currency)} em caixa — não é possível "
            "comprar fração de cota. Some ao próximo aporte."
        )

    with st.expander("Por que cada ativo foi escolhido", expanded=True):
        for position in recommendation.positions:
            st.markdown(f"**{position.ticker}** ({position.sector or position.asset_class}) — "
                        f"{position.rationale}")

    if recommendation.summary:
        st.markdown("### Estratégia")
        st.markdown(recommendation.summary)
    if recommendation.risk_notes:
        st.markdown("### Riscos desta carteira")
        st.markdown(recommendation.risk_notes)
    if recommendation.next_steps:
        st.markdown("### Próximos passos")
        for step in recommendation.next_steps:
            st.markdown(f"- {step}")

    if recommendation.rejected:
        with st.expander("Ativos que NÃO entraram, e o motivo"):
            st.caption("O filtro é regra, não opinião — cada reprovação tem um número por trás.")
            for asset_class, items in recommendation.rejected.items():
                st.markdown(f"**{CLASS_LABELS.get(asset_class, asset_class)}**")
                for item in items:
                    st.markdown(f"- {item}")

    st.divider()
    st.markdown(
        "Adotar a carteira a salva como **carteira planejada**: o dashboard passa a acompanhar "
        "esses ativos sem inventar preço de compra. Quando você comprar de verdade, informe o "
        "preço médio para ver o P&L real."
    )
    col1, col2 = st.columns([1, 3])
    if col1.button("Adotar esta carteira", type="primary"):
        portfolio = recommendation.to_portfolio(currency)
        saved_profile = save_profile(profile.to_dict())
        if save_portfolio(portfolio) and saved_profile:
            st.success("Carteira planejada salva. Carregando o dashboard…")
            _clear_state()
            st.rerun()
        else:
            st.error("Não foi possível gravar os arquivos em `config/`. Verifique as permissões.")


def _render_result(load_market_data: Callable[[list[str]], dict], currency: str = "BRL",
                   use_llm: bool = True) -> None:
    from src.analysis.recommender import recommend

    answers = st.session_state.get(STATE_ANSWERS, {})
    profile = build_profile(answers)

    st.title("Seu perfil e a carteira sugerida")
    _render_profile_summary(profile)
    st.divider()
    _render_prerequisites(profile)

    if profile.investable_amount <= 0:
        st.info(
            "Com as respostas atuais, **todo o valor disponível vai para os pré-requisitos acima** "
            "— não há sobra para alocar em bolsa agora. Resolva-os primeiro; é o passo com o "
            "melhor retorno garantido que existe.",
            icon="🧭",
        )
        st.caption(
            "Você ainda pode usar o dashboard: salve uma carteira planejada vazia ou refaça o "
            "questionário ajustando o valor inicial."
        )
        _render_restart()
        return

    st.divider()
    recommendation = st.session_state.get(STATE_RECOMMENDATION)
    if recommendation is None:
        spinner = ("Buscando dados de mercado e montando a carteira "
                   + ("com o Claude…" if use_llm else "pelo filtro quantitativo…"))
        with st.spinner(spinner):
            market_data = load_market_data([a.ticker for a in UNIVERSE])
            recommendation = recommend(profile, market_data, use_llm=use_llm, currency=currency)
        st.session_state[STATE_RECOMMENDATION] = recommendation

    _render_recommendation(recommendation, profile, currency)
    _render_restart()


# --- Utilidades -------------------------------------------------------------
def _clear_state() -> None:
    for key in (STATE_ANSWERS, STATE_STEP, STATE_PATH, STATE_RECOMMENDATION):
        st.session_state.pop(key, None)


def _render_restart() -> None:
    st.divider()
    if st.button("↩️ Começar de novo", key=f"restart_{st.session_state.get(STATE_STEP, 0)}"):
        _clear_state()
        st.rerun()


def is_active() -> bool:
    return st.session_state.get(STATE_PATH) is not None


def render(load_market_data: Callable[[list[str]], dict], currency: str = "BRL",
           use_llm: bool = True) -> None:
    """Desenha a etapa atual do onboarding."""
    path = st.session_state.get(STATE_PATH)
    if path is None:
        _render_intro()
        return
    if path == "existing":
        _render_existing_portfolio(currency)
        return
    if st.session_state.get(STATE_STEP, 0) >= len(STEPS):
        _render_result(load_market_data, currency, use_llm)
        return
    _render_questionnaire()
