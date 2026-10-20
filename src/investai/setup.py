"""Primeiro acesso: configura esta máquina e, se houver registro, se inscreve.

    python -m investai.setup

Pensado para quem acabou de clonar o repositório. Pergunta o que falta, escreve
no `.env` local, aplica as migrações no banco da pessoa e — quando a instância
compartilhada está configurada — grava a linha dela no registro central, para o
bot e o painel passarem a atendê-la.

Nada sai daqui para uma pessoa: a senha nunca é guardada (só o hash PBKDF2), e
as credenciais vão direto para o banco de registro pela connection string de
inscrição, que só escreve e não lê a linha de ninguém.

Rodar de novo é seguro: o que já está respondido vem como padrão entre
colchetes, Enter mantém, e a inscrição é um upsert da própria linha.
"""

from __future__ import annotations

import argparse
import getpass
import os
import re
import sys
from pathlib import Path

from investai import migrations, tenants

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
        return "deve começar com postgresql:// (copie do painel do Neon)"
    return None


def _valida_telefone(valor: str) -> str | None:
    digitos = "".join(c for c in valor if c.isdigit())
    if not 10 <= len(digitos) <= 15:
        return "só dígitos, com DDI e DDD — ex.: 5516991234567"
    return None


def _valida_id(valor: str) -> str | None:
    if not tenants.ID_VALIDO.match(valor):
        return "de 1 a 32 caracteres entre a-z, 0-9, _ e - (começando por letra ou número)"
    return None


def _valida_chave(valor: str) -> str | None:
    if not valor.startswith("sk-ant-"):
        return "a chave da Anthropic começa com sk-ant- (console.anthropic.com/settings/keys)"
    return None


def pedir_senha() -> str:
    """Senha do painel web. Nunca é gravada — só o hash PBKDF2."""
    while True:
        senha = getpass.getpass("Senha para o painel web (não aparece na tela): ")
        if len(senha) < 12:
            erro("use pelo menos 12 caracteres — o painel fica exposto na internet")
            continue
        if senha != getpass.getpass("Repita a senha: "):
            erro("as duas não bateram")
            continue
        return senha


# --- etapas -----------------------------------------------------------------
def configurar_local(env: dict[str, str]) -> dict[str, str]:
    print("\n--- 1. Esta máquina -------------------------------------------")
    print("As credenciais abaixo são SUAS e ficam no seu .env, que não vai para o git.\n")

    chave = perguntar(
        "Chave da Anthropic", env.get("ANTHROPIC_API_KEY", ""), validar=_valida_chave,
        dica="crie em https://console.anthropic.com/settings/keys (precisa de crédito na conta)",
    )
    direta = perguntar(
        "URL do seu Neon (endpoint DIRETO)", env.get("DATABASE_URL", ""),
        validar=_valida_postgres,
        dica="crie um projeto em https://neon.tech (free tier basta) e copie a connection string",
    )
    pooled = perguntar(
        "URL do seu Neon (endpoint com -pooler)", env.get("DATABASE_URL_POOLED", ""),
        validar=_valida_postgres,
        dica="a mesma de cima, com '-pooler' no host — é a que o painel web usa",
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
        "DATABASE_URL_POOLED": pooled,
        "WHATSAPP_ALLOWED_NUMBERS": telefone,
    })
    ok(f"{ENV_PATH.name} atualizado (permissão 600)")
    return {"chave": chave, "direta": direta, "pooled": pooled, "telefone": telefone}


def aplicar_schema(url: str) -> bool:
    print("\n--- 2. Seu banco ----------------------------------------------")
    try:
        faltando = migrations.pendentes(url)
        if not faltando:
            ok("banco já está com o schema em dia")
            return True
        print(f"  aplicando {len(faltando)} migração(ões): "
              f"{', '.join(m.nome for m in faltando)}")
        migrations.aplicar(url)
        ok("schema aplicado")
        return True
    except Exception as exc:  # noqa: BLE001 — a mensagem é para a pessoa, não para o log
        erro(f"não consegui preparar o banco: {exc}")
        aviso("confira a URL e se o projeto do Neon está ativo, e rode de novo")
        return False


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


def inscrever(dados: dict[str, str]) -> bool:
    print("\n--- 3. Instância compartilhada --------------------------------")

    url_registro = tenants.registry_url()
    if not url_registro:
        aviso("INVESTAI_REGISTRY_URL não está no .env — pulando a inscrição.")
        print("  Você já pode usar o sistema nesta máquina (streamlit run main.py).")
        print("  Para entrar no bot e no painel compartilhados, peça a quem hospeda")
        print("  a connection string de inscrição e ponha em INVESTAI_REGISTRY_URL.")
        return True

    print("  Isto grava as suas credenciais no registro da instância compartilhada,")
    print("  para o bot e o painel atenderem você. IMPORTANTE, e sem meias palavras:")
    print("  a sua chave da Anthropic e a URL do seu banco passam a ficar na")
    print("  infraestrutura de quem hospeda, que tecnicamente consegue lê-las.")
    print("  Se não quiser isso, responda 'n' e use o sistema só nesta máquina.\n")

    if input("  Inscrever? [s/N]: ").strip().lower() not in ("s", "sim", "y"):
        aviso("inscrição cancelada — o uso local continua funcionando")
        return True

    ident = perguntar("Seu usuário (login do painel, minúsculas)",
                      os.getenv("INVESTAI_TENANT_ID", ""), validar=_valida_id)
    nome = perguntar("Seu nome (como aparece no painel)", ident.capitalize())
    senha = pedir_senha()

    try:
        import psycopg

        with psycopg.connect(url_registro, connect_timeout=20) as conn:
            conn.execute(
                "insert into tenants (id, nome, telefone, database_url, "
                "database_url_pooled, anthropic_key, web_password_hash) "
                "values (%s, %s, %s, %s, %s, %s, %s) "
                "on conflict (id) do update set nome = excluded.nome, "
                "telefone = excluded.telefone, database_url = excluded.database_url, "
                "database_url_pooled = excluded.database_url_pooled, "
                "anthropic_key = excluded.anthropic_key, "
                "web_password_hash = excluded.web_password_hash, ativo = true",
                (ident, nome, dados["telefone"], dados["direta"], dados["pooled"],
                 dados["chave"], tenants.hash_de_senha(senha)),
            )
            conn.commit()
    except Exception as exc:  # noqa: BLE001
        erro(f"não consegui inscrever: {exc}")
        aviso("a credencial de inscrição pode ter expirado — fale com quem hospeda")
        return False

    gravar_env({"INVESTAI_TENANT_ID": ident})
    ok(f"inscrito como '{ident}'")
    print(f"  O bot passa a te atender em até {int(tenants.REGISTRO_TTL)}s, no mesmo número.")
    print(f"  No painel web, entre com o usuário '{ident}' e essa senha.")
    return True


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--so-local", action="store_true",
                        help="configura a máquina e o banco, sem inscrever na instância compartilhada")
    args = parser.parse_args()

    print("InvestAI — configuração inicial")
    print("Enter mantém o valor entre colchetes. Ctrl+C sai sem gravar nada.")

    try:
        dados = configurar_local(ler_env())

        # O .env acabou de mudar; recarrega para as etapas seguintes o verem.
        from dotenv import load_dotenv
        load_dotenv(ENV_PATH, override=True)
        tenants.recarregar()

        if not aplicar_schema(dados["direta"]):
            return 1
        semear_catalogo()

        if not args.so_local and not inscrever(dados):
            return 1
    except KeyboardInterrupt:
        print()
        aviso("cancelado")
        return 130

    print("\n--- Pronto ----------------------------------------------------")
    print("  streamlit run main.py        o dashboard local")
    print("  pytest -m \"not network\"      a suíte offline")
    print("  docs/deploy.md               a instância compartilhada, passo a passo")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
