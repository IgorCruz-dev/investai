import { supabase } from '../lib/supabase'
import type { Tables } from '../types/database'

export type Investimento = Tables<'investimentos'>
export type Cotacao = Tables<'cotacoes'>

/** Tipos da Pluggy + CASH para o que se cadastra à mão (dólar em espécie, cripto...) */
export const NOME_DO_TIPO: Record<string, string> = {
  FIXED_INCOME: 'Renda fixa',
  SECURITY: 'Previdência',
  MUTUAL_FUND: 'Fundos',
  EQUITY: 'Ações e FIIs',
  ETF: 'ETFs',
  COE: 'COE',
  CASH: 'Dólar e outros',
}

export type DadosInvestimento = {
  tipo: string
  nome: string
  instituicao: string
  codigo: string
  quantidade: number | null
  saldoCentavos: number
  aplicadoCentavos: number
  empresarial: boolean
}

/** Posições ativas (as resgatadas por inteiro ficam fora) e a cotação dos tickers delas */
export async function listarCarteira() {
  const { data, error } = await supabase
    .from('investimentos')
    .select('*')
    .neq('status', 'TOTAL_WITHDRAWAL')
    .order('saldo_bruto', { ascending: false })
  if (error) throw error
  const tickers = [...new Set(data.map((i) => i.codigo?.toUpperCase()).filter((c): c is string => Boolean(c)))]
  const { data: cotacoes, error: e2 } = tickers.length
    ? await supabase.from('cotacoes').select('*').in('ticker', tickers)
    : { data: [] as Cotacao[], error: null }
  if (e2) throw e2
  return { investimentos: data, cotacoes: new Map(cotacoes.map((c) => [c.ticker, c])) }
}

/** Valor da posição hoje: líquido quando o banco informa, senão bruto */
export const valorAtual = (i: Investimento) => Number(i.saldo_liquido ?? i.saldo_bruto)

export async function salvarInvestimento(d: DadosInvestimento, id?: string) {
  const codigo = d.codigo.trim().toUpperCase() || null
  const campos = {
    origem: 'manual',
    tipo: d.tipo,
    nome: d.nome.trim(),
    instituicao: d.instituicao.trim() || null,
    codigo,
    quantidade: codigo ? d.quantidade : null,
    saldo_bruto: d.saldoCentavos / 100,
    saldo_liquido: null,
    valor_aplicado: d.aplicadoCentavos ? d.aplicadoCentavos / 100 : null,
    empresarial: d.empresarial,
    atualizado_em: new Date().toISOString(),
  }
  const { data, error } = id
    ? await supabase.from('investimentos').update(campos).eq('id', id).select('id').single()
    : await supabase.from('investimentos').insert(campos).select('id').single()
  if (error) throw new Error('Não foi possível salvar o investimento.')
  // Saldo de hoje para a evolução
  const hoje = new Date().toLocaleDateString('en-CA')
  await supabase
    .from('investimentos_historico')
    .upsert({ investimento_id: data.id, dia: hoje, saldo_bruto: campos.saldo_bruto }, { onConflict: 'investimento_id,dia' })
}

export async function excluirInvestimento(id: string) {
  const { error } = await supabase.from('investimentos').delete().eq('id', id)
  if (error) throw new Error('Não foi possível excluir o investimento.')
}
