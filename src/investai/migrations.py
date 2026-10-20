"""Migrações versionadas: aplicar os `.sql` pendentes, em ordem, uma vez cada.

Por que isso existe: com uma pessoa, `001_initial.sql` idempotente bastava —
rodar de novo não quebrava nada. Com **um banco por pessoa** e mais de uma
pessoa mexendo no schema, não basta: quem adiciona uma tabela tem o banco dela
em frente aos outros, e o bot compartilhado quebra para quem está atrás, com
erro de coluna inexistente num caminho que a pessoa nem tocou.

O desenho é o mínimo que resolve:

- cada arquivo em `deploy/sql/` é uma migração, nomeada `NNN_descricao.sql`;
- `schema_migrations` guarda o que já rodou, com o hash do arquivo;
- aplicar é "rodar as pendentes, em ordem, numa transação cada";
- `pendentes()` responde "este banco está atrás?" sem escrever nada — é o que
  o servidor usa no start para avisar em vez de quebrar no meio de uma query.

O hash serve para pegar o acidente clássico: alguém editar uma migração que já
rodou. O arquivo já aplicado em três bancos não volta atrás, então editar é
sempre erro — e o aviso é melhor que a divergência silenciosa.
"""

from __future__ import annotations

import hashlib
import logging
import re
from dataclasses import dataclass
from pathlib import Path

logger = logging.getLogger(__name__)

#: Raiz do repositório: src/investai/migrations.py -> investai -> src -> raiz.
ROOT = Path(__file__).resolve().parents[2]
SQL_DIR = ROOT / "deploy" / "sql"

NOME_VALIDO = re.compile(r"^(\d{3,})_([a-z0-9_-]+)\.sql$")

CRIAR_CONTROLE = """
create table if not exists schema_migrations (
  versao     text primary key,
  arquivo    text not null,
  sha256     text not null,
  aplicado   timestamptz not null default now()
)
"""


class ErroDeMigracao(RuntimeError):
    """Algo que precisa de decisão humana antes de aplicar."""


@dataclass(frozen=True)
class Migracao:
    versao: str
    arquivo: Path
    sha256: str

    @property
    def nome(self) -> str:
        return self.arquivo.name

    def sql(self) -> str:
        return self.arquivo.read_text(encoding="utf-8")


def _hash(caminho: Path) -> str:
    return hashlib.sha256(caminho.read_bytes()).hexdigest()


def disponiveis(diretorio: Path | None = None) -> list[Migracao]:
    """As migrações do repositório, em ordem de versão.

    Ordena pelo número como **inteiro**, não como texto: com `010_` na jogada,
    a ordem alfabética colocaria `010` antes de `002`.
    """
    pasta = diretorio or SQL_DIR
    encontradas: dict[str, Migracao] = {}
    for caminho in sorted(pasta.glob("*.sql")):
        casado = NOME_VALIDO.match(caminho.name)
        if not casado:
            raise ErroDeMigracao(
                f"{caminho.name}: nome fora do padrão `NNN_descricao.sql` "
                "(três dígitos, descrição em minúsculas). O número é a ordem de "
                "aplicação, e um arquivo sem ele não tem lugar na fila."
            )
        versao = str(int(casado.group(1)))
        if versao in encontradas:
            raise ErroDeMigracao(
                f"versão {casado.group(1)} duplicada: {caminho.name} e "
                f"{encontradas[versao].nome}. Duas migrações com o mesmo número "
                "aplicariam em ordem indefinida — renumere uma delas."
            )
        encontradas[versao] = Migracao(versao, caminho, _hash(caminho))
    return [encontradas[v] for v in sorted(encontradas, key=int)]


def _aplicadas(conn) -> dict[str, str]:
    """`{versao: sha256}` do que já rodou neste banco."""
    conn.execute(CRIAR_CONTROLE)
    with conn.cursor() as cur:
        cur.execute("select versao, sha256 from schema_migrations")
        return {linha[0]: linha[1] for linha in cur.fetchall()}


def pendentes(url: str, diretorio: Path | None = None) -> list[Migracao]:
    """O que falta aplicar neste banco. Não escreve schema nenhum.

    Cria só a tabela de controle, que é o mínimo para saber a resposta.
    """
    import psycopg

    with psycopg.connect(url, connect_timeout=20, autocommit=True) as conn:
        feitas = _aplicadas(conn)

    faltando = []
    for m in disponiveis(diretorio):
        if m.versao not in feitas:
            faltando.append(m)
        elif feitas[m.versao] != m.sha256:
            logger.warning(
                "%s já foi aplicada neste banco mas o arquivo mudou desde então. "
                "Migração aplicada não volta atrás: crie uma nova em vez de "
                "editar esta.", m.nome,
            )
    return faltando


def marcar_aplicadas(url: str, diretorio: Path | None = None) -> list[Migracao]:
    """Registra as pendentes como aplicadas **sem executá-las**.

    É a adoção do controle de versão num banco que já tem o schema: o banco
    pessoal que rodava antes deste módulo tem as tabelas, mas não tem a linha em
    `schema_migrations`, e sem isso a primeira execução tentaria "aplicar" o
    inicial de novo. O `001_initial.sql` é idempotente e sobreviveria, mas uma
    migração futura pode não ser — então o certo é registrar o ponto de partida.

    Use só quando você sabe que o schema daquele arquivo já está no banco.
    """
    import psycopg

    marcadas = pendentes(url, diretorio)
    if not marcadas:
        return []
    with psycopg.connect(url, connect_timeout=20) as conn:
        for m in marcadas:
            conn.execute(
                "insert into schema_migrations (versao, arquivo, sha256) "
                "values (%s, %s, %s) on conflict (versao) do update "
                "set arquivo = excluded.arquivo, sha256 = excluded.sha256",
                (m.versao, m.nome, m.sha256),
            )
        conn.commit()
    logger.info("marcadas como aplicadas sem executar: %s",
                ", ".join(m.nome for m in marcadas))
    return marcadas


def aplicar(url: str, diretorio: Path | None = None) -> list[Migracao]:
    """Aplica as pendentes, em ordem, uma transação por migração.

    Uma transação por arquivo, e não uma para todas: se a terceira falhar, as
    duas primeiras continuam aplicadas e registradas, e a próxima execução
    retoma de onde parou. O contrário obrigaria a reaplicar o que já funcionou.
    """
    import psycopg

    aplicadas: list[Migracao] = []
    for m in pendentes(url, diretorio):
        with psycopg.connect(url, connect_timeout=20) as conn:
            try:
                conn.execute(m.sql())
                conn.execute(
                    "insert into schema_migrations (versao, arquivo, sha256) "
                    "values (%s, %s, %s) on conflict (versao) do update "
                    "set arquivo = excluded.arquivo, sha256 = excluded.sha256",
                    (m.versao, m.nome, m.sha256),
                )
                conn.commit()
            except Exception as exc:
                conn.rollback()
                raise ErroDeMigracao(f"{m.nome} falhou: {exc}") from exc
        logger.info("migração aplicada: %s", m.nome)
        aplicadas.append(m)
    return aplicadas
