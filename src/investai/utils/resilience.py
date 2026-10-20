"""Primitivas de resiliência compartilhadas por todos os módulos de I/O.

Existe um único lugar com retry/backoff, throttle e conversão de exceção em
valor padrão — `market_data` e `news_fetcher` reusam daqui em vez de cada um
reimplementar a própria política.
"""

from __future__ import annotations

import functools
import logging
import random
import threading
import time
from collections.abc import Callable, Iterable
from typing import Any, TypeVar

logger = logging.getLogger(__name__)

T = TypeVar("T")

#: `requests.RequestException` herda de `OSError`, então erros de rede do
#: requests e do urllib usado pelo yfinance caem todos aqui.
NETWORK_ERRORS: tuple[type[BaseException], ...] = (OSError, TimeoutError)


class TransientError(RuntimeError):
    """Falha temporária que sobreviveu a todas as tentativas de retry."""


class PermanentError(RuntimeError):
    """Falha definitiva (ticker inválido, 4xx) — re-tentar não ajuda."""


def retry(
    attempts: int = 3,
    base_delay: float = 1.0,
    max_delay: float = 8.0,
    jitter: bool = True,
    retry_on: Iterable[type[BaseException]] = NETWORK_ERRORS,
    sleep: Callable[[float], None] = time.sleep,
) -> Callable[[Callable[..., T]], Callable[..., T]]:
    """Re-tenta `fn` com backoff exponencial.

    `PermanentError` nunca é re-tentado. Esgotadas as tentativas, a causa
    original é embrulhada em `TransientError` (quem chama trata com `safe`).
    O parâmetro `sleep` é injetável para que os testes rodem sem esperar.
    """
    retry_on = tuple(retry_on)

    def decorator(fn: Callable[..., T]) -> Callable[..., T]:
        @functools.wraps(fn)
        def wrapper(*args: Any, **kwargs: Any) -> T:
            delay = base_delay
            last_exc: BaseException | None = None

            for attempt in range(1, attempts + 1):
                try:
                    return fn(*args, **kwargs)
                except PermanentError:
                    raise
                except retry_on as exc:
                    last_exc = exc
                    if attempt == attempts:
                        break
                    pause = min(delay, max_delay)
                    if jitter:
                        pause += random.uniform(0.0, pause * 0.25)
                    logger.warning(
                        "%s falhou (tentativa %d/%d): %s — nova tentativa em %.1fs",
                        fn.__name__, attempt, attempts, exc, pause,
                    )
                    sleep(pause)
                    delay *= 2

            raise TransientError(
                f"{fn.__name__} falhou após {attempts} tentativas: {last_exc}"
            ) from last_exc

        return wrapper

    return decorator


class Throttle:
    """Garante um intervalo mínimo entre chamadas, inclusive entre threads.

    O yfinance bloqueia por IP quando recebe rajadas; como as buscas rodam num
    ThreadPoolExecutor, um `sleep` solto dentro da função não resolveria — é
    preciso um relógio compartilhado sob lock, que é o que esta classe é.
    """

    def __init__(self, min_interval: float = 0.5) -> None:
        self.min_interval = min_interval
        self._lock = threading.Lock()
        self._last_call = 0.0

    def wait(self) -> None:
        with self._lock:
            elapsed = time.monotonic() - self._last_call
            remaining = self.min_interval - elapsed
            if remaining > 0:
                time.sleep(remaining)
            self._last_call = time.monotonic()

    def __enter__(self) -> Throttle:
        self.wait()
        return self

    def __exit__(self, *_exc: object) -> None:
        return None


def safe(
    default_factory: Callable[[], T],
    message: str = "",
) -> Callable[[Callable[..., T]], Callable[..., T]]:
    """Converte qualquer exceção em um valor padrão + log.

    É a última linha de defesa da regra "nenhuma exceção não tratada chega ao
    usuário": funções públicas de busca de dados são decoradas com isto.
    """

    def decorator(fn: Callable[..., T]) -> Callable[..., T]:
        @functools.wraps(fn)
        def wrapper(*args: Any, **kwargs: Any) -> T:
            try:
                return fn(*args, **kwargs)
            except Exception as exc:  # noqa: BLE001 — fronteira intencional
                logger.error(
                    "%s%s: %s", message or f"{fn.__name__} falhou", f" {args}" if args else "", exc
                )
                return default_factory()

        return wrapper

    return decorator
