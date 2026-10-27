"""Primeiro acesso da instalação pessoal.

    python -m investai.setup

Pergunta o que falta e escreve no `.env` local. A aplicação das migrações
Supabase é uma etapa explícita separada, após configurar a URL do projeto novo.
"""

from __future__ import annotations

import os
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
ENV_PATH = ROOT / ".env"
ENV_EXEMPLO = ROOT / ".env.example"

VERDE, AMARELO, VERMELHO, APAGA = "\033[32m", "\033[33m", "\033[31m", "\033[0m"


def ok(msg: str) -> None:
    print(f"{VERDE}✓{APAGA} {msg}")


def aviso(msg: str) -> None:
    print(f"{AMARELO}!{APAGA} {msg}")


def erro(msg: str) -> None:
    print(f"{VERMELHO}✗{APAGA} {msg}", file=sys.stderr)


# --- .env -------------------------------------------------------------------
def ler_env() -> dict[str, str]:
    """As variáveis já definidas no `.env`, para virarem padrão das perguntas."""
    if not ENV_PATH.exists():
        return {}
    valores = {}
    for linha in ENV_PATH.read_text(encoding="utf-8").splitlines():
        limpa = linha.strip()
        if not limpa or limpa.startswith("#") or "=" not in limpa:
            continue
        chave, _, valor = limpa.partition("=")
        valores[chave.strip()] = valor.strip()
    return valores


def gravar_env(novos: dict[str, str]) -> None:
    """Atualiza as chaves no `.env`, preservando comentários e o resto do arquivo.

    Reescreve a linha existente em vez de acrescentar outra no fim: duas linhas
    com a mesma chave fariam a última ganhar silenciosamente, e quem abrisse o
    arquivo veria a primeira.
    """
    if not ENV_PATH.exists():
        base = ENV_EXEMPLO.read_text(encoding="utf-8") if ENV_EXEMPLO.exists() else ""
        ENV_PATH.write_text(base, encoding="utf-8")
        ok(f"criei {ENV_PATH.name} a partir do .env.example")

    linhas = ENV_PATH.read_text(encoding="utf-8").splitlines()
    restantes = dict(novos)

    for i, linha in enumerate(linhas):
        casado = re.match(r"^(\s*)#?\s*([A-Z_][A-Z0-9_]*)=", linha)
        if casado and casado.group(2) in restantes:
            chave = casado.group(2)
            linhas[i] = f"{chave}={restantes.pop(chave)}"

    if restantes:
        linhas.append("")
        linhas.append("# --- escrito por `python -m investai.setup` ---")
        linhas += [f"{k}={v}" for k, v in restantes.items()]

    ENV_PATH.write_text("\n".join(linhas) + "\n", encoding="utf-8")
    os.chmod(ENV_PATH, 0o600)  # tem chave de API e senha de banco


# --- perguntas --------------------------------------------------------------
def perguntar(rotulo: str, atual: str = "", *, obrigatorio: bool = True,
              validar=None, dica: str = "") -> str:
    """Pergunta até vir uma resposta válida. Enter mantém o valor atual."""
    if dica:
        print(f"  {dica}")
    while True:
        mostrado = f" [{_resumir(atual)}]" if atual else ""
        resposta = input(f"{rotulo}{mostrado}: ").strip() or atual
        if not resposta:
            if not obrigatorio:
                return ""
            erro("esse campo é obrigatório")
            continue
        if validar:
            problema = validar(resposta)
            if problema:
                erro(problema)
                continue
        return resposta


def _resumir(valor: str) -> str:
    """Mostra o padrão sem despejar uma connection string inteira na tela."""
    if len(valor) > 28:
        return valor[:16] + "…" + valor[-6:]
    return valor


def _valida_postgres(valor: str) -> str | None:
    if not valor.startswith(("postgres://", "postgresql://")):
        return "deve começar com postgresql:// (copie a URI do Supabase)"
    return None


def _valida_telefone(valor: str) -> str | None:
    digitos = "".join(c for c in valor if c.isdigit())
    if not 10 <= len(digitos) <= 15:
        return "só dígitos, com DDI e DDD — ex.: 5516991234567"
    return None


def _valida_chave(valor: str) -> str | None:
    if not valor.startswith("sk-ant-"):
        return "a chave da Anthropic começa com sk-ant- (console.anthropic.com/settings/keys)"
    return None


# --- etapas -----------------------------------------------------------------
def configurar_local(env: dict[str, str]) -> dict[str, str]:
    print("\n--- 1. Esta máquina -------------------------------------------")
    print("As credenciais abaixo são SUAS e ficam no seu .env, que não vai para o git.\n")

    chave = perguntar(
        "Chave da Anthropic", env.get("ANTHROPIC_API_KEY", ""), validar=_valida_chave,
        dica="crie em https://console.anthropic.com/settings/keys (precisa de crédito na conta)",
    )
    direta = perguntar(
        "URI Postgres do projeto Supabase", env.get("DATABASE_URL", ""),
        validar=_valida_postgres,
        dica="Project Settings → Database → Connection string → URI",
    )
    telefone = perguntar(
        "Seu telefone do WhatsApp", env.get("WHATSAPP_ALLOWED_NUMBERS", ""),
        validar=_valida_telefone,
        dica="é de onde você vai conversar com o assistente",
    )
    telefone = "".join(c for c in telefone if c.isdigit())

    gravar_env({
        "ANTHROPIC_API_KEY": chave,
        "DATABASE_URL": direta,
        "WHATSAPP_ALLOWED_NUMBERS": telefone,
    })
    ok(f"{ENV_PATH.name} atualizado (permissão 600)")
    return {"chave": chave, "direta": direta, "telefone": telefone}


def semear_catalogo() -> None:
    """Põe os 38 ativos do universo curado no catálogo do banco da pessoa."""
    try:
        from investai.analysis.screener import UNIVERSE
        from investai.data import repo

        for ativo in UNIVERSE:
            # `validado=True`: são os papéis que o screener consulta no yfinance
            # todo dia, então a existência deles já está provada. Idempotente,
            # então rodar o setup de novo não duplica nada.
            repo.garantir_ativo(ativo.ticker, ativo.name, ativo.asset_class,
                                ativo.sector, validado=True)
        ok(f"catálogo semeado ({len(UNIVERSE)} ativos)")
    except Exception as exc:  # noqa: BLE001
        aviso(f"catálogo não semeado ({exc}) — o cron da VM preenche depois")


def main() -> int:
    print("InvestAI — configuração inicial")
    print("Enter mantém o valor entre colchetes. Ctrl+C sai sem gravar nada.")

    try:
        configurar_local(ler_env())

        # O .env acabou de mudar; recarrega para as etapas seguintes o verem.
        from dotenv import load_dotenv
        load_dotenv(ENV_PATH, override=True)
    except KeyboardInterrupt:
        print()
        aviso("cancelado")
        return 130

    print("\n--- Pronto ----------------------------------------------------")
    print("  Aplique supabase/migrations no projeto novo antes de iniciar a VM.")
    print("  PWA: cd apps/pwa && npm run dev")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
