"""Normalização e reconhecimento de códigos de ativo.

Vivia em `src/agent/tools.py`, onde só o agente alcançava. O roteador, a
validação de escrita e o onboarding precisam da mesma regra, e duas
implementações de "o que é um ticker" divergiriam na primeira exceção.
"""

from __future__ import annotations

import re

#: Papel da B3: 4 letras + 1 ou 2 dígitos (PETR4, KLBN11, BPAC11).
PADRAO_B3 = re.compile(r"\b([A-Z]{4}\d{1,2})\b")

#: Ticker americano: 1 a 5 letras, sem dígito. Usado só quando o texto já
#: indicou que ali vem um ticker — sozinho, casaria com qualquer palavra.
PADRAO_US = re.compile(r"\b([A-Z]{1,5})\b")


def normalizar(ticker: str) -> str:
    """`petr4` → `PETR4.SA`. Ticker americano (sem dígito no fim) passa direto."""
    code = (ticker or "").strip().upper().replace(" ", "")
    if not code:
        return ""
    if "." in code:
        return code
    if len(code) >= 5 and code[:4].isalpha() and code[4:].isdigit():
        return code + ".SA"
    return code


def extrair(texto: str, limite: int = 8) -> list[str]:
    """Todos os tickers da B3 citados num texto livre, já normalizados.

    "quanto está a petr4 e a vale3?" → ["PETR4.SA", "VALE3.SA"]

    Só reconhece o padrão da B3 de propósito: varrer 1-5 letras casaria com
    "VALE", "COMO" e "ANALISA" — num texto em português, ticker americano
    precisa vir dito explicitamente, não adivinhado.
    """
    vistos: list[str] = []
    for achado in PADRAO_B3.findall((texto or "").upper()):
        code = normalizar(achado)
        if code and code not in vistos:
            vistos.append(code)
    return vistos[:limite]


def curto(ticker: str) -> str:
    """`PETR4.SA` → `PETR4`. Para exibir sem o sufixo que só o yfinance precisa."""
    return (ticker or "").upper().removesuffix(".SA")
