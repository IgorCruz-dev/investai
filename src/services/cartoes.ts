import { supabase } from '../lib/supabase'
import type { NovoCartao } from '../types/financas'

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

/** Limite usado por cartão (compras em faturas ainda não pagas), calculado no banco */
export async function buscarLimitesUsados() {
  const { data, error } = await supabase.rpc('limite_usado_cartoes')
  if (error) throw error
  return new Map(data.map((linha) => [linha.cartao_id, Number(linha.usado)]))
}
