import { paraISO } from '../lib/datas'
import { supabase } from '../lib/supabase'
import type { AcertoPago } from '../types/financas'

/** Meses que as pessoas acertaram por fora (sem lançamento), de todas elas */
export async function listarAcertosPagos() {
  const { data, error } = await supabase.from('acertos_pagos').select('*')
  if (error) throw error
  return data as AcertoPago[]
}

/** Marca o mês da pessoa como acertado: o que faltava nele deixa de ser cobrado */
export async function marcarMesPago(pessoa: string, mes: Date) {
  const { error } = await supabase.from('acertos_pagos').insert({ pessoa, mes: paraISO(mes) })
  if (error) {
    console.error(error)
    throw new Error('Não foi possível marcar o mês como acertado. Tente de novo.')
  }
}

/** Volta a cobrar o mês */
export async function desmarcarMesPago(pessoa: string, mes: Date) {
  const { error } = await supabase.from('acertos_pagos').delete().eq('pessoa', pessoa).eq('mes', paraISO(mes))
  if (error) {
    console.error(error)
    throw new Error('Não foi possível desfazer. Tente de novo.')
  }
}
