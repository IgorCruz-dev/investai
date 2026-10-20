"""Registro de usuários: um telefone e um login para cada banco.

O sistema nasceu para uma pessoa, e isso está no desenho do schema: `posicoes`
tem `ticker` como chave primária e `perfil` é `check (id = 1)` — uma carteira e
um perfil por banco. Em vez de furar isso com uma coluna `usuario` em cada
tabela (e depender de nunca esquecer um `where`), cada pessoa tem **o seu
próprio banco**: o schema continua correto, e o isolamento é a conexão, não a
disciplina de quem escreve a query.

Este módulo é o mapa entre a pessoa e as credenciais dela:

    telefone do WhatsApp ─┐
                          ├─→ Tenant ─→ DATABASE_URL + chave da Anthropic
    login da web ─────────┘

O tenant ativo viaja num `ContextVar`, não numa global. Isso **não** é
preciosismo: os handlers do FastAPI são `def` síncrono, então rodam num
threadpool, e duas mensagens no mesmo segundo trocariam uma global entre si —
uma query do Kaua executaria no banco do Ricardo. `ContextVar` é isolado por
thread e por task, que é exatamente a garantia necessária aqui.

Onde o registro mora, em ordem de precedência:

1. `INVESTAI_TENANTS` — o JSON inteiro numa variável de ambiente. É o único
   caminho possível na Vercel, e é o mesmo documento que o `api/_auth.js` lê;
2. `config/tenants.json` — mais confortável de editar na VM (fora do git);
3. nenhum dos dois: o sistema opera **como sempre operou**, com um tenant só
   montado a partir de `DATABASE_URL` e `ANTHROPIC_API_KEY`. É o que mantém a
   instalação de uma pessoa (e a suíte de testes) funcionando sem registro.
"""

from __future__ import annotations

import contextvars
import json
import logging
import os
import re
import threading
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv

logger = logging.getLogger(__name__)

#: Raiz do repositório: src/investai/tenants.py -> investai -> src -> raiz.
ROOT = Path(__file__).resolve().parents[2]
REGISTRO_PATH = ROOT / "config" / "tenants.json"

# O `.env` é carregado aqui, e não só em `config`: os crons importam este módulo
# primeiro (`from investai import tenants` antes de qualquer coisa de config), e
# sem isto o tenant do modo pessoal nasceria com `database_url` vazia — o cron
# diria "DATABASE_URL não configurada" numa instalação perfeitamente
# configurada. `load_dotenv` não sobrescreve variável já definida, então chamar
# nos dois lugares é inofensivo.
load_dotenv(ROOT / ".env")

#: Id do tenant sintético do modo de uma pessoa só. Nunca aparece num registro
#: de verdade — serve de chave do pool e de rótulo no log.
ID_PADRAO = "padrao"

#: O id vai **dentro** do cookie de sessão da web, no formato
#: `usuario.prazo.assinatura`. Um ponto no id quebraria essa separação, e um id
#: com caractere estranho entraria em log e em nome de pool — então o conjunto
#: permitido é fechado aqui, na entrada.
ID_VALIDO = re.compile(r"^[a-z0-9][a-z0-9_-]{0,31}$")


class RegistroInvalido(RuntimeError):
    """O registro existe mas não dá para confiar nele.

    Levanta em vez de ignorar a entrada ruim de propósito: um telefone
    duplicado rotearia a mensagem de uma pessoa para o banco de outra, e um
    erro de configuração é melhor que um vazamento silencioso.
    """


@dataclass(frozen=True)
class Tenant:
    """Uma pessoa e as credenciais dela."""

    id: str
    nome: str
    telefone: str
    database_url: str
    #: Endpoint com pooler, para as funções serverless da Vercel. O psycopg da
    #: VM usa o direto (o pooler em modo transação derruba prepared statement).
    database_url_pooled: str
    #: Chave da Anthropic desta pessoa. **Obrigatória** no registro: cada um
    #: traz a sua e paga a própria conta. `None` existe só para o tenant
    #: sintético do modo de uma pessoa, que usa a chave do `.env`.
    anthropic_key: str | None
    #: Teto de gasto mensal com a API, em dólares. Mesmo com chave própria o
    #: teto serve de freio: um laço que repete `/briefing` gastaria sozinho.
    budget_usd: float
    #: Só o `api/_auth.js` usa; fica aqui para o registro ser um documento só.
    web_password_hash: str | None = None

    @property
    def chave_propria(self) -> bool:
        return bool(self.anthropic_key)


def _digitos(valor: object) -> str:
    return "".join(c for c in str(valor or "") if c.isdigit())


def _montar(bruto: dict) -> Tenant:
    ident = str(bruto.get("id") or "").strip().lower()
    telefone = _digitos(bruto.get("telefone"))
    database_url = str(bruto.get("database_url") or "").strip()

    if not ident:
        raise RegistroInvalido("tenant sem `id`")
    if not ID_VALIDO.match(ident):
        raise RegistroInvalido(
            f"id {ident!r} inválido: use de 1 a 32 caracteres entre a-z, 0-9, "
            "`_` e `-`, começando por letra ou número. O id viaja dentro do "
            "cookie de sessão (`usuario.prazo.assinatura`), e um ponto ali "
            "quebraria a leitura da assinatura."
        )
    if not telefone:
        raise RegistroInvalido(f"tenant {ident!r} sem `telefone`")
    if not database_url:
        raise RegistroInvalido(f"tenant {ident!r} sem `database_url`")

    chave = str(bruto.get("anthropic_key") or "").strip() or None
    if not chave:
        raise RegistroInvalido(
            f"tenant {ident!r} sem `anthropic_key` — cada pessoa traz a própria "
            "chave da Anthropic. Sem isso o uso dela sairia do crédito de quem "
            "hospeda o bot, e o gasto de um bloquearia a IA dos outros."
        )
    pooled = str(bruto.get("database_url_pooled") or "").strip() or database_url
    try:
        budget = float(bruto.get("budget_usd", 5))
    except (TypeError, ValueError):
        raise RegistroInvalido(f"tenant {ident!r} com `budget_usd` inválido") from None

    return Tenant(
        id=ident,
        nome=str(bruto.get("nome") or ident).strip(),
        telefone=telefone,
        database_url=database_url,
        database_url_pooled=pooled,
        anthropic_key=chave,
        budget_usd=budget,
        web_password_hash=str(bruto.get("web_password_hash") or "").strip() or None,
    )


def _ler_documento() -> list[dict] | None:
    """Devolve a lista crua de tenants, ou `None` se não houver registro."""
    cru = os.getenv("INVESTAI_TENANTS", "").strip()
    origem = "INVESTAI_TENANTS"

    if not cru and REGISTRO_PATH.exists():
        cru = REGISTRO_PATH.read_text(encoding="utf-8").strip()
        origem = str(REGISTRO_PATH)

    if not cru:
        return None

    try:
        dados = json.loads(cru)
    except json.JSONDecodeError as exc:
        raise RegistroInvalido(f"{origem} não é JSON válido: {exc}") from exc

    # Aceita tanto `[...]` quanto `{"tenants": [...]}`: o segundo formato deixa
    # espaço para configuração global no mesmo arquivo, sem quebrar o primeiro.
    if isinstance(dados, dict):
        dados = dados.get("tenants", [])
    if not isinstance(dados, list):
        raise RegistroInvalido(f"{origem}: esperava uma lista de tenants")
    return dados


def _tenant_do_ambiente() -> Tenant:
    """O modo de uma pessoa só, montado do `.env`."""
    return Tenant(
        id=ID_PADRAO,
        nome="padrão",
        telefone=_digitos(os.getenv("WHATSAPP_ALLOWED_NUMBERS", "").split(",")[0]),
        database_url=os.getenv("DATABASE_URL", ""),
        database_url_pooled=os.getenv("DATABASE_URL_POOLED", "") or os.getenv("DATABASE_URL", ""),
        anthropic_key=None,
        budget_usd=float(os.getenv("INVESTAI_MONTHLY_BUDGET_USD", "5") or 5),
    )


_cache: dict[str, Tenant] | None = None
_cache_multi = False
_cache_lock = threading.Lock()


def _carregar() -> tuple[dict[str, Tenant], bool]:
    documento = _ler_documento()
    if documento is None:
        return {ID_PADRAO: _tenant_do_ambiente()}, False

    registro: dict[str, Tenant] = {}
    telefones: dict[str, str] = {}
    for bruto in documento:
        t = _montar(bruto)
        if t.id in registro:
            raise RegistroInvalido(f"id {t.id!r} aparece duas vezes no registro")
        if t.telefone in telefones:
            raise RegistroInvalido(
                f"telefone de {t.id!r} é o mesmo de {telefones[t.telefone]!r} — "
                "duas pessoas no mesmo número rotearia uma para o banco da outra"
            )
        registro[t.id] = t
        telefones[t.telefone] = t.id

    if not registro:
        raise RegistroInvalido("registro de tenants vazio")

    logger.info("Registro carregado | %d usuário(s): %s",
                len(registro), ", ".join(sorted(registro)))
    return registro, True


def registro() -> dict[str, Tenant]:
    """O registro, carregado uma vez. `recarregar()` limpa o cache."""
    global _cache, _cache_multi
    if _cache is None:
        with _cache_lock:
            if _cache is None:
                _cache, _cache_multi = _carregar()
    return _cache


def recarregar() -> None:
    """Esquece o registro carregado. Para os testes e para trocar o arquivo."""
    global _cache, _cache_multi
    with _cache_lock:
        _cache, _cache_multi = None, False


def multiusuario() -> bool:
    """`True` quando há um registro de verdade, não o tenant do `.env`."""
    registro()
    return _cache_multi


def todos() -> list[Tenant]:
    """Os tenants, em ordem estável — é o que os crons iteram."""
    return [registro()[k] for k in sorted(registro())]


def por_id(ident: str) -> Tenant | None:
    return registro().get(str(ident or "").strip().lower())


def por_telefone(numero: str) -> Tenant | None:
    """O usuário daquele telefone, ou `None`.

    Sem registro devolve `None` mesmo quando o número é o da instância: em modo
    pessoal **não existe** escopo por pessoa, e abrir um escopo com o tenant
    sintético faria `anthropic_key()` e `repo.url()` lerem o tenant em vez do
    `.env` — quebrando a instalação de quem nunca pediu multiusuário.
    """
    if not multiusuario():
        return None
    alvo = _digitos(numero)
    if not alvo:
        return None
    for t in registro().values():
        if t.telefone == alvo:
            return t
    return None


def telefones_autorizados() -> set[str]:
    """Os números que podem falar com o bot.

    Em modo multiusuário o registro **é** a lista branca: um número fora dele
    não tem banco para consultar, então autorizá-lo não faria sentido.
    """
    if multiusuario():
        return {t.telefone for t in registro().values()}
    return {
        _digitos(n)
        for n in os.getenv("WHATSAPP_ALLOWED_NUMBERS", "").split(",")
        if _digitos(n)
    }


# --- Tenant ativo -----------------------------------------------------------
# ContextVar e não global: ver o cabeçalho do módulo.
_ativo: contextvars.ContextVar[Tenant | None] = contextvars.ContextVar(
    "investai_tenant", default=None
)


def ativo() -> Tenant | None:
    """O tenant desta requisição, ou `None` fora de um `usar()`."""
    return _ativo.get()


def ativo_ou_padrao() -> Tenant:
    """O tenant desta requisição; fora de um `usar()`, o do `.env`.

    É o que mantém o dashboard local, os scripts de uma pessoa e os testes
    funcionando sem ninguém precisar abrir um contexto.
    """
    atual = _ativo.get()
    if atual is not None:
        return atual
    if not multiusuario():
        return registro()[ID_PADRAO]
    # Com registro configurado, cair num tenant arbitrário seria pior que
    # falhar: a operação iria para o banco de alguém que não pediu nada.
    raise RegistroInvalido(
        "nenhum usuário ativo — em modo multiusuário toda operação de banco "
        "precisa estar dentro de `tenants.usar(...)`"
    )


@contextmanager
def usar(tenant: Tenant) -> Iterator[Tenant]:
    """Define o tenant desta thread/task pelo tempo do bloco."""
    token = _ativo.set(tenant)
    try:
        yield tenant
    finally:
        _ativo.reset(token)
