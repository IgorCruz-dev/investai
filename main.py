"""Entry point do dashboard Streamlit.

    streamlit run main.py

O pacote vive em `src/investai/`. Com `pip install -e .` ele já está no
caminho; o bootstrap abaixo cobre quem só criou o venv e instalou o
requirements.txt, porque `streamlit run` executa este arquivo direto.
"""

from __future__ import annotations

import sys
from pathlib import Path

SRC = Path(__file__).resolve().parent / "src"
if str(SRC) not in sys.path:
    sys.path.insert(0, str(SRC))

from investai.dashboard.app import render  # noqa: E402

render()
