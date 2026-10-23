import { supabase } from '../lib/supabase'

export async function listarContas() {
  const { data, error } = await supabase.from('contas').select('*').order('nome')
  if (error) throw error
  return data
}
