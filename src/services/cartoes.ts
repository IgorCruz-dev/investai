import { supabase } from '../lib/supabase'

export async function listarCartoes() {
  const { data, error } = await supabase.from('cartoes').select('*').order('nome')
  if (error) throw error
  return data
}
