/**
 * POST /api/login — troca a senha por um cookie de sessão.
 *
 * Com bloqueio por tentativa: dez erros em quinze minutos do mesmo IP param de
 * responder. Sem isso, uma senha única exposta na internet é só questão de
 * tempo de CPU de alguém — e a tabela `tentativas_login` também serve para eu
 * ver depois se alguém tentou.
 */

import { criarCookie, ipDe, senhaConfere } from "./_auth.js";
import { db } from "./_db.js";

const MAX_FALHAS = 10;
const JANELA_MIN = 15;

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") return res.status(405).json({ erro: "use POST" });

  const guardado = process.env.WEB_PASSWORD_HASH;
  const segredo = process.env.WEB_SESSION_SECRET;
  if (!guardado || !segredo) {
    console.error("WEB_PASSWORD_HASH ou WEB_SESSION_SECRET ausentes");
    return res.status(500).json({ erro: "servidor sem senha configurada" });
  }

  const senha = typeof req.body === "object" ? req.body?.senha : undefined;
  const ip = ipDe(req);
  const sql = db();

  try {
    const [{ falhas }] = await sql`
      select count(*)::int as falhas from tentativas_login
       where not sucesso and ip = ${ip}
         and criado > now() - make_interval(mins => ${JANELA_MIN})`;
    if (falhas >= MAX_FALHAS) {
      return res.status(429).json({
        erro: `Muitas tentativas. Espere ${JANELA_MIN} minutos.`,
      });
    }
  } catch (erro) {
    // Banco fora não pode virar porta aberta: sem poder contar tentativas,
    // o login é recusado em vez de liberado.
    console.error("não foi possível verificar tentativas:", erro?.message);
    return res.status(503).json({ erro: "banco indisponível, tente em instantes" });
  }

  const ok = await senhaConfere(senha, guardado);
  try {
    await sql`insert into tentativas_login (ip, sucesso) values (${ip}, ${ok})`;
  } catch (erro) {
    console.error("não foi possível registrar a tentativa:", erro?.message);
  }

  if (!ok) return res.status(401).json({ erro: "Senha incorreta." });

  res.setHeader("Set-Cookie", await criarCookie(segredo));
  return res.status(200).json({ ok: true });
}
