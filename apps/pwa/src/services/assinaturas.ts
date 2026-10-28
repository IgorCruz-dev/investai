import { supabase } from '../lib/supabase'
import type { NovaAssinatura } from '../types/financas'

export async function listarAssinaturas() {
  const { data, error } = await supabase.from('assinaturas').select('*').order('dia_cobranca').order('nome')
  if (error) throw error
  return data
}

/** Cria (sem id) ou atualiza (com id) uma assinatura */
export async function salvarAssinatura(
  dados: Partial<NovaAssinatura> & Pick<NovaAssinatura, 'nome' | 'valor' | 'dia_cobranca'>,
  id?: string,
) {
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

/** Quantas cobranças já estão ligadas a cada assinatura (para saber em que parcela está) */
export async function contarCobrancas() {
  const { data, error } = await supabase.from('transacoes').select('assinatura_id').not('assinatura_id', 'is', null)
  if (error) throw error
  const contagem = new Map<string, number>()
  for (const t of data) if (t.assinatura_id) contagem.set(t.assinatura_id, (contagem.get(t.assinatura_id) ?? 0) + 1)
  return contagem
}

/** Datas ("2026-10-13") das cobranças ligadas a cada assinatura, da mais antiga para a mais nova */
export async function datasDasCobrancas() {
  const { data, error } = await supabase
    .from('transacoes')
    .select('assinatura_id, data')
    .not('assinatura_id', 'is', null)
    .order('data')
  if (error) throw error
  const datas = new Map<string, string[]>()
  for (const t of data) if (t.assinatura_id) datas.set(t.assinatura_id, [...(datas.get(t.assinatura_id) ?? []), t.data])
  return datas
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
