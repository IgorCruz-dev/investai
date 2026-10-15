/**
 * CRUD do ledger: /api/movimento
 *
 *   POST                     registra compra, venda ou ajuste
 *   PATCH  ?id=123           corrige uma movimentação
 *   DELETE ?id=123           apaga uma movimentação
 *   DELETE ?ticker=PETR4.SA  apaga o ativo e todo o histórico dele
 *
 * As posições **não** são escritas aqui: o trigger `movimentacoes_recomputa`
 * refaz o replay do ledger a cada escrita. É o que faz corrigir um preço de
 * três meses atrás consertar a posição sozinho, sem recálculo manual e sem
 * chance de posição e histórico divergirem.
 *
 * A validação de mercado (o ticker existe? o preço faz sentido?) não acontece
 * aqui: ela precisa do yfinance, que só existe na VM. O ativo entra como
 * `validado = false` e o cron confere em até 15 minutos, marcando `invalido`
 * se não existir — e a tela mostra o aviso enquanto isso.
 */

import { protegido } from "./_auth.js";
import { db, mensagemDeErro } from "./_db.js";

const TIPOS = new Set(["compra", "venda", "ajuste"]);
const MAX_SHARES = 1e9;
const MAX_PRECO = 1e7;

/** Aceita número e string em formato brasileiro — o mesmo que
 *  `parse_number_br` faz no Python, e pelo mesmo motivo: o campo do formulário
 *  recebe o que a pessoa digita, e ela digita "35,50". */
function numero(valor) {
  if (typeof valor === "number") return Number.isFinite(valor) ? valor : null;
  if (typeof valor !== "string") return null;

  const limpo = valor.replace(/[^\d,.-]/g, "");
  if (!limpo || !/\d/.test(limpo)) return null;

  const virgula = limpo.lastIndexOf(",");
  const ponto = limpo.lastIndexOf(".");
  let normal = limpo;
  if (virgula > ponto) normal = limpo.replace(/\./g, "").replace(",", ".");
  else if (ponto > virgula) {
    // Três dígitos depois do separador nunca são centavos: "3.550" é milhar.
    normal = limpo.length - ponto - 1 === 3
      ? limpo.replace(/\./g, "")
      : limpo.replace(/,/g, "");
  }
  const lido = Number(normal);
  return Number.isFinite(lido) ? lido : null;
}

function normalizarTicker(cru) {
  const codigo = String(cru || "").trim().toUpperCase().replace(/\s/g, "");
  if (!codigo) return "";
  if (codigo.includes(".")) return codigo;
  return /^[A-Z]{4}\d{1,2}$/.test(codigo) ? `${codigo}.SA` : codigo;
}

function validar(corpo, { exigirTudo = true } = {}) {
  const erros = [];
  const dados = {};

  if (corpo.tipo !== undefined || exigirTudo) {
    if (!TIPOS.has(corpo.tipo)) erros.push("Tipo deve ser compra, venda ou ajuste.");
    else dados.tipo = corpo.tipo;
  }

  if (corpo.ticker !== undefined || exigirTudo) {
    const ticker = normalizarTicker(corpo.ticker);
    if (!ticker) erros.push("Informe o código do ativo.");
    else if (!/^[A-Z0-9]{1,10}(\.[A-Z]{2})?$/.test(ticker)) {
      erros.push(`"${corpo.ticker}" não parece um código de ativo.`);
    } else dados.ticker = ticker;
  }

  if (corpo.shares !== undefined || exigirTudo) {
    const cotas = numero(corpo.shares);
    if (cotas === null) erros.push("Quantidade de cotas inválida.");
    else if (cotas <= 0) erros.push("A quantidade precisa ser maior que zero.");
    else if (cotas > MAX_SHARES) erros.push("Essa quantidade não parece real.");
    else dados.shares = cotas;
  }

  if (corpo.preco !== undefined || exigirTudo) {
    const preco = numero(corpo.preco);
    if (preco === null) erros.push("Preço inválido.");
    else if (preco <= 0) erros.push("O preço precisa ser maior que zero.");
    else if (preco > MAX_PRECO) erros.push("Esse preço não parece real.");
    else dados.preco = preco;
  }

  if (corpo.taxas !== undefined && corpo.taxas !== "" && corpo.taxas !== null) {
    const taxas = numero(corpo.taxas);
    if (taxas === null || taxas < 0) erros.push("Taxas inválidas.");
    else dados.taxas = taxas;
  }

  if (corpo.data !== undefined && corpo.data !== "" && corpo.data !== null) {
    const data = String(corpo.data).slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) erros.push("Data inválida.");
    else {
      const hoje = new Date().toISOString().slice(0, 10);
      if (data > hoje) erros.push("A data não pode estar no futuro.");
      else if (data < "1990-01-01") erros.push("Essa data parece errada.");
      else dados.data = data;
    }
  }

  if (corpo.nota !== undefined && corpo.nota !== null) {
    dados.nota = String(corpo.nota).slice(0, 500) || null;
  }

  return { dados, erros };
}

async function criar(req, res, sql) {
  const { dados, erros } = validar(req.body || {});
  if (erros.length) return res.status(400).json({ erro: erros[0], erros });

  const { tipo, ticker, shares, preco } = dados;
  const taxas = dados.taxas ?? 0;
  const data = dados.data ?? new Date().toISOString().slice(0, 10);

  // A FK exige o ativo antes do movimento. Ticker fora do universo curado é
  // legítimo — você pode comprar o que quiser — e entra pendente de conferência.
  await sql`insert into ativos (ticker) values (${ticker})
            on conflict (ticker) do nothing`;

  const [linha] = await sql`
    insert into movimentacoes (tipo, ticker, shares, preco, taxas, data, origem, nota)
    values (${tipo}, ${ticker}, ${shares}, ${preco}, ${taxas}, ${data}, 'web',
            ${dados.nota ?? null})
    returning id`;

  const [posicao] = await sql`
    select shares, avg_price, pnl_realizado from posicoes where ticker = ${ticker}`;

  return res.status(201).json({
    ok: true,
    id: linha.id,
    posicao: posicao
      ? { shares: Number(posicao.shares),
          avgPrice: posicao.avg_price === null ? null : Number(posicao.avg_price),
          realized: Number(posicao.pnl_realizado) }
      : null,
  });
}

async function editar(req, res, sql, id) {
  const { dados, erros } = validar(req.body || {}, { exigirTudo: false });
  if (erros.length) return res.status(400).json({ erro: erros[0], erros });
  if (!Object.keys(dados).length) {
    return res.status(400).json({ erro: "Nada para alterar." });
  }

  if (dados.ticker) {
    await sql`insert into ativos (ticker) values (${dados.ticker})
              on conflict (ticker) do nothing`;
  }

  // Um UPDATE com COALESCE em lugar de SQL montado por concatenação: os valores
  // seguem parametrizados, e campo ausente fica como está.
  const resultado = await sql`
    update movimentacoes set
      tipo   = coalesce(${dados.tipo ?? null}, tipo),
      ticker = coalesce(${dados.ticker ?? null}, ticker),
      shares = coalesce(${dados.shares ?? null}, shares),
      preco  = coalesce(${dados.preco ?? null}, preco),
      taxas  = coalesce(${dados.taxas ?? null}, taxas),
      data   = coalesce(${dados.data ?? null}::date, data),
      nota   = coalesce(${dados.nota ?? null}, nota)
    where id = ${id}
    returning id`;

  if (!resultado.length) return res.status(404).json({ erro: "Movimentação não encontrada." });
  return res.status(200).json({ ok: true, id });
}

async function apagar(req, res, sql, id, ticker) {
  if (ticker) {
    const codigo = normalizarTicker(ticker);
    const apagadas = await sql`delete from movimentacoes where ticker = ${codigo}
                               returning id`;
    if (!apagadas.length) {
      return res.status(404).json({ erro: "Esse ativo não tem movimentação." });
    }
    return res.status(200).json({ ok: true, apagadas: apagadas.length });
  }

  const resultado = await sql`delete from movimentacoes where id = ${id} returning id`;
  if (!resultado.length) return res.status(404).json({ erro: "Movimentação não encontrada." });
  return res.status(200).json({ ok: true, apagadas: 1 });
}

async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  const sql = db();
  const url = new URL(req.url, "http://localhost");
  const id = Number(url.searchParams.get("id") || 0);
  const ticker = url.searchParams.get("ticker");

  try {
    if (req.method === "POST") return await criar(req, res, sql);

    if (req.method === "PATCH") {
      if (!id) return res.status(400).json({ erro: "Informe o id." });
      return await editar(req, res, sql, id);
    }

    if (req.method === "DELETE") {
      if (!id && !ticker) return res.status(400).json({ erro: "Informe id ou ticker." });
      return await apagar(req, res, sql, id, ticker);
    }

    return res.status(405).json({ erro: "Use POST, PATCH ou DELETE." });
  } catch (erro) {
    return res.status(400).json({ erro: mensagemDeErro(erro) });
  }
}

export default protegido(handler);
