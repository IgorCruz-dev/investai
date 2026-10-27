"""O JSON das perguntas do PWA não pode envelhecer calado.

O PWA desenha as 18 perguntas a partir de `apps/pwa/src/data/perguntas.json`,
gerado por `scripts/exportar_perguntas.py`. É uma cópia, e cópia apodrece: mexer
no questionário e esquecer de reexportar deixaria a web perguntando uma coisa e
a VM pontuando outra.

Este teste é o alarme. Se ele cair, rode:

    .venv/bin/python scripts/exportar_perguntas.py
"""

from __future__ import annotations

import importlib.util
import json
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
JSON = ROOT / "apps" / "pwa" / "src" / "data" / "perguntas.json"


def _exportador():
    spec = importlib.util.spec_from_file_location(
        "exportar_perguntas", ROOT / "scripts" / "exportar_perguntas.py")
    modulo = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(modulo)
    return modulo


@pytest.fixture
def exportado() -> dict:
    return _exportador().montar()


def test_o_json_do_pwa_esta_igual_ao_questionario(exportado):
    assert JSON.exists(), "rode scripts/exportar_perguntas.py"
    gravado = json.loads(JSON.read_text(encoding="utf-8"))
    assert gravado == exportado, (
        "perguntas.json divergiu do questionário — rode "
        "`.venv/bin/python scripts/exportar_perguntas.py`"
    )


def test_todas_as_perguntas_e_blocos_estao_no_json(exportado):
    from investai.onboarding.questionnaire import QUESTIONS, STEPS

    assert [p["chave"] for p in exportado["perguntas"]] == [q.key for q in QUESTIONS]
    assert [b["chave"] for b in exportado["blocos"]] == [s[0] for s in STEPS]
    assert len(exportado["perguntas"]) == 18


def test_as_opcoes_de_cada_pergunta_batem_uma_a_uma(exportado):
    from investai.onboarding.questionnaire import QUESTIONS_BY_KEY

    for pergunta in exportado["perguntas"]:
        original = QUESTIONS_BY_KEY[pergunta["chave"]]
        assert pergunta["enunciado"] == original.prompt
        assert [o["valor"] for o in pergunta.get("opcoes", [])] == \
            [c.value for c in original.choices]
        assert [o["rotulo"] for o in pergunta.get("opcoes", [])] == \
            [c.label for c in original.choices]


def test_a_pontuacao_de_risco_nunca_e_exportada(exportado):
    """O score mora no Python. Exportá-lo criaria a segunda fonte de verdade."""
    bruto = json.dumps(exportado, ensure_ascii=False)
    assert "risk_points" not in bruto
    assert "pontos" not in bruto
    for pergunta in exportado["perguntas"]:
        for opcao in pergunta.get("opcoes", []):
            assert set(opcao) == {"valor", "rotulo", "ajuda"}
