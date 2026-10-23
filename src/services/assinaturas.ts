import { supabase } from '../lib/supabase'
import type { NovaAssinatura } from '../types/financas'

export async function listarAssinaturas() {
  const { data, error } = await supabase.from('assinaturas').select('*').order('dia_cobranca').order('nome')
  if (error) throw error
  return data
}

/** Cria (sem id) ou atualiza (com id) uma assinatura */
export async function salvarAssinatura(dados: Partial<NovaAssinatura> & Pick<NovaAssinatura, 'nome' | 'valor' | 'dia_cobranca'>, id?: string) {
  const consulta = id
    ? supabase.from('assinaturas').update(dados).eq('id', id).select().single()
    : supabase.from('assinaturas').insert(dados).select().single()
  const { data, error } = await consulta
  if (error) {
    console.error(error)
    throw new Error('Não foi possível salvar a assinatura. Tente de novo.')
  }
  return data
}

/** Pausar (false) ou retomar (true) */
export async function definirAtiva(id: string, ativa: boolean) {
  const { error } = await supabase.from('assinaturas').update({ ativa }).eq('id', id)
  if (error) throw new Error('Não foi possível atualizar a assinatura.')
}

/** Exclui a assinatura; as cobranças já lançadas continuam no histórico */
export async function excluirAssinatura(id: string) {
  const { error } = await supabase.from('assinaturas').delete().eq('id', id)
  if (error) throw new Error('Não foi possível excluir a assinatura.')
}

/** Lança no banco as cobranças do mês que já chegaram; devolve quantas lançou (nunca duplica) */
export async function lancarAssinaturasPendentes() {
  const { data, error } = await supabase.rpc('lancar_assinaturas_pendentes')
  if (error) throw error
  return data
}
