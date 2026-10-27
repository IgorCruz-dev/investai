"""Exporta as 18 perguntas do onboarding para o PWA desenhar.

    .venv/bin/python scripts/exportar_perguntas.py

O PWA precisa do **texto** das perguntas, e só dele. A pontuação de risco fica
em `onboarding/profile.py` e nunca é exportada: duas fontes de verdade para o
score que manda em toda a alocação divergiriam no primeiro ajuste que só uma
recebesse. Por isso `risk_points` não entra no JSON — a web pergunta, a VM
conclui.

`tests/test_onboarding_export.py` garante que o arquivo gerado não envelheceu
em relação ao questionário.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

DESTINO = ROOT / "apps" / "pwa" / "src" / "data" / "perguntas.json"


def montar() -> dict:
    from investai.onboarding.questionnaire import (
        HAS_PORTFOLIO_QUESTION,
        QUESTIONS,
        STEPS,
    )

    def pergunta(q) -> dict:
        dados: dict = {
            "chave": q.key,
            "bloco": q.step,
            "tipo": q.kind,
            "enunciado": q.prompt,
            "ajuda": q.help,
            "obrigatoria": q.required,
        }
        if q.choices:
            dados["opcoes"] = [
                {"valor": c.value, "rotulo": c.label, "ajuda": c.help} for c in q.choices
            ]
        if q.kind in ("scale", "number"):
            dados["minimo"] = q.min_value
            dados["maximo"] = q.max_value
            dados["passo"] = q.step_value
        return dados

    return {
        "blocos": [{"chave": chave, "titulo": titulo} for chave, titulo in STEPS],
        "perguntas": [pergunta(q) for q in QUESTIONS],
        "temCarteira": pergunta(HAS_PORTFOLIO_QUESTION),
    }


def main() -> int:
    conteudo = json.dumps(montar(), ensure_ascii=False, indent=2) + "\n"
    DESTINO.parent.mkdir(parents=True, exist_ok=True)
    DESTINO.write_text(conteudo, encoding="utf-8")
    print(f"{DESTINO.relative_to(ROOT)}: {len(montar()['perguntas'])} perguntas")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
