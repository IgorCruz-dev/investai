/**
 * Registro de usuários — a mesma fonte que o Python lê.
 *
 * Cada pessoa tem o próprio banco: o schema do InvestAI é de uma carteira por
 * banco (`posicoes` com `ticker` como chave primária, `perfil` com
 * `check (id = 1)`), e manter isso em vez de furar com uma coluna `usuario`
 * significa que o isolamento é a conexão, não um `where` que alguém pode
 * esquecer.
 *
 * Fontes, em ordem de precedência:
 *
 * 1. `INVESTAI_REGISTRY_URL_POOLED` — a tabela `tenants` do banco de registro
 *    central. É o modo que permite auto-inscrição: cada pessoa grava a própria
 *    linha rodando `python -m investai.setup` do próprio clone, e esta função
 *    passa a atendê-la sem ninguém mexer em variável de ambiente da Vercel;
 * 2. `INVESTAI_TENANTS` — o registro inteiro como JSON numa variável;
 * 3. nada: modo de uma pessoa, com `DATABASE_URL_POOLED` e `WEB_PASSWORD_HASH`.
 *
 * O cache vale `TTL_MS` por instância da função — uma inscrição nova aparece
 * sozinha, e o custo de errar é uma query a mais.
 */

import { neon } from "@neondatabase/serverless";

const ID_PADRAO = "padrao";

//: O id viaja dentro do cookie (`usuario.prazo.assinatura`): um ponto ali
//: quebraria a separação da assinatura. Mesmo conjunto que o Python valida.
const ID_VALIDO = /^[a-z0-9][a-z0-9_-]{0,31}$/;

const TTL_MS = 60_000;

let cache = null;
let cacheExpira = 0;

function normalizar(bruto) {
  const id = String(bruto?.id || "").trim().toLowerCase();
  if (!id || !ID_VALIDO.test(id)) return null;
  return {
    id,
    nome: String(bruto?.nome || id).trim(),
    databaseUrl: String(
      bruto?.database_url_pooled || bruto?.database_url || ""
    ).trim(),
    senhaHash: String(bruto?.web_password_hash || "").trim(),
  };
}

function deduplicar(brutos) {
  const lista = [];
  const vistos = new Set();
  for (const bruto of brutos) {
    const t = normalizar(bruto);
    if (!t || vistos.has(t.id)) {
      console.error("tenant com id ausente, duplicado ou inválido, ignorado:",
        bruto?.id || "(vazio)");
      continue;
    }
    vistos.add(t.id);
    lista.push(t);
  }
  return lista;
}

async function doBanco(url) {
  const sql = neon(url);
  const linhas = await sql`
    select id, nome, database_url, database_url_pooled, web_password_hash
      from tenants where ativo order by id`;
  return deduplicar(linhas);
}

function doJson(cru) {
  let dados;
  try {
    dados = JSON.parse(cru);
  } catch (erro) {
    // Registro ilegível é falha de configuração, não motivo para liberar
    // acesso: lista vazia e todo login é recusado.
    console.error("INVESTAI_TENANTS não é JSON válido:", erro?.message);
    return [];
  }
  if (!Array.isArray(dados)) dados = dados?.tenants || [];
  return deduplicar(dados);
}

async function carregar() {
  const agora = Date.now();
  if (cache && agora < cacheExpira) return cache;

  const urlRegistro = (process.env.INVESTAI_REGISTRY_URL_POOLED || "").trim();
  if (urlRegistro) {
    try {
      cache = { multi: true, lista: await doBanco(urlRegistro) };
    } catch (erro) {
      // Registro fora do ar não pode virar "modo de uma pessoa": isso faria o
      // painel responder com a carteira de quem hospeda para quem logasse.
      // Lista vazia recusa todo login, que é o desfecho correto.
      console.error("não consegui ler o registro:", erro?.message);
      cache = { multi: true, lista: [] };
    }
    cacheExpira = agora + TTL_MS;
    return cache;
  }

  const cru = (process.env.INVESTAI_TENANTS || "").trim();
  if (cru) {
    cache = { multi: true, lista: doJson(cru) };
    cacheExpira = agora + TTL_MS;
    return cache;
  }

  cache = {
    multi: false,
    lista: [
      {
        id: ID_PADRAO,
        nome: "padrão",
        databaseUrl:
          process.env.DATABASE_URL_POOLED || process.env.DATABASE_URL || "",
        senhaHash: process.env.WEB_PASSWORD_HASH || "",
      },
    ],
  };
  cacheExpira = agora + TTL_MS;
  return cache;
}

export async function multiusuario() {
  return (await carregar()).multi;
}

export async function todos() {
  return (await carregar()).lista;
}

export async function porId(id) {
  const alvo = String(id || "").trim().toLowerCase();
  if (!alvo) return null;
  return (await carregar()).lista.find((t) => t.id === alvo) || null;
}

/** Em modo de uma pessoa, o login não pede usuário — é este. */
export async function padrao() {
  const { multi, lista } = await carregar();
  return multi ? null : lista[0];
}
