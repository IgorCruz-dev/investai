/**
 * POST /api/job — pede à VM algo que só ela pode fazer.
 *
 * A interface não tem pandas, nem yfinance, nem a chave da Anthropic; a VM não
 * aceita conexão de fora. A ponte entre as duas é esta tabela: aqui a linha é
 * inserida, e o cron da VM executa na próxima passada (até 5 minutos).
 *
 * É o que dá "gerar briefing agora" e "atualizar dados" no navegador sem abrir
 * uma única porta na VM.
 */

import { protegido } from "./_auth.js";
import { db, mensagemDeErro } from "./_db.js";

const TIPOS = new Set(["briefing", "snapshot", "validar_tickers"]);

async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method === "GET") {
    try {
      const fila = await db()`
        select id, tipo, estado, criado, fechado, resultado from jobs
         order by criado desc limit 10`;
      return res.status(200).json({ jobs: fila });
    } catch (erro) {
      return res.status(503).json({ erro: mensagemDeErro(erro) });
    }
  }

  if (req.method !== "POST") return res.status(405).json({ erro: "use POST" });

  const tipo = req.body?.tipo;
  if (!TIPOS.has(tipo)) {
    return res.status(400).json({ erro: `Tipo inválido: ${tipo}` });
  }

  try {
    const sql = db();
    // Um pendente do mesmo tipo já basta: clicar três vezes em "gerar
    // briefing" não deve gerar (e cobrar) três briefings.
    const [jaTem] = await sql`
      select id from jobs where tipo = ${tipo} and estado in ('pendente', 'rodando')
       order by criado limit 1`;
    if (jaTem) {
      return res.status(200).json({ ok: true, id: jaTem.id, jaEnfileirado: true });
    }

    const [linha] = await sql`insert into jobs (tipo) values (${tipo}) returning id`;
    return res.status(202).json({ ok: true, id: linha.id });
  } catch (erro) {
    return res.status(400).json({ erro: mensagemDeErro(erro) });
  }
}

export default protegido(handler);
