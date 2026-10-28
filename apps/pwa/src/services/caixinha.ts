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

/** Meta e ponto de partida do total guardado (ficam no perfil) */
export async function buscarConfigCaixinha(usuarioId: string) {
  const { data, error } = await supabase
    .from('perfis')
    .select('meta_caixinha, caixinha_saldo_inicial, caixinha_contar_desde')
    .eq('id', usuarioId)
    .maybeSingle()
  if (error) throw error
  return {
    meta: data?.meta_caixinha ?? null,
    partida: { saldoInicial: Number(data?.caixinha_saldo_inicial ?? 0), desde: data?.caixinha_contar_desde ?? null },
  }
}

/** Acerta o total guardado: muda só o saldo de partida (o saldo da conta não mexe) */
export async function definirPartida(usuarioId: string, saldoInicial: number, desde: string | null) {
  const { error } = await supabase
    .from('perfis')
    .update({ caixinha_saldo_inicial: saldoInicial, caixinha_contar_desde: desde })
    .eq('id', usuarioId)
  if (error) throw new Error('Não foi possível acertar o total.')
}

/** Define a meta (null remove) */
export async function definirMeta(usuarioId: string, valor: number | null) {
  const { error } = await supabase.from('perfis').update({ meta_caixinha: valor }).eq('id', usuarioId)
  if (error) throw new Error('Não foi possível salvar a meta.')
}
