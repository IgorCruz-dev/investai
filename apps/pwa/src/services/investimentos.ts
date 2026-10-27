import { supabase } from '../lib/supabase'
import type { Tables } from '../types/database'

export type Ativo = Tables<'ativos'>
export type Posicao = Tables<'posicoes'>
export type Movimentacao = Tables<'movimentacoes'>
export type Job = Tables<'jobs'>

export type SnapshotInvestimentos = {
  geradoEm: string
  posicoes: Map<string, { shares: number | null; price: number | null; value: number | null; pnl: number | null; pnlPct: number | null }>
}

export type MovimentoNovo = {
  tipo: 'compra' | 'venda'
  ticker: string
  classe: 'acao' | 'etf' | 'fii'
  shares: number
  preco: number
  taxas: number
  data: string
}

export function tickerCanonico(texto: string): string {
  const ticker = texto.trim().toUpperCase().replace(/\.SA$/, '')
  if (!/^[A-Z]{4,6}\d{1,2}$/.test(ticker)) {
    throw new Error('Digite um ticker da B3, como VALE3 ou HGLG11.')
  }
  return `${ticker}.SA`
}

export async function carregarInvestimentos() {
  const [ativos, posicoes, movimentos, snapshot, jobs, perfil] = await Promise.all([
    supabase.from('ativos').select('*'),
    supabase.from('posicoes').select('*').order('ticker'),
    supabase.from('movimentacoes').select('*').order('data', { ascending: false }).order('id', { ascending: false }).limit(100),
    supabase.from('snapshots').select('gerado_em,payload').order('gerado_em', { ascending: false }).limit(1).maybeSingle(),
    // Só o job de snapshot interessa aqui: um briefing pendente não é
    // "atualização em andamento" e não deve desabilitar o botão.
    supabase.from('jobs').select('*').eq('tipo', 'snapshot').order('criado', { ascending: false }).limit(1).maybeSingle(),
    supabase.from('perfil_investidor').select('derivado').eq('id', 1).maybeSingle(),
  ])
  if (ativos.error) throw ativos.error
  if (posicoes.error) throw posicoes.error
  if (movimentos.error) throw movimentos.error
  if (snapshot.error) throw snapshot.error
  if (jobs.error) throw jobs.error
  if (perfil.error) throw perfil.error
  const payload = snapshot.data?.payload
  const bruto = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : null
  const linhas = Array.isArray(bruto?.positions) ? bruto.positions : []
  const cotacoes = new Map<string, { shares: number | null; price: number | null; value: number | null; pnl: number | null; pnlPct: number | null }>()
  for (const item of linhas) {
    if (!item || typeof item !== 'object' || Array.isArray(item) || typeof item.ticker !== 'string') continue
    cotacoes.set(item.ticker, {
      shares: typeof item.shares === 'number' ? item.shares : null,
      price: typeof item.price === 'number' ? item.price : null,
      value: typeof item.value === 'number' ? item.value : null,
      pnl: typeof item.pnl === 'number' ? item.pnl : null,
      pnlPct: typeof item.pnlPct === 'number' ? item.pnlPct : null,
    })
  }
  const ultimoSnapshot: SnapshotInvestimentos | null = snapshot.data
    ? { geradoEm: snapshot.data.gerado_em, posicoes: cotacoes }
    : null
  const derivado = perfil.data?.derivado
  const objeto = derivado && typeof derivado === 'object' && !Array.isArray(derivado) ? derivado : null
  const alocacao = objeto?.allocation
  const metas: Record<string, number> = {}
  if (alocacao && typeof alocacao === 'object' && !Array.isArray(alocacao)) {
    for (const classe of ['acao', 'etf', 'fii', 'renda_fixa']) {
      const valor = alocacao[classe]
      if (typeof valor === 'number' && Number.isFinite(valor) && valor >= 0) metas[classe] = valor
    }
  }
  return { ativos: ativos.data, posicoes: posicoes.data, movimentos: movimentos.data, snapshot: ultimoSnapshot, job: jobs.data, metas }
}

export async function pedirAtualizacao() {
  const { data: existentes, error: erroBusca } = await supabase.from('jobs').select('id').eq('tipo', 'snapshot').in('estado', ['pendente', 'rodando']).limit(1)
  if (erroBusca) throw erroBusca
  if (existentes.length) return
  const { error } = await supabase.from('jobs').insert({ tipo: 'snapshot' })
  if (error) throw error
}

/** O catálogo aceita ticker não validado; a VM o confere depois pelo yfinance. */
export async function salvarMovimento(dados: MovimentoNovo, id?: number) {
  const ticker = tickerCanonico(dados.ticker)
  if (!Number.isFinite(dados.shares) || dados.shares <= 0 || !Number.isFinite(dados.preco) || dados.preco <= 0 || !Number.isFinite(dados.taxas) || dados.taxas < 0) {
    throw new Error('Informe quantidade e preço maiores que zero, e taxas não negativas.')
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dados.data)) throw new Error('Informe uma data válida.')

  const { data: existente, error: erroBusca } = await supabase.from('ativos').select('classe').eq('ticker', ticker).maybeSingle()
  if (erroBusca) throw erroBusca
  if (existente && existente.classe !== dados.classe) {
    throw new Error(`Este ticker já está cadastrado como ${existente.classe.toUpperCase()}. Escolha essa classe.`)
  }
  const { error: erroAtivo } = await supabase.from('ativos').upsert({ ticker, classe: dados.classe }, { onConflict: 'ticker', ignoreDuplicates: true })
  if (erroAtivo) throw erroAtivo

  const linha = {
    tipo: dados.tipo, ticker, shares: dados.shares, preco: dados.preco,
    taxas: dados.taxas, data: dados.data, origem: 'web',
  }
  const resultado = id === undefined
    ? await supabase.from('movimentacoes').insert(linha)
    : await supabase.from('movimentacoes').update(linha).eq('id', id)
  if (resultado.error) {
    if (resultado.error.message.includes('excede a posição')) throw new Error('Essa venda excede a posição disponível na data escolhida.')
    throw resultado.error
  }
}

export async function excluirMovimento(id: number) {
  const { error } = await supabase.from('movimentacoes').delete().eq('id', id)
  if (error) throw error
}
