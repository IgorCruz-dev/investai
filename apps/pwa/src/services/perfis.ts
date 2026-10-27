import { supabase } from '../lib/supabase'

export async function buscarPerfil(id: string) {
  const { data, error } = await supabase.from('perfis').select('*').eq('id', id).single()
  if (error) throw error
  return data
}
