"""Calcula o snapshot e publica no Postgres, para a interface web ler.

Roda no cron da VM. A web nunca chama yfinance: ela lê a última linha de
`snapshots`, que é JSON pronto.

    .venv/bin/python scripts/publish_snapshot.py            # sem briefing
    .venv/bin/python scripts/publish_snapshot.py --briefing  # gera e inclui (custa)
"""

from __future__ import annotations

import argparse
import logging
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("snapshot")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--briefing", action="store_true",
                        help="gera o briefing com IA e inclui no snapshot (custa créditos)")
    parser.add_argument("--sem-noticias", action="store_true")
    parser.add_argument("--usuario", default="",
                        help="publica só o snapshot desta pessoa (id do registro)")
    args = parser.parse_args()

    from investai import tenants

    alvos = tenants.todos()
    if args.usuario:
        escolhido = tenants.por_id(args.usuario)
        if escolhido is None:
            log.error("usuário %r não está no registro", args.usuario)
            return 1
        alvos = [escolhido]

    # Uma carteira por banco: o snapshot de cada pessoa sai da conexão dela.
    # Sem registro configurado, `alvos` é o único tenant, montado do .env — e
    # este laço executa exatamente uma vez, como antes.
    falhas = 0
    for dono in alvos:
        with tenants.usar(dono):
            try:
                if _publicar(args, dono.id) != 0:
                    falhas += 1
            except Exception:  # noqa: BLE001 — um banco fora não derruba os outros
                log.exception("falha ao publicar o snapshot de %s", dono.id)
                falhas += 1
    return 1 if falhas else 0


def _publicar(args, usuario: str) -> int:
    from investai.data import repo
    from investai.snapshot import snapshot as construtor

    if not repo.configurado():
        log.error("[%s] DATABASE_URL não configurada.", usuario)
        return 1

    texto_briefing = ""
    if args.briefing:
        from investai.analysis import briefing as briefing_mod

        log.info("gerando o briefing (pode levar 1 minuto)…")
        resultado = briefing_mod.montar()
        if resultado.error:
            log.warning("briefing não entrou no snapshot: %s", resultado.error)
        else:
            texto_briefing = resultado.text
            log.info("briefing gerado | US$ %.4f", briefing_mod.custo_estimado(resultado))

    # O briefing anterior não se perde quando esta execução não gera um novo.
    if not texto_briefing:
        anterior = repo.ultimo_snapshot() or {}
        texto_briefing = anterior.get("briefing") or ""

    payload = construtor.construir(
        com_noticias=not args.sem_noticias, briefing=texto_briefing, use_cache=False)

    # Dados que só o servidor conhece e a tela quer mostrar.
    payload["operacao"] = _operacao()
    payload["perfil"] = repo.perfil()
    payload["movimentacoes"] = _extrato_serializavel(repo.movimentacoes(limite=50))
    payload["realizado"] = repo.resultado_realizado()
    payload["avisos"] = {
        "invalidos": repo.tickers_invalidos(),
        "pendentes": repo.tickers_pendentes(),
    }

    id_snapshot = repo.publicar_snapshot(payload)
    log.info("[%s] snapshot #%d publicado | %d posição(ões), %d ativo(s), %d notícia(s)",
             usuario, id_snapshot, len(payload["positions"]), len(payload["assets"]),
             sum(len(v) for v in (payload.get("news") or {}).values()))
    return 0


def _operacao() -> dict:
    """Gasto do mês e estado da ponte — vêm do SQLite local, não do Postgres."""
    try:
        from investai import tenants
        from investai.whatsapp import bridge_client, store
        from investai.whatsapp.config import MONTHLY_BUDGET_USD

        store.init()
        dono = tenants.ativo()
        multi = tenants.multiusuario()
        return {
            # Em modo multiusuário, o gasto que a tela mostra é o de quem está
            # logado — somar o de todos diria a conta de outra pessoa.
            "gastoMesUsd": round(
                store.gasto_do_mes(dono.telefone if (multi and dono) else None), 4),
            "orcamentoUsd": dono.budget_usd if (multi and dono) else MONTHLY_BUDGET_USD,
            "ponteConectada": bool(bridge_client.status().get("conectado")),
        }
    except Exception as exc:  # noqa: BLE001 — o snapshot não cai por causa disso
        log.warning("dados de operação indisponíveis: %s", exc)
        return {}


def _extrato_serializavel(linhas: list[dict]) -> list[dict]:
    return [
        {"id": linha["id"], "tipo": linha["tipo"], "ticker": linha["ticker"],
         "shares": float(linha["shares"]), "preco": float(linha["preco"]),
         "taxas": float(linha["taxas"]), "data": linha["data"].isoformat(),
         "origem": linha["origem"], "nota": linha["nota"]}
        for linha in linhas
    ]


if __name__ == "__main__":
    raise SystemExit(main())
