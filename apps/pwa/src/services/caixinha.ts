import { supabase } from '../lib/supabase'
import type { MovimentoCaixinha } from '../types/financas'

export async function listarMovimentos() {
  const { data, error } = await supabase
    .from('caixinha_movimentos')
    .select('*')
    .order('data', { ascending: false })
    .order('criado_em', { ascending: false })
  if (error) throw error
  return data as MovimentoCaixinha[]
}

function erroAoSalvar(error: { message: string }) {
  console.error(error)
  // A regra do banco recusa qualquer movimento que deixe a caixinha negativa
  if (error.message.includes('caixinha insuficiente')) return new Error('Você não tem tudo isso guardado na caixinha.')
  return new Error('Não foi possível salvar. Tente de novo.')
}

/** Guardar: sai do saldo da conta e entra na caixinha */
export async function guardar(valorCentavos: number, data: string) {
  const { error } = await supabase.from('caixinha_movimentos').insert({ tipo: 'deposito', valor: valorCentavos / 100, data })
  if (error) throw erroAoSalvar(error)
}

/** Retirar: sai da caixinha e volta para o saldo da conta (motivo obrigatório) */
export async function retirar(valorCentavos: number, motivo: string, data: string) {
  const { error } = await supabase
    .from('caixinha_movimentos')
    .insert({ tipo: 'retirada', valor: valorCentavos / 100, motivo: motivo.trim(), data })
  if (error) throw erroAoSalvar(error)
}

export async function buscarMeta(usuarioId: string) {
  const { data, error } = await supabase.from('perfis').select('meta_caixinha').eq('id', usuarioId).maybeSingle()
  if (error) throw error
  return data?.meta_caixinha ?? null
}

/** Define a meta (null remove) */
export async function definirMeta(usuarioId: string, valor: number | null) {
  const { error } = await supabase.from('perfis').update({ meta_caixinha: valor }).eq('id', usuarioId)
  if (error) throw new Error('Não foi possível salvar a meta.')
}
