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
