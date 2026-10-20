"""Prepara o banco de registro e imprime as strings que você precisa entregar.

    .venv/bin/python scripts/preparar_registro.py --url 'postgresql://…'

Para quem HOSPEDA a instância compartilhada, e só uma vez. O que ele faz:

1. aplica o schema do registro (`deploy/registro/001_registro.sql`);
2. cria a role `investai_inscricao` com uma senha forte gerada aqui — ela tem
   `insert` e `update` na tabela `tenants` e **nenhum `select`**, então quem a
   recebe grava a própria linha e não lê a de ninguém;
3. imprime, prontas para copiar:
   - a linha do seu `.env` (`INVESTAI_REGISTRY_URL`),
   - a variável da Vercel (`INVESTAI_REGISTRY_URL_POOLED`),
   - a string de inscrição para entregar a cada pessoa.

Por que existe em vez de um "faça à mão": montar a string de inscrição é trocar
usuário e senha numa URL de 120 caracteres, e errar isso dá "senha inválida"
para a outra pessoa, do outro lado, sem pista do motivo.

A senha da role é mostrada **uma vez**. Rodar de novo com `--nova-senha` troca
a senha e invalida as strings já entregues.
"""

from __future__ import annotations

import argparse
import logging
import secrets
import sys
from pathlib import Path
from urllib.parse import urlsplit, urlunsplit

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

logging.basicConfig(level=logging.INFO, format="%(message)s")
log = logging.getLogger("registro")

ROLE = "investai_inscricao"
DIR_REGISTRO = ROOT / "deploy" / "registro"


def trocar_credenciais(url: str, usuario: str, senha: str) -> str:
    """Devolve a mesma URL com outro usuário e senha.

    Mexe só no `netloc`, preservando host, porta, caminho e query — é a query
    que leva o `sslmode=require` do Neon, e perdê-la faz a conexão ser recusada.
    """
    partes = urlsplit(url)
    hospedeiro = partes.hostname or ""
    if partes.port:
        hospedeiro = f"{hospedeiro}:{partes.port}"
    from urllib.parse import quote

    netloc = f"{quote(usuario, safe='')}:{quote(senha, safe='')}@{hospedeiro}"
    return urlunsplit((partes.scheme, netloc, partes.path, partes.query, partes.fragment))


def com_pooler(url: str) -> str:
    """A variante com `-pooler` no host, que é a que a Vercel usa.

    O Neon usa o mesmo projeto com dois endpoints, e a diferença é literalmente
    esse sufixo no primeiro rótulo do host.
    """
    partes = urlsplit(url)
    hospedeiro = partes.hostname or ""
    if "-pooler" in hospedeiro:
        return url
    rotulos = hospedeiro.split(".")
    rotulos[0] = f"{rotulos[0]}-pooler"
    novo = ".".join(rotulos)
    if partes.port:
        novo = f"{novo}:{partes.port}"
    usuario = partes.username or ""
    senha = partes.password or ""
    from urllib.parse import quote

    netloc = f"{quote(usuario, safe='')}:{quote(senha, safe='')}@{novo}" if usuario else novo
    return urlunsplit((partes.scheme, netloc, partes.path, partes.query, partes.fragment))


def criar_role(url: str, senha: str) -> None:
    """Cria (ou atualiza a senha de) a role de inscrição e aplica os grants."""
    import psycopg

    with psycopg.connect(url, connect_timeout=20, autocommit=True) as conn:
        existe = conn.execute(
            "select 1 from pg_roles where rolname = %s", (ROLE,)
        ).fetchone()
        # `create role` e `alter role` não aceitam parâmetro na senha, então a
        # senha vai interpolada — ela é gerada por `secrets.token_urlsafe`, só
        # com caracteres de URL seguros, e nunca vem de entrada do usuário.
        if existe:
            conn.execute(f"alter role {ROLE} with login password '{senha}'")
            log.info("role %s já existia — senha trocada", ROLE)
        else:
            conn.execute(f"create role {ROLE} login password '{senha}'")
            log.info("role %s criada", ROLE)

        conn.execute(f"grant usage on schema public to {ROLE}")
        conn.execute(f"grant insert, update on tenants to {ROLE}")
        # Sem `select`: é o que faz a credencial de inscrição não servir para
        # ler a chave de API nem o banco das outras pessoas.
        conn.execute(f"revoke select on tenants from {ROLE}")
        log.info("grants aplicados: insert, update — sem select")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--url", default="",
                        help="connection string de DONO do banco de registro "
                             "(a que o Neon mostra ao criar o projeto). "
                             "Sem isto, usa INVESTAI_REGISTRY_URL do .env")
    parser.add_argument("--nova-senha", action="store_true",
                        help="troca a senha da role de inscrição (invalida as já entregues)")
    args = parser.parse_args()

    from investai import migrations, tenants

    url = args.url.strip() or tenants.registry_url() or ""
    if not url:
        log.error("Falta a URL do banco de registro.\n\n"
                  "  1. Crie um projeto novo em https://neon.tech (free tier basta).\n"
                  "     É um banco SÓ para o registro — separado dos de carteira.\n"
                  "  2. Copie a connection string que ele mostra.\n"
                  "  3. Rode:  scripts/preparar_registro.py --url 'postgresql://…'")
        return 1
    if not url.startswith(("postgres://", "postgresql://")):
        log.error("a URL deve começar com postgresql:// — copie do painel do Neon")
        return 1

    log.info("--- 1. Schema do registro ---")
    try:
        feitas = migrations.aplicar(url, DIR_REGISTRO)
        log.info("ok (%s)", ", ".join(m.nome for m in feitas) if feitas else "já estava em dia")
    except Exception as exc:  # noqa: BLE001
        log.error("não consegui aplicar: %s", exc)
        return 1

    log.info("--- 2. Role de inscrição ---")
    senha = secrets.token_urlsafe(24)
    try:
        criar_role(url, senha)
    except Exception as exc:  # noqa: BLE001
        log.error("não consegui criar a role: %s", exc)
        return 1

    inscricao = trocar_credenciais(url, ROLE, senha)

    print("\n" + "=" * 72)
    print("1) No SEU .env (e no da VM) — acesso de dono, não compartilhe:")
    print("=" * 72)
    print(f"INVESTAI_REGISTRY_URL={url}")

    print("\n" + "=" * 72)
    print("2) Na Vercel, variável INVESTAI_REGISTRY_URL_POOLED:")
    print("=" * 72)
    print(com_pooler(url))

    print("\n" + "=" * 72)
    print("3) ENTREGUE ISTO a cada pessoa, em canal privado.")
    print("   Escreve a própria linha; não lê a de ninguém.")
    print("   Aparece UMA vez — se perder, rode de novo com --nova-senha.")
    print("=" * 72)
    print(f"INVESTAI_REGISTRY_URL={inscricao}")
    print("\nNa máquina dela:")
    print("  1. cole a linha acima no .env do clone")
    print("  2. python -m investai.setup")
    print()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
