"""Deriva o perfil, monta a carteira sugerida e publica o plano no Postgres.

Roda no cron da VM, acionado pelo job `recomendacao` que o PWA enfileira.

É aqui que a divisão de trabalho da unificação aparece inteira: o PWA grava as
18 respostas e não sabe derivar perfil nem montar carteira — não tem as regras
de alocação, nem pandas, nem yfinance. A VM tem tudo isso e não aceita conexão
de fora. A fila `jobs` é a ponte.

    .venv/bin/python scripts/publish_recomendacao.py              # com triagem
    .venv/bin/python scripts/publish_recomendacao.py --sem-triagem  # custo zero

A triagem de notícia é o único caminho pago daqui (spec 003). `--sem-triagem`
existe para rodar o fluxo inteiro sem gastar crédito — em teste manual, ou
quando o orçamento do mês já acabou.
"""

from __future__ import annotations

import argparse
import logging
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("recomendacao")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--sem-triagem", action="store_true",
                        help="monta a carteira sem a triagem de notícia (não gasta crédito)")
    args = parser.parse_args()
    return _publicar(triagem=not args.sem_triagem)


def _publicar(*, triagem: bool) -> int:
    from investai.analysis.recommender import recommend
    from investai.analysis.screener import UNIVERSE
    from investai.data import market_data, repo
    from investai.onboarding.profile import build_profile

    if not repo.configurado():
        log.error("DATABASE_URL não configurada.")
        return 1

    salvo = repo.perfil()
    respostas = salvo.get("answers") or {}
    if not respostas:
        # Sem as 18 respostas não há alocação-alvo, e sem alocação-alvo não há
        # carteira. Não é erro de sistema: é o onboarding ainda não feito.
        log.error("perfil não respondido — nada a recomendar")
        return 2

    # A derivação é determinística e mora só aqui: o PWA guarda a resposta, a VM
    # guarda a conclusão. Duas fontes de verdade para o score seria a armadilha.
    profile = build_profile(respostas)
    repo.salvar_perfil(respostas, profile.to_dict())
    log.info("perfil %s (score %.0f/100), %.2f para investir",
             profile.profile, profile.risk_score, profile.investable_amount)

    dados = market_data.get_portfolio_data([a.ticker for a in UNIVERSE])
    rec = recommend(profile, dados, triagem=triagem)

    payload = _serializar(profile, rec)
    id_plano = repo.publicar_plano(payload)
    log.info("plano #%d publicado | %d posição(ões), %d veto(s), triagem %s",
             id_plano, len(payload["posicoes"]), len(payload["vetos"]),
             "ok" if rec.triagem_ok else f"não rodou ({rec.triagem_motivo})")
    return 0


def _serializar(profile, rec) -> dict:
    """JSON pronto para o PWA desenhar — ele só lê, nunca recalcula."""
    return {
        "perfil": {
            "nome": profile.profile,
            "score": round(profile.risk_score, 1),
            "horizonteAnos": profile.horizon_years,
            "disponivel": round(profile.investable_amount, 2),
            "aporteMensal": round(profile.monthly_contribution, 2),
            "alocacao": profile.allocation,
            "notas": profile.notes,
        },
        # Pré-requisito é porteiro, não bloqueio (spec 002): vai no topo da tela,
        # antes da carteira, inclusive quando bloqueia.
        "prerequisitos": [
            {"titulo": p.title, "detalhe": p.detail, "valor": p.amount,
             "bloqueia": p.blocking}
            for p in profile.prerequisites
        ],
        "posicoes": [
            {"ticker": p.ticker, "nome": p.name, "classe": p.asset_class,
             "setor": p.sector, "pesoPct": p.weight_pct, "valor": p.amount,
             "preco": p.price, "cotas": p.shares, "justificativa": p.rationale}
            for p in rec.positions
        ],
        "rejeitados": rec.rejected,
        # O veto aplicado: o ativo saiu da carteira.
        "vetos": [v.to_dict() for v in rec.vetos],
        # O veto recusado pelos limites da spec: o ativo FICOU, e o alerta
        # aparece do lado dele. Não é a mesma coisa, e a tela não pode misturar.
        "alertas": [v.to_dict() for v in rec.alertas],
        "triagemOk": rec.triagem_ok,
        "triagemMotivo": rec.triagem_motivo,
        "resumo": rec.summary,
        "riscos": rec.risk_notes,
        "proximosPassos": rec.next_steps,
        "incompleta": bool(rec.error),
        "aviso": rec.error or "",
    }


if __name__ == "__main__":
    raise SystemExit(main())
