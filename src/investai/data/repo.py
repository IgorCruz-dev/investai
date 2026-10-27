"""Acesso ao Postgres do Supabase: carteira, perfil, snapshots e fila.

Por que um banco gerenciado e não o arquivo JSON que havia antes: a interface
web roda na Vercel e o assistente roda na VM da Oracle, e os dois precisam ver a
mesma carteira. Com o estado dentro da VM, a web só a alcançaria abrindo uma
porta na internet — exatamente a propriedade que este deploy não quer perder.
Com o estado fora das duas, cada lado faz só conexão de **saída**.

Regra do módulo: `movimentacoes` é a verdade e `posicoes` é derivada dela pelo
trigger em `supabase/migrations`. Nada aqui escreve em `posicoes`.

Sem `DATABASE_URL` configurada, todas as funções levantam `SemBanco` — quem
chama decide se cai para o JSON (é o que `investai.config.load_portfolio` faz) ou se
avisa o usuário.
"""

from __future__ import annotations

import json
import logging
import os
import threading
from dataclasses import dataclass
from datetime import date
from typing import Any

from investai.config import Portfolio, Position

logger = logging.getLogger(__name__)

#: Quantos snapshots guardar. São o histórico do dashboard, não um data lake.
SNAPSHOTS_RETIDOS = 30

#: Quantos planos guardar. Poucos de propósito: o plano velho serve para comparar
#: com o de hoje, não para virar arquivo morto de carteiras que nunca foram
#: compradas.
PLANOS_RETIDOS = 10


class SemBanco(RuntimeError):
    """`DATABASE_URL` não configurada ou driver ausente."""


class ErroDeEscrita(RuntimeError):
    """Escrita recusada pelo banco — mensagem já em português, para o usuário.

    Nasce das `check` constraints e do `raise` do replay (vender mais cotas do
    que se tem). Separada de `SemBanco` porque uma é culpa do pedido e a outra é
    da infraestrutura, e o usuário precisa saber qual.
    """


def url() -> str | None:
    """A conexão Postgres desta instalação pessoal."""
    return os.getenv("DATABASE_URL") or None


def configurado() -> bool:
    return bool(url())


# --- Conexão ----------------------------------------------------------------
# Uma conexão compartilhada com pool de tamanho limitado para a instância.
_pool: Any | None = None
_pool_lock = threading.Lock()


def _criar_pool() -> Any:
    endereco = url()
    if not endereco:
        raise SemBanco("DATABASE_URL não configurada")
    try:
        from psycopg_pool import ConnectionPool
    except ImportError as exc:  # pragma: no cover - ambiente sem a dependência
        raise SemBanco(f"psycopg não instalado ({exc})") from exc

    # min_size=0 evita conexões abertas durante a ociosidade da VM.
    return ConnectionPool(
        endereco, min_size=0, max_size=4, timeout=20, max_idle=60,
        kwargs={"connect_timeout": 15, "application_name": "investai"},
        open=True,
    )


def pool() -> Any:
    global _pool
    if _pool is not None:
        return _pool
    with _pool_lock:
        if _pool is None:
            _pool = _criar_pool()
        return _pool


def reset_pool() -> None:
    """Fecha o pool. Usado pelos testes ao trocar de banco."""
    global _pool
    with _pool_lock:
        if _pool is not None:
            try:
                _pool.close()
            except Exception:  # noqa: BLE001
                logger.debug("falha ao fechar o pool", exc_info=True)
        _pool = None


def _traduzir(exc: Exception) -> Exception:
    """Erro do psycopg → erro nosso, com texto que pode ir para a tela."""
    texto = str(getattr(exc, "diag", None) and exc.diag.message_primary or exc).strip()
    nome = exc.__class__.__name__

    if nome in ("CheckViolation", "RaiseException"):
        return ErroDeEscrita(texto)
    if nome == "ForeignKeyViolation":
        return ErroDeEscrita("Ativo não cadastrado no catálogo.")
    if nome in ("OperationalError", "PoolTimeout", "InterfaceError"):
        return SemBanco(f"Banco indisponível ({nome}).")
    return exc


class _Cursor:
    """Context manager de cursor com tradução de erro na saída."""

    def __init__(self, escrita: bool) -> None:
        self._escrita = escrita

    def __enter__(self) -> Any:
        from psycopg.rows import dict_row

        self._ctx = pool().connection()
        self._conn = self._ctx.__enter__()
        self._cur_ctx = self._conn.cursor(row_factory=dict_row)
        return self._cur_ctx.__enter__()

    def __exit__(self, tipo, valor, tb) -> bool:
        try:
            self._cur_ctx.__exit__(tipo, valor, tb)
            self._ctx.__exit__(tipo, valor, tb)
        except Exception as exc:  # noqa: BLE001
            traduzido = _traduzir(exc)
            if traduzido is exc:
                raise
            raise traduzido from exc
        if valor is not None:
            traduzido = _traduzir(valor)
            if traduzido is not valor:
                raise traduzido from valor
        return False


def cursor(escrita: bool = False) -> _Cursor:
    return _Cursor(escrita)


def _executar(sql: str, params: tuple = (), *, buscar: str = "nada") -> Any:
    with cursor(escrita=buscar == "nada") as cur:
        cur.execute(sql, params)
        if buscar == "um":
            return cur.fetchone()
        if buscar == "todos":
            return cur.fetchall()
        return None


# --- Ativos -----------------------------------------------------------------
def garantir_ativo(ticker: str, nome: str | None = None, classe: str = "acao",
                   setor: str | None = None, validado: bool = False) -> None:
    """Insere o ativo no catálogo se ainda não existir. Não sobrescreve o que há.

    A FK de `movimentacoes` exige o ativo antes do movimento, e um ticker que o
    universo curado não conhece é legítimo — você pode comprar fora dos 38.
    """
    _executar(
        """
        insert into ativos (ticker, nome, classe, setor, validado)
        values (%s, %s, %s, %s, %s)
        on conflict (ticker) do update
           set nome     = coalesce(ativos.nome, excluded.nome),
               setor    = coalesce(ativos.setor, excluded.setor),
               validado = ativos.validado or excluded.validado
        """,
        (ticker, nome, classe, setor, validado),
    )


def ativos_a_conferir(limite: int = 10) -> list[dict[str, Any]]:
    """Tickers que entraram pela web e ninguém confirmou no yfinance ainda."""
    return _executar(
        "select ticker from ativos where not validado and not invalido "
        "order by ticker limit %s",
        (limite,), buscar="todos",
    ) or []


def marcar_conferido(ticker: str, existe: bool, nome: str | None = None,
                     setor: str | None = None) -> None:
    _executar(
        "update ativos set validado = %s, invalido = %s, conferido = now(), "
        "nome = coalesce(%s, nome), setor = coalesce(%s, setor) where ticker = %s",
        (existe, not existe, nome, setor, ticker),
    )


def tickers_invalidos() -> list[str]:
    linhas = _executar(
        "select a.ticker from ativos a join posicoes p using (ticker) "
        "where a.invalido and p.shares > 0 order by a.ticker",
        buscar="todos",
    ) or []
    return [linha["ticker"] for linha in linhas]


def tickers_pendentes() -> list[str]:
    linhas = _executar(
        "select a.ticker from ativos a join posicoes p using (ticker) "
        "where not a.validado and not a.invalido and p.shares > 0 order by a.ticker",
        buscar="todos",
    ) or []
    return [linha["ticker"] for linha in linhas]


# --- Posições ---------------------------------------------------------------
def posicoes() -> Portfolio:
    """A carteira atual, no mesmo dataclass que o resto do sistema já usa.

    Só posições com cotas: as linhas com `shares = 0` existem para preservar o
    resultado realizado de uma posição encerrada, e não são carteira.
    """
    linhas = _executar(
        """
        select p.ticker, p.shares, p.avg_price, a.classe
          from posicoes p join ativos a using (ticker)
         where p.shares > 0
         order by p.ticker
        """,
        buscar="todos",
    ) or []

    posicoes_lidas = tuple(
        Position(
            ticker=linha["ticker"],
            shares=float(linha["shares"]),
            avg_price=None if linha["avg_price"] is None else float(linha["avg_price"]),
            asset_class=linha["classe"],
        )
        for linha in linhas
    )
    return Portfolio(positions=posicoes_lidas, currency="BRL",
                     last_updated=date.today().isoformat())


def resultado_realizado() -> float:
    linha = _executar(
        "select coalesce(sum(pnl_realizado), 0) as total from posicoes", buscar="um"
    )
    return float((linha or {}).get("total") or 0.0)


# --- Movimentações ----------------------------------------------------------
@dataclass(frozen=True)
class Movimento:
    """Uma linha do ledger, já validada por quem construiu."""

    tipo: str            # compra | venda | ajuste
    ticker: str
    shares: float
    preco: float
    taxas: float = 0.0
    data: date | None = None
    origem: str = "whatsapp"
    nota: str | None = None

    def as_dict(self) -> dict[str, Any]:
        return {
            "tipo": self.tipo, "ticker": self.ticker, "shares": self.shares,
            "preco": self.preco, "taxas": self.taxas,
            "data": (self.data or date.today()).isoformat(),
            "origem": self.origem, "nota": self.nota,
        }


def registrar_movimento(mov: Movimento) -> int:
    """Grava no ledger. O trigger recomputa `posicoes` na mesma transação.

    Devolve o id da movimentação — é o `#id` que o extrato mostra para você
    poder corrigir ou apagar depois.
    """
    linha = _executar(
        """
        insert into movimentacoes (tipo, ticker, shares, preco, taxas, data, origem, nota)
        values (%s, %s, %s, %s, %s, %s, %s, %s)
        returning id
        """,
        (mov.tipo, mov.ticker, mov.shares, mov.preco, mov.taxas,
         mov.data or date.today(), mov.origem, mov.nota),
        buscar="um",
    )
    return int(linha["id"])


def movimentacoes(limite: int = 10, ticker: str | None = None,
                  offset: int = 0) -> list[dict[str, Any]]:
    if ticker:
        return _executar(
            "select * from movimentacoes where ticker = %s "
            "order by data desc, id desc limit %s offset %s",
            (ticker, limite, offset), buscar="todos",
        ) or []
    return _executar(
        "select * from movimentacoes order by data desc, id desc limit %s offset %s",
        (limite, offset), buscar="todos",
    ) or []


def movimento(id_mov: int) -> dict[str, Any] | None:
    return _executar("select * from movimentacoes where id = %s", (id_mov,), buscar="um")


def ultimo_movimento() -> dict[str, Any] | None:
    """O mais recente por id de inserção — é o que o `/desfazer` apaga.

    Por `id`, não por `data`: desfazer significa "a última coisa que eu
    registrei", e não "a de data mais recente" (você pode lançar hoje uma compra
    de mês passado).
    """
    return _executar("select * from movimentacoes order by id desc limit 1", buscar="um")


def editar_movimento(id_mov: int, campos: dict[str, Any]) -> bool:
    """Atualiza os campos informados. O replay recompõe a posição."""
    permitidos = {"tipo", "ticker", "shares", "preco", "taxas", "data", "nota"}
    mudancas = {k: v for k, v in (campos or {}).items() if k in permitidos}
    if not mudancas:
        return False
    atribuicoes = ", ".join(f"{k} = %s" for k in mudancas)
    with cursor(escrita=True) as cur:
        cur.execute(
            f"update movimentacoes set {atribuicoes} where id = %s",
            (*mudancas.values(), id_mov),
        )
        return cur.rowcount > 0


def apagar_movimento(id_mov: int) -> bool:
    with cursor(escrita=True) as cur:
        cur.execute("delete from movimentacoes where id = %s", (id_mov,))
        return cur.rowcount > 0


def apagar_ticker(ticker: str) -> int:
    """Apaga o ativo da carteira junto com todo o histórico dele.

    É o que `/remover` faz, e é diferente de vender: vender registra um negócio
    que aconteceu; remover declara que aquelas movimentações nunca deveriam ter
    existido. Destrutivo de propósito e sem volta — quem chama precisa confirmar
    com o usuário citando quantas linhas vão embora.
    """
    with cursor(escrita=True) as cur:
        cur.execute("delete from movimentacoes where ticker = %s", (ticker,))
        apagadas = cur.rowcount
        # A posição some pelo trigger; o catálogo fica (é referência, não carteira).
    return apagadas


def total_movimentacoes(ticker: str | None = None) -> int:
    if ticker:
        linha = _executar("select count(*) as n from movimentacoes where ticker = %s",
                          (ticker,), buscar="um")
    else:
        linha = _executar("select count(*) as n from movimentacoes", buscar="um")
    return int((linha or {}).get("n") or 0)


# --- Perfil -----------------------------------------------------------------
def perfil() -> dict[str, Any]:
    """Perfil salvo no formato que `load_profile()` sempre devolveu.

    As respostas ficam na chave `answers` e o derivado é espalhado no mesmo
    nível — é o que `tools.status_do_perfil` e `recomendar_carteira` esperam.
    """
    linha = _executar("select respostas, derivado, atualizado from perfil_investidor where id = 1",
                      buscar="um")
    if not linha:
        return {}
    derivado = linha["derivado"] or {}
    return {**derivado, "answers": linha["respostas"] or {},
            "saved_at": linha["atualizado"].isoformat() if linha["atualizado"] else None}


def salvar_perfil(respostas: dict[str, Any], derivado: dict[str, Any]) -> None:
    _executar(
        """
        insert into perfil_investidor (id, respostas, derivado, atualizado)
        values (1, %s, %s, now())
        on conflict (id) do update
           set respostas = excluded.respostas,
               derivado  = excluded.derivado,
               atualizado = now()
        """,
        (json.dumps(respostas, ensure_ascii=False, default=str),
         json.dumps(derivado, ensure_ascii=False, default=str)),
    )


# --- Planos (carteira sugerida) ---------------------------------------------
#
# Plano é lista de conferência, nunca posição: aceitar um plano não cria
# movimentação (spec 002, item 4). Quem grava é a VM; o PWA só lê.
def publicar_plano(payload: dict[str, Any]) -> int:
    """Grava a carteira sugerida e poda as antigas, na mesma ida ao banco."""
    with cursor(escrita=True) as cur:
        cur.execute(
            "insert into planos (payload) values (%s) returning id",
            (json.dumps(payload, ensure_ascii=False, default=str),),
        )
        id_novo = int(cur.fetchone()["id"])
        cur.execute(
            "delete from planos where id not in "
            "(select id from planos order by gerado_em desc limit %s)",
            (PLANOS_RETIDOS,),
        )
    return id_novo


def ultimo_plano() -> dict[str, Any] | None:
    linha = _executar(
        "select id, gerado_em, aceito_em, payload from planos "
        "order by gerado_em desc limit 1",
        buscar="um",
    )
    if not linha:
        return None
    payload = linha["payload"] or {}
    payload["planoId"] = linha["id"]
    payload["geradoEm"] = linha["gerado_em"].isoformat()
    payload["aceitoEm"] = linha["aceito_em"].isoformat() if linha["aceito_em"] else None
    return payload


# --- Snapshots --------------------------------------------------------------
def publicar_snapshot(payload: dict[str, Any]) -> int:
    """Grava o snapshot e poda os antigos, na mesma ida ao banco."""
    with cursor(escrita=True) as cur:
        cur.execute(
            "insert into snapshots (payload) values (%s) returning id",
            (json.dumps(payload, ensure_ascii=False, default=str),),
        )
        id_novo = int(cur.fetchone()["id"])
        cur.execute(
            "delete from snapshots where id not in "
            "(select id from snapshots order by gerado_em desc limit %s)",
            (SNAPSHOTS_RETIDOS,),
        )
    return id_novo


def ultimo_snapshot() -> dict[str, Any] | None:
    linha = _executar(
        "select id, gerado_em, payload from snapshots order by gerado_em desc limit 1",
        buscar="um",
    )
    if not linha:
        return None
    payload = linha["payload"] or {}
    payload["snapshotId"] = linha["id"]
    payload["generatedAt"] = linha["gerado_em"].isoformat()
    return payload


# --- Fila de trabalho -------------------------------------------------------
def enfileirar_job(tipo: str, pedido: dict[str, Any] | None = None) -> int:
    linha = _executar(
        "insert into jobs (tipo, pedido) values (%s, %s) returning id",
        (tipo, json.dumps(pedido or {}, ensure_ascii=False)), buscar="um",
    )
    return int(linha["id"])


def tomar_job() -> dict[str, Any] | None:
    """Pega o job pendente mais antigo e o marca como rodando, atomicamente.

    `for update skip locked` para dois consumidores (o cron e um teste, digamos)
    nunca pegarem o mesmo job.
    """
    return _executar(
        """
        update jobs set estado = 'rodando'
         where id = (select id from jobs where estado = 'pendente'
                      order by criado limit 1 for update skip locked)
        returning id, tipo, pedido
        """,
        buscar="um",
    )


def fechar_job(id_job: int, ok: bool, resultado: dict[str, Any] | None = None) -> None:
    _executar(
        "update jobs set estado = %s, resultado = %s, fechado = now() where id = %s",
        ("feito" if ok else "erro",
         json.dumps(resultado or {}, ensure_ascii=False, default=str), id_job),
    )


def jobs_pendentes() -> int:
    linha = _executar("select count(*) as n from jobs where estado = 'pendente'",
                      buscar="um")
    return int((linha or {}).get("n") or 0)
