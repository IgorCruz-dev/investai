import { supabase } from '../lib/supabase'
import type { NovaReceitaPrevista } from '../types/financas'

/** O que costuma entrar todo mês (salário, vale...): conta no resultado do mês até a receita de verdade chegar */
export async function listarReceitasPrevistas() {
  const { data, error } = await supabase.from('receitas_previstas').select('*').order('dia').order('nome')
  if (error) throw error
  return data
}

/** Cria (sem id) ou atualiza (com id) uma receita prevista */
export async function salvarReceitaPrevista(dados: NovaReceitaPrevista, id?: string) {
  const consulta = id
    ? supabase.from('receitas_previstas').update(dados).eq('id', id).select().single()
    : supabase.from('receitas_previstas').insert(dados).select().single()
  const { data, error } = await consulta
  if (error) {
    console.error(error)
    throw new Error('Não foi possível salvar a receita prevista. Tente de novo.')
  }
  return data
}

export async function excluirReceitaPrevista(id: string) {
  const { error } = await supabase.from('receitas_previstas').delete().eq('id', id)
  if (error) throw new Error('Não foi possível excluir a receita prevista.')
}
