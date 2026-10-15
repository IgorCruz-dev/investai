/**
 * Autenticação da interface: senha única e cookie assinado.
 *
 * É uma interface de um usuário só, exposta na internet. O desenho:
 *
 * - a senha **não existe** em lugar nenhum — nem no repositório, nem no banco,
 *   nem em variável de ambiente. O que fica guardado é um hash PBKDF2-SHA256
 *   com 210 mil iterações e salt aleatório;
 * - acertar a senha devolve um cookie `exp.assinatura`, onde a assinatura é um
 *   HMAC-SHA256 do prazo com um segredo do servidor. O cookie não carrega
 *   nenhum dado além da validade, e adulterar o prazo invalida a assinatura;
 * - `HttpOnly` fecha a porta para XSS; `Secure` e `SameSite=Lax` fecham para
 *   sniffing e CSRF.
 *
 * PBKDF2 e HMAC vêm do Web Crypto, que já existe no runtime — zero dependência
 * de biblioteca de autenticação.
 */

const COOKIE = "investai_sess";
const DIAS = 30;
const ITERACOES = 210000;

const enc = new TextEncoder();

/** Comparação em tempo constante: `===` em string vaza o tamanho do prefixo
 *  correto por tempo de resposta, e com isso um atacante monta a assinatura. */
function iguais(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let diferenca = 0;
  for (let i = 0; i < a.length; i++) diferenca |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diferenca === 0;
}

function hex(buffer) {
  return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function b64(buffer) {
  return Buffer.from(buffer).toString("base64");
}

async function pbkdf2(senha, salt, iteracoes) {
  const chave = await crypto.subtle.importKey("raw", enc.encode(senha), "PBKDF2",
    false, ["deriveBits"]);
  return crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations: iteracoes }, chave, 256);
}

/** Gera o valor de `WEB_PASSWORD_HASH`. Usado pelo script de setup. */
export async function gerarHash(senha, iteracoes = ITERACOES) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const derivado = await pbkdf2(senha, salt, iteracoes);
  return `pbkdf2$${iteracoes}$${b64(salt)}$${b64(derivado)}`;
}

export async function senhaConfere(senha, guardado) {
  if (!senha || !guardado) return false;
  const [algoritmo, iteracoes, saltB64, hashB64] = String(guardado).split("$");
  if (algoritmo !== "pbkdf2") return false;
  const salt = Buffer.from(saltB64, "base64");
  const derivado = await pbkdf2(senha, salt, Number(iteracoes) || ITERACOES);
  return iguais(b64(derivado), hashB64);
}

async function assinar(valor, segredo) {
  const chave = await crypto.subtle.importKey("raw", enc.encode(segredo),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hex(await crypto.subtle.sign("HMAC", chave, enc.encode(String(valor))));
}

export async function criarCookie(segredo) {
  const expira = Date.now() + DIAS * 24 * 60 * 60 * 1000;
  const token = `${expira}.${await assinar(expira, segredo)}`;
  return `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${DIAS * 86400}`;
}

export function cookieVazio() {
  return `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

function lerCookie(req) {
  const cru = req.headers?.cookie || "";
  for (const parte of cru.split(";")) {
    const [nome, ...resto] = parte.trim().split("=");
    if (nome === COOKIE) return resto.join("=");
  }
  return "";
}

export async function autenticado(req) {
  const segredo = process.env.WEB_SESSION_SECRET;
  if (!segredo) return false;

  const token = lerCookie(req);
  if (!token) return false;

  const [expira, assinatura] = token.split(".");
  if (!expira || !assinatura) return false;
  if (Number(expira) < Date.now()) return false;

  return iguais(await assinar(expira, segredo), assinatura);
}

/** Envolve um handler exigindo sessão válida. 401 é o sinal que o front usa
 *  para mostrar a tela de senha. */
export function protegido(handler) {
  return async (req, res) => {
    if (!(await autenticado(req))) {
      res.setHeader("Cache-Control", "no-store");
      return res.status(401).json({ erro: "nao_autenticado" });
    }
    return handler(req, res);
  };
}

/** IP do visitante, para contar tentativas de login. */
export function ipDe(req) {
  const encaminhado = req.headers?.["x-forwarded-for"] || "";
  return String(encaminhado).split(",")[0].trim() || "desconhecido";
}
