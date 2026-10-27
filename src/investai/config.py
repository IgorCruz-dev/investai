"""Configuração central: variáveis de ambiente, tuning e carteira do usuário."""

from __future__ import annotations

import json
import logging
import os
from dataclasses import dataclass
from datetime import date, datetime
from pathlib import Path

from dotenv import load_dotenv

logger = logging.getLogger(__name__)

# Raiz do repositório: src/investai/config.py -> investai -> src -> raiz.
# É onde moram .env, config/ e cache/ — fora do pacote de propósito, para
# `pip install -e .` não misturar código com estado do usuário.
ROOT = Path(__file__).resolve().parents[2]
PORTFOLIO_PATH = ROOT / "config" / "portfolio.json"
PROFILE_PATH = ROOT / "config" / "profile.json"
CACHE_PATH = ROOT / "cache" / "data_cache.json"

load_dotenv(ROOT / ".env")


def _env_float(name: str, default: float) -> float:
    try:
        return float(os.getenv(name, default))
    except (TypeError, ValueError):
        logger.warning("%s inválido no .env — usando %s", name, default)
        return default


def _env_int(name: str, default: int) -> int:
    return int(_env_float(name, default))


# --- Dados de mercado / notícias -------------------------------------------
CACHE_TTL = _env_int("INVESTAI_CACHE_TTL", 3600)          # 1 hora, conforme spec
YF_MIN_INTERVAL = _env_float("INVESTAI_YF_INTERVAL", 0.5)  # anti-bloqueio por IP
NEWS_MIN_INTERVAL = _env_float("INVESTAI_NEWS_INTERVAL", 0.5)
MAX_WORKERS = _env_int("INVESTAI_MAX_WORKERS", 4)
HTTP_TIMEOUT = _env_float("INVESTAI_HTTP_TIMEOUT", 10.0)
DEFAULT_PERIOD = os.getenv("INVESTAI_PERIOD", "1y")
NEWS_DAYS = _env_int("INVESTAI_NEWS_DAYS", 7)
NEWS_PER_TICKER = _env_int("INVESTAI_NEWS_PER_TICKER", 5)

# Fonte de notícias: "google" (RSS do Google Notícias, sem chave), "currents"
# (Currents API, exige chave) ou "auto" (Google e, se vier vazio, Currents).
# O Google é o padrão porque a busca por ticker ("VALE3") é inambígua, enquanto
# a Currents casa palavra solta e devolve muito ruído em português — comparação
# feita em 12/10/2026: VALE3 trouxe 62 itens de veículos financeiros no Google
# contra notícias de futebol e gastronomia na Currents.
NEWS_PROVIDER = os.getenv("INVESTAI_NEWS_PROVIDER", "auto").strip().lower()
GOOGLE_NEWS_ENDPOINT = "https://news.google.com/rss/search"
CURRENTS_ENDPOINT = "https://api.currentsapi.services/v1/search"

# --- LLM --------------------------------------------------------------------
# claude-opus-5 é o Opus mais recente. Atenção: `temperature` foi REMOVIDO da
# API nesta geração (envia-lo devolve HTTP 400); o rigor factual vem do system
# prompt e de `output_config.effort`.
LLM_MODEL = os.getenv("INVESTAI_MODEL", "claude-opus-5")
# Medido: um briefing de 3 ativos consumiu 7.310 tokens de saída. O teto precisa
# de folga para carteiras maiores, senão o texto trunca no meio da análise.
LLM_MAX_TOKENS = _env_int("INVESTAI_MAX_TOKENS", 16000)
LLM_TIMEOUT = _env_float("INVESTAI_LLM_TIMEOUT", 120.0)
LLM_EFFORT = os.getenv("INVESTAI_EFFORT", "medium")
CONTEXT_TOKEN_BUDGET = _env_int("INVESTAI_CONTEXT_BUDGET", 8000)


def anthropic_key() -> str | None:
    """A chave Anthropic desta instalação pessoal."""
    return os.getenv("ANTHROPIC_API_KEY") or None


def currents_key() -> str | None:
    return os.getenv("CURRENTS_API_KEY") or None


@dataclass(frozen=True)
class Position:
    """Uma posição da carteira.

    `avg_price=None` significa **posição planejada**: o ativo foi recomendado
    mas ainda não comprado. Sem preço de compra não existe P&L — e inventar um
    (usando o preço atual, por exemplo) produziria um resultado falso de 0%.
    """

    ticker: str
    shares: float
    avg_price: float | None = None
    asset_class: str = "acao"      # acao | etf | fii | renda_fixa
    target_weight: float | None = None  # peso-alvo quando vem de recomendação

    @property
    def is_planned(self) -> bool:
        return self.avg_price is None


@dataclass(frozen=True)
class Portfolio:
    positions: tuple[Position, ...] = ()
    currency: str = "BRL"
    last_updated: str | None = None
    #: True quando a carteira é uma recomendação ainda não executada.
    planned: bool = False

    @property
    def tickers(self) -> list[str]:
        """Tickers com dados de mercado (renda fixa não é negociada em bolsa)."""
        return [p.ticker for p in self.positions if p.asset_class != "renda_fixa"]

    @property
    def all_tickers(self) -> list[str]:
        return [p.ticker for p in self.positions]

    @property
    def has_real_positions(self) -> bool:
        return any(not p.is_planned for p in self.positions)

    def __len__(self) -> int:
        return len(self.positions)

    def as_dicts(self) -> list[dict]:
        return [
            {
                "ticker": p.ticker,
                "shares": p.shares,
                "avg_price": p.avg_price,
                "asset_class": p.asset_class,
                "target_weight": p.target_weight,
            }
            for p in self.positions
        ]


def load_portfolio(path: Path | str | None = None) -> Portfolio:
    """A carteira atual: do Postgres quando há banco, do JSON quando não.

    Com `DATABASE_URL` configurada o banco é a verdade — é o que a interface web
    na Vercel também lê. Sem ela (notebook sem banco, testes offline), lê o
    arquivo como sempre leu. E se o banco estiver fora do ar, cai para o espelho
    em JSON em vez de devolver carteira vazia: leitura degradada é melhor que
    número errado, e `save_portfolio` mantém o espelho atualizado a cada escrita.

    Um `path` explícito sempre vence — é por onde os testes passam um arquivo
    temporário.
    """
    if path is None:
        from investai.data import repo

        if repo.configurado():
            try:
                return repo.posicoes()
            except Exception as exc:  # noqa: BLE001 — leitura nunca estoura
                logger.warning(
                    "Banco indisponível (%s) — lendo o espelho em %s",
                    exc.__class__.__name__, PORTFOLIO_PATH.name,
                )

    path = Path(path) if path else PORTFOLIO_PATH
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        logger.error("Carteira não encontrada em %s", path)
        return Portfolio()
    except (json.JSONDecodeError, OSError) as exc:
        logger.error("Carteira ilegível (%s): %s", path, exc)
        return Portfolio()

    positions: list[Position] = []
    for entry in raw.get("portfolio", []) or []:
        try:
            ticker = str(entry["ticker"]).strip().upper()
            if not ticker:
                raise ValueError("ticker vazio")
            avg_price = entry.get("avg_price")
            positions.append(
                Position(
                    ticker=ticker,
                    shares=float(entry.get("shares", 0) or 0),
                    # Ausente ou nulo = posição planejada (sem compra feita).
                    avg_price=None if avg_price in (None, "") else float(avg_price),
                    asset_class=str(entry.get("asset_class", "acao")).strip().lower(),
                    target_weight=(
                        float(entry["target_weight"]) if entry.get("target_weight") is not None else None
                    ),
                )
            )
        except (KeyError, TypeError, ValueError) as exc:
            logger.warning("Posição ignorada em %s (%s): %s", path, entry, exc)

    return Portfolio(
        positions=tuple(positions),
        currency=str(raw.get("currency", "BRL")),
        last_updated=raw.get("last_updated"),
        planned=bool(raw.get("planned", False)) or all(p.is_planned for p in positions) if positions else False,
    )


def save_portfolio(portfolio: Portfolio, path: Path | str | None = None) -> bool:
    """Grava a carteira em disco (escrita atômica). `False` em caso de falha."""
    path = Path(path) if path else PORTFOLIO_PATH
    payload = {
        "portfolio": portfolio.as_dicts(),
        "currency": portfolio.currency,
        "planned": portfolio.planned,
        "last_updated": date.today().isoformat(),
    }
    return _write_json(path, payload)


def load_profile(path: Path | str | None = None) -> dict:
    """Perfil do investidor: do Postgres quando há banco, do JSON quando não.

    Mesma regra de `load_portfolio`, e pelo mesmo motivo — o onboarding pelo
    WhatsApp grava no banco, e quem lê o perfil (`status_do_perfil`,
    `recomendar_carteira`, o dashboard) precisa ver o que foi gravado.
    """
    if path is None:
        from investai.data import repo

        if repo.configurado():
            try:
                perfil = repo.perfil()
                if perfil:
                    return perfil
            except Exception as exc:  # noqa: BLE001 — leitura nunca estoura
                logger.warning("Perfil indisponível no banco (%s) — lendo %s",
                               exc.__class__.__name__, PROFILE_PATH.name)

    path = Path(path) if path else PROFILE_PATH
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {}
    except FileNotFoundError:
        return {}
    except (json.JSONDecodeError, OSError) as exc:
        logger.warning("Perfil ilegível (%s): %s", path, exc)
        return {}


def save_profile(profile: dict, path: Path | str | None = None) -> bool:
    """Grava o perfil. Com banco configurado, grava nos dois: banco e espelho.

    O banco é a verdade (é o que a interface web e o WhatsApp leem); o arquivo
    continua existindo para o Streamlit local e como backup legível.
    """
    path = Path(path) if path else PROFILE_PATH
    gravou = _write_json(path, {**profile, "saved_at": datetime.now().isoformat()})

    if path == PROFILE_PATH:
        from investai.data import repo

        if repo.configurado():
            try:
                respostas = profile.get("answers") or {}
                derivado = {k: v for k, v in profile.items() if k != "answers"}
                repo.salvar_perfil(respostas, derivado)
            except Exception as exc:  # noqa: BLE001
                logger.error("Perfil não foi gravado no banco: %s", exc)
                return False
    return gravou


def _write_json(path: Path, payload: dict) -> bool:
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(path.suffix + ".tmp")
        tmp.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
        os.replace(tmp, path)  # troca atômica
        return True
    except (OSError, TypeError, ValueError) as exc:
        logger.error("Não foi possível gravar %s: %s", path, exc)
        return False
