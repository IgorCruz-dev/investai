/**
 * Registro de usuários — o mesmo documento que o Python lê.
 *
 * Cada pessoa tem o próprio banco: o schema do InvestAI é de uma carteira por
 * banco (`posicoes` com `ticker` como chave primária, `perfil` com
 * `check (id = 1)`), e manter isso em vez de furar com uma coluna `usuario`
 * significa que o isolamento é a conexão, não um `where` que alguém pode
 * esquecer.
 *
 * A Vercel só entrega variável de ambiente, então o registro inteiro vem em
 * `INVESTAI_TENANTS` como JSON. É a mesma variável que a VM aceita, de
 * propósito: um documento só, duas plataformas.
 *
 *     [
 *       { "id": "igor",  "nome": "Igor",
 *         "database_url_pooled": "postgresql://…-pooler…",
 *         "web_password_hash": "pbkdf2$210000$…" },
 *       …
 *     ]
 *
 * Sem `INVESTAI_TENANTS`, cai no modo de uma pessoa: `DATABASE_URL_POOLED` e
 * `WEB_PASSWORD_HASH`, exatamente como antes.
 */

const ID_PADRAO = "padrao";

//: O id viaja dentro do cookie (`usuario.prazo.assinatura`): um ponto ali
//: quebraria a separação da assinatura. Mesmo conjunto que o Python valida.
const ID_VALIDO = /^[a-z0-9][a-z0-9_-]{0,31}$/;

let cache = null;

function carregar() {
  if (cache) return cache;

  const cru = (process.env.INVESTAI_TENANTS || "").trim();
  if (!cru) {
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
    return cache;
  }

  let dados;
  try {
    dados = JSON.parse(cru);
  } catch (erro) {
    // Registro ilegível é falha de configuração, não motivo para liberar
    // acesso: devolve lista vazia e todo login é recusado.
    console.error("INVESTAI_TENANTS não é JSON válido:", erro?.message);
    cache = { multi: true, lista: [] };
    return cache;
  }
  if (!Array.isArray(dados)) dados = dados?.tenants || [];

  const lista = [];
  const vistos = new Set();
  for (const bruto of dados) {
    const id = String(bruto?.id || "").trim().toLowerCase();
    if (!id || vistos.has(id) || !ID_VALIDO.test(id)) {
      console.error("tenant com id ausente, duplicado ou inválido, ignorado:",
        id || "(vazio)");
      continue;
    }
    vistos.add(id);
    lista.push({
      id,
      nome: String(bruto?.nome || id).trim(),
      databaseUrl: String(
        bruto?.database_url_pooled || bruto?.database_url || ""
      ).trim(),
      senhaHash: String(bruto?.web_password_hash || "").trim(),
    });
  }

  cache = { multi: true, lista };
  return cache;
}

export function multiusuario() {
  return carregar().multi;
}

export function todos() {
  return carregar().lista;
}

export function porId(id) {
  const alvo = String(id || "").trim().toLowerCase();
  if (!alvo) return null;
  return carregar().lista.find((t) => t.id === alvo) || null;
}

/** Em modo de uma pessoa, o login não pede usuário — é este. */
export function padrao() {
  return multiusuario() ? null : carregar().lista[0];
}
