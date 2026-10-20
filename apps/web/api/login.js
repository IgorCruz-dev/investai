/**
 * POST /api/login — troca usuário + senha por um cookie de sessão.
 *
 * Com bloqueio por tentativa: dez erros em quinze minutos do mesmo IP param de
 * responder. Sem isso, uma senha exposta na internet é só questão de tempo de
 * CPU de alguém — e a tabela `tentativas_login` também serve para ver depois se
 * alguém tentou.
 *
 * O contador de tentativas vive no banco **da pessoa**, que é onde a tabela
 * existe: cada um tem o seu Postgres. Em modo de uma pessoa (sem
 * `INVESTAI_TENANTS`) o campo de usuário é ignorado e o fluxo é o de antes.
 */

import { criarCookie, ipDe, senhaConfere } from "./_auth.js";
import { db } from "./_db.js";
import { multiusuario, padrao, porId } from "./_tenants.js";

const MAX_FALHAS = 10;
const JANELA_MIN = 15;

//: Mesma resposta para usuário inexistente e senha errada, de propósito: textos
//: diferentes deixariam enumerar quem tem conta no painel.
const RECUSADO = "Usuário ou senha incorretos.";

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") return res.status(405).json({ erro: "use POST" });

  const segredo = process.env.WEB_SESSION_SECRET;
  if (!segredo) {
    console.error("WEB_SESSION_SECRET ausente");
    return res.status(500).json({ erro: "servidor sem sessão configurada" });
  }

  const corpo = typeof req.body === "object" ? req.body : {};
  const senha = corpo?.senha;
  const dono = (await multiusuario())
    ? await porId(corpo?.usuario)
    : await padrao();

  // Usuário desconhecido: recusa sem tocar em banco. Não há onde registrar a
  // tentativa (a tabela vive no banco de cada pessoa), e não existe senha para
  // conferir — devolver o texto genérico é tudo que se pode fazer aqui.
  if (!dono || !dono.senhaHash) {
    if (dono && !dono.senhaHash) {
      console.error(`usuário ${dono.id} sem web_password_hash no registro`);
    }
    return res.status(401).json({ erro: RECUSADO });
  }

  const ip = ipDe(req);
  const sql = db(dono);

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

  const ok = await senhaConfere(senha, dono.senhaHash);
  try {
    await sql`insert into tentativas_login (ip, sucesso) values (${ip}, ${ok})`;
  } catch (erro) {
    console.error("não foi possível registrar a tentativa:", erro?.message);
  }

  if (!ok) return res.status(401).json({ erro: RECUSADO });

  res.setHeader("Set-Cookie", await criarCookie(dono.id, segredo));
  return res.status(200).json({ ok: true, usuario: dono.id, nome: dono.nome });
}
