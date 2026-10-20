"""Consome a fila `jobs`: o que a web pede e só a VM pode fazer.

A interface na Vercel não tem pandas, nem yfinance, nem a chave da Anthropic — e
a VM não aceita conexão de fora. A ponte entre as duas é uma tabela: a web
insere uma linha em `jobs`, e este script, no cron, executa.

É o que permite "gerar briefing agora" e "atualizar dados" pelo navegador sem
abrir uma única porta na VM.

    .venv/bin/python scripts/process_jobs.py          # processa o que houver
    .venv/bin/python scripts/process_jobs.py --max 1
"""

from __future__ import annotations

import argparse
import logging
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("jobs")

PYTHON = str(ROOT / ".venv" / "bin" / "python")


def _rodar(comando: list[str], timeout: int) -> dict:
    """Executa em subprocesso: um briefing travado não pendura o cron inteiro."""
    try:
        saida = subprocess.run(comando, cwd=ROOT, capture_output=True,
                               text=True, timeout=timeout)
    except subprocess.TimeoutExpired:
        return {"ok": False, "erro": f"excedeu {timeout}s"}
    return {"ok": saida.returncode == 0,
            "erro": (saida.stderr or "")[-500:] if saida.returncode else None}


def executar(tipo: str, pedido: dict) -> dict:
    if tipo == "snapshot":
        return _rodar([PYTHON, "scripts/publicar_snapshot.py"], timeout=300)

    if tipo == "briefing":
        return _rodar([PYTHON, "scripts/publicar_snapshot.py", "--briefing"],
                      timeout=600)

    if tipo == "validar_tickers":
        return _validar_tickers()

    return {"ok": False, "erro": f"tipo desconhecido: {tipo}"}


def _validar_tickers() -> dict:
    """Confere no yfinance os tickers que entraram pela web.

    A web grava otimista (não tem como consultar o mercado), marcando
    `validado=false`. Aqui o ativo é confirmado ou marcado como inválido, e a
    carteira passa a mostrar o aviso.
    """
    from investai.data import market_data, repo

    conferidos, invalidos = 0, []
    for linha in repo.ativos_a_conferir(limite=10):
        ticker = linha["ticker"]
        precos = market_data.get_stock_data(ticker)
        if precos.empty:
            repo.marcar_conferido(ticker, existe=False)
            invalidos.append(ticker)
            log.warning("%s não existe no mercado", ticker)
            continue
        fund = market_data.get_fundamentals(ticker)
        repo.marcar_conferido(ticker, existe=True, nome=fund.get("name"),
                              setor=fund.get("sector"))
        conferidos += 1
        log.info("%s confirmado (%s)", ticker, fund.get("name") or "sem nome")

    return {"ok": True, "conferidos": conferidos, "invalidos": invalidos}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--max", type=int, default=5,
                        help="quantos jobs processar nesta passada (por pessoa)")
    parser.add_argument("--usuario", default="",
                        help="processa só a fila desta pessoa (id do registro)")
    args = parser.parse_args()

    from investai import tenants

    alvos = tenants.todos()
    if args.usuario:
        escolhido = tenants.por_id(args.usuario)
        if escolhido is None:
            log.error("usuário %r não está no registro", args.usuario)
            return 1
        alvos = [escolhido]

    # Cada pessoa tem a própria tabela `jobs`, no próprio banco. Sem registro,
    # este laço roda uma vez, com o tenant do .env — igual ao comportamento antigo.
    falhas = 0
    for dono in alvos:
        with tenants.usar(dono):
            try:
                if _processar_fila(args, dono.id) != 0:
                    falhas += 1
            except Exception:  # noqa: BLE001 — um banco fora não derruba os outros
                log.exception("falha ao processar a fila de %s", dono.id)
                falhas += 1
    return 1 if falhas else 0


def _processar_fila(args, usuario: str) -> int:
    from investai.data import repo

    if not repo.configurado():
        log.error("[%s] DATABASE_URL não configurada.", usuario)
        return 1

    # Conferência de ticker é barata e não precisa de pedido explícito: se há o
    # que conferir, confere. Evita o usuário ficar olhando um aviso amarelo
    # esperando um job que ninguém enfileirou.
    if repo.ativos_a_conferir(limite=1):
        log.info("há ticker pendente de conferência — validando")
        log.info("resultado: %s", _validar_tickers())

    processados = 0
    while processados < args.max:
        job = repo.tomar_job()
        if not job:
            break
        log.info("job #%s: %s", job["id"], job["tipo"])
        resultado = executar(job["tipo"], job.get("pedido") or {})
        repo.fechar_job(job["id"], ok=bool(resultado.get("ok")), resultado=resultado)
        log.info("job #%s %s", job["id"], "feito" if resultado.get("ok") else
                 f"com erro: {resultado.get('erro')}")
        processados += 1

    log.info("[%s] %d job(s) processado(s)", usuario, processados)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
