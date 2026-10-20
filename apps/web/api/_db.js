/**
 * Conexão com o Neon pelo driver HTTP.
 *
 * `@neondatabase/serverless` fala com o Postgres por HTTP, sem socket nem pool
 * pendurado — é o que faz sentido numa função que vive por 200 ms. Usa o
 * endpoint com pooler (`DATABASE_URL_POOLED`); o endpoint direto fica para o
 * psycopg da VM, que mantém pool próprio e usa prepared statements.
 */

import { neon } from "@neondatabase/serverless";

let cliente = null;

export function db() {
  if (!cliente) {
    const url = process.env.DATABASE_URL_POOLED || process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL_POOLED não configurada");
    cliente = neon(url);
  }
  return cliente;
}

/** Erro do Postgres → mensagem em português para a tela.
 *
 *  As `check` constraints e o `raise` do replay (vender mais cotas do que se
 *  tem) são validação de verdade, não detalhe de infraestrutura: o texto delas
 *  é informação útil, mas o traceback do driver não é. */
export function mensagemDeErro(erro) {
  const texto = String(erro?.message || erro || "");
  if (/excede a posição/i.test(texto)) {
    return texto.replace(/^.*?(venda de)/i, "$1");
  }
  if (/shares_check|shares > 0/i.test(texto)) return "A quantidade precisa ser maior que zero.";
  if (/preco_check|preco >= 0/i.test(texto)) return "O preço não pode ser negativo.";
  if (/taxas_check/i.test(texto)) return "As taxas não podem ser negativas.";
  if (/tipo_check/i.test(texto)) return "Tipo de movimento inválido.";
  if (/violates foreign key|ativos_ticker/i.test(texto)) return "Ativo não cadastrado.";
  if (/duplicate key/i.test(texto)) return "Esse registro já existe.";
  console.error("erro de banco:", texto);
  return "O banco recusou a operação.";
}
