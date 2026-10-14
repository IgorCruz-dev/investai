"""Aba 3 — briefing semanal gerado pelo Claude (sob clique, porque tem custo)."""

from __future__ import annotations

from typing import Any, Callable

import streamlit as st

from src.analysis.llm_analyst import BriefingResult
from src.config import LLM_MODEL
from src.utils.formatters import datetime_br


def render(
    generate: Callable[[], BriefingResult],
    state_key: str = "briefing",
    api_ready: bool = True,
) -> None:
    st.caption(
        f"O briefing é gerado pelo modelo `{LLM_MODEL}` e **consome créditos da API** — "
        "por isso só roda quando você clica."
    )

    if not api_ready:
        st.warning(
            "`ANTHROPIC_API_KEY` não configurada. Copie `.env.example` para `.env`, "
            "preencha a chave e recarregue a página."
        )

    if st.button("Gerar Briefing", type="primary", disabled=not api_ready):
        with st.spinner("Analisando carteira, indicadores e notícias..."):
            st.session_state[state_key] = generate()

    result: BriefingResult | None = st.session_state.get(state_key)
    if result is None:
        st.info("Nenhum briefing gerado ainda nesta sessão.")
        return

    if result.error:
        st.error(result.error)
        return

    meta = [f"Gerado em {datetime_br(result.generated_at)}", f"modelo `{result.model}`"]
    usage: dict[str, Any] = result.usage or {}
    if usage.get("input_tokens") and usage.get("output_tokens"):
        meta.append(f"{usage['input_tokens']} tokens de entrada / {usage['output_tokens']} de saída")
    st.caption(" · ".join(meta))

    st.markdown(result.text)

    with st.expander("Copiar briefing (markdown)"):
        st.caption("Use o botão de copiar no canto do bloco abaixo.")
        st.code(result.text, language="markdown", wrap_lines=True)
