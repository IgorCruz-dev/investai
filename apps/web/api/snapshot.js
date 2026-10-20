/**
 * GET /api/snapshot — tudo que a tela precisa, numa resposta.
 *
 * O corpo pesado (preços, indicadores, notícias, briefing) vem do último
 * `snapshots`, publicado pela VM a cada 30 minutos: a web não roda pandas nem
 * chama o yfinance. Já carteira e extrato são lidos **ao vivo**, porque mudam
 * quando você registra uma compra e esperar meia hora para ver a própria compra
 * aparecer seria esquisito.
 */

import { protegido } from "./_auth.js";
import { db } from "./_db.js";

async function handler(req, res, dono) {
  res.setHeader("Cache-Control", "no-store");
  const sql = db(dono);

  try {
    const [snapshots, posicoes, movimentacoes, perfil] = await Promise.all([
      sql`select id, gerado_em, payload from snapshots order by gerado_em desc limit 1`,
      sql`select p.ticker, p.shares, p.avg_price, p.custo_total, p.pnl_realizado,
                 a.nome, a.classe, a.setor, a.validado, a.invalido
            from posicoes p join ativos a using (ticker)
           where p.shares > 0 order by p.ticker`,
      sql`select id, tipo, ticker, shares, preco, taxas, data, origem, nota
            from movimentacoes order by data desc, id desc limit 100`,
      sql`select respostas, derivado, atualizado from perfil where id = 1`,
    ]);

    const payload = snapshots[0]?.payload || {};
    payload.snapshotId = snapshots[0]?.id ?? null;
    payload.generatedAt = snapshots[0]?.gerado_em ?? null;

    // Ao vivo vence o snapshot: a carteira e o extrato são a verdade de agora.
    payload.live = {
      positions: posicoes.map((p) => ({
        ticker: p.ticker,
        name: p.nome || p.ticker,
        sector: p.setor || "",
        assetClass: p.classe,
        shares: Number(p.shares),
        avgPrice: p.avg_price === null ? null : Number(p.avg_price),
        cost: Number(p.custo_total),
        realized: Number(p.pnl_realizado),
        validated: p.validado,
        invalid: p.invalido,
      })),
      movimentacoes: movimentacoes.map((m) => ({
        id: m.id, tipo: m.tipo, ticker: m.ticker,
        shares: Number(m.shares), preco: Number(m.preco), taxas: Number(m.taxas),
        data: m.data, origem: m.origem, nota: m.nota,
      })),
      perfil: perfil[0]
        ? { ...(perfil[0].derivado || {}), answers: perfil[0].respostas,
            atualizado: perfil[0].atualizado }
        : null,
    };

    return res.status(200).json(payload);
  } catch (erro) {
    console.error("falha ao montar o snapshot:", erro?.message);
    return res.status(503).json({ erro: "banco indisponível" });
  }
}

export default protegido(handler);
