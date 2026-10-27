import { paraISO } from '../lib/datas'
import { mesDaFatura } from '../lib/fatura'
import { supabase } from '../lib/supabase'
import type { Cartao, NovoCartao } from '../types/financas'

export async function listarCartoes() {
  const { data, error } = await supabase.from('cartoes').select('*').order('nome')
  if (error) throw error
  return data
}

export async function buscarCartao(id: string) {
  const { data, error } = await supabase.from('cartoes').select('*').eq('id', id).maybeSingle()
  if (error) throw error
  return data
}

/** Cria (sem id) ou atualiza (com id) um cartão */
export async function salvarCartao(dados: NovoCartao, id?: string) {
  const consulta = id
    ? supabase.from('cartoes').update(dados).eq('id', id).select().single()
    : supabase.from('cartoes').insert(dados).select().single()
  const { data, error } = await consulta
  if (error) {
    console.error(error)
    throw new Error('Não foi possível salvar o cartão. Tente de novo.')
  }
  return data
}

/**
 * Total (em centavos) da fatura atual de cada cartão: a que recebe as compras de hoje.
 * Chave: id do cartão.
 */
export async function totaisDasFaturasAtuais(cartoes: Cartao[], hoje = new Date()) {
  const faturaDe = new Map(cartoes.map((c) => [c.id, paraISO(mesDaFatura(hoje, c.dia_fechamento, c.dia_vencimento))]))
  const totais = new Map(cartoes.map((c) => [c.id, 0]))
  if (cartoes.length === 0) return { totais, faturaDe }

  const { data, error } = await supabase
    .from('transacoes')
    .select('cartao_id, fatura, valor, tipo')
    .in('cartao_id', cartoes.map((c) => c.id))
    .in('fatura', [...new Set(faturaDe.values())])
  if (error) throw error
  for (const t of data) {
    if (!t.cartao_id || t.fatura !== faturaDe.get(t.cartao_id)) continue
    totais.set(t.cartao_id, (totais.get(t.cartao_id) ?? 0) + Math.round(t.valor * 100) * (t.tipo === 'despesa' ? 1 : -1))
  }
  return { totais, faturaDe }
}

/**
 * Limite usado por cartão. Cartão ligado ao Open Finance usa o que o banco informa (já conta parcelas
 * futuras e compras que o banco ainda não publicou); os outros somam as compras em faturas não pagas.
 */
export async function buscarLimitesUsados() {
  const [somados, vinculados, doBanco] = await Promise.all([
    supabase.rpc('limite_usado_cartoes'),
    supabase.from('cartoes').select('id, pluggy_account_id').not('pluggy_account_id', 'is', null),
    supabase.from('pluggy_contas').select('id, saldo').eq('tipo', 'CREDIT').not('saldo', 'is', null),
  ])
  for (const r of [somados, vinculados, doBanco]) if (r.error) throw r.error

  const usados = new Map(somados.data!.map((linha) => [linha.cartao_id, Number(linha.usado)]))
  const saldoDoBanco = new Map(doBanco.data!.map((c) => [c.id, Number(c.saldo)]))
  for (const c of vinculados.data!) {
    const saldo = saldoDoBanco.get(c.pluggy_account_id!)
    if (saldo !== undefined) usados.set(c.id, saldo)
  }
  return usados
}
