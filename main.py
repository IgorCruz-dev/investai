"""Entry point do InvestAI.

Uso:
    streamlit run main.py
"""

from __future__ import annotations

import sys
from pathlib import Path

# Garante que `src/` e `dashboard/` sejam importáveis quando o Streamlit executa
# este arquivo diretamente.
sys.path.insert(0, str(Path(__file__).resolve().parent))

from dashboard.app import render  # noqa: E402

render()
