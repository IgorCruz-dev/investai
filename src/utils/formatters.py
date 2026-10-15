"""Formatação para exibição e para o prompt — fonte única, usada pelos dois."""

from __future__ import annotations

from datetime import date, datetime
from typing import Any

NA = "N/D"

_SYMBOLS = {"BRL": "R$", "USD": "US$", "EUR": "€"}


def is_missing(value: Any) -> bool:
    if value is None:
        return True
    try:
        return bool(value != value)  # NaN
    except Exception:  # noqa: BLE001
        return False


def money(value: Any, currency: str = "BRL") -> str:
    """`1234.5` → `R$ 1.234,50` (formato pt-BR)."""
    if is_missing(value):
        return NA
    symbol = _SYMBOLS.get(currency.upper(), currency.upper() + " ")
    text = f"{float(value):,.2f}".replace(",", "~").replace(".", ",").replace("~", ".")
    return f"{symbol} {text}"


def percent(value: Any, decimals: int = 2, signed: bool = True) -> str:
    """`-3.456` → `-3,46%`."""
    if is_missing(value):
        return NA
    fmt = f"{{:+.{decimals}f}}" if signed else f"{{:.{decimals}f}}"
    return fmt.format(float(value)).replace(".", ",") + "%"


def number(value: Any, decimals: int = 2) -> str:
    if is_missing(value):
        return NA
    return f"{float(value):,.{decimals}f}".replace(",", "~").replace(".", ",").replace("~", ".")


def big_number(value: Any, currency: str | None = None) -> str:
    """Abrevia valores grandes: `548493000704` → `548,49 bi`."""
    if is_missing(value):
        return NA
    value = float(value)
    prefix = f"{_SYMBOLS.get((currency or '').upper(), '')} ".strip()
    for limit, suffix in ((1e12, "tri"), (1e9, "bi"), (1e6, "mi"), (1e3, "mil")):
        if abs(value) >= limit:
            return f"{prefix} {number(value / limit)} {suffix}".strip()
    return f"{prefix} {number(value)}".strip()


def date_br(value: Any) -> str:
    if is_missing(value):
        return NA
    if isinstance(value, str):
        try:
            value = datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            return value
    if isinstance(value, (datetime, date)):
        return value.strftime("%d/%m/%Y")
    return str(value)


def datetime_br(value: Any) -> str:
    if is_missing(value):
        return NA
    if isinstance(value, datetime):
        return value.strftime("%d/%m/%Y %H:%M")
    return date_br(value)


def parse_number_br(text: Any) -> float | None:
    """`"35,50"` → `35.5`. A volta de `number()`, para ler o que o usuário digita.

    O brasileiro escreve vírgula decimal, mas também escreve ponto quando o
    teclado do celular entrega ponto — e às vezes separa milhar. Então a regra é
    decidida pelo **último** separador encontrado:

        "35,50"     → 35.5     (vírgula decimal)
        "35.50"     → 35.5     (ponto decimal, teclado numérico)
        "1.234,56"  → 1234.56  (ponto de milhar, vírgula decimal)
        "1,234.56"  → 1234.56  (formato americano colado de algum lugar)
        "R$ 3.550"  → 3550.0   (símbolo e milhar)

    `"3.550"` é genuinamente ambíguo, e o desempate é o tamanho do grupo final:
    três dígitos depois do separador nunca são centavos, então ali o ponto é de
    milhar. Com um ou dois dígitos (`"35.50"`), é decimal.

    Vírgula é sempre decimal, mesmo com três dígitos: num sistema em português,
    quem escreve `"3,550"` quis dizer três e meio, não três mil.

    `None` quando não há número nenhum — nunca 0.0, que seria indistinguível de
    um zero digitado de verdade.
    """
    if isinstance(text, (int, float)) and not isinstance(text, bool):
        return None if is_missing(text) else float(text)

    limpo = "".join(c for c in str(text or "") if c.isdigit() or c in ",.-")
    if not limpo or not any(c.isdigit() for c in limpo):
        return None

    ultima_virgula, ultimo_ponto = limpo.rfind(","), limpo.rfind(".")
    if ultima_virgula > ultimo_ponto:
        limpo = limpo.replace(".", "").replace(",", ".")
    elif ultimo_ponto > ultima_virgula:
        if len(limpo) - ultimo_ponto - 1 == 3:
            limpo = limpo.replace(".", "")   # "3.550" → milhar
        else:
            limpo = limpo.replace(",", "")   # "35.50" → decimal
    # Sem separador: já é um inteiro.

    try:
        return float(limpo)
    except ValueError:
        return None
