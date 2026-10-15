import { supabase } from '../lib/supabase'
import type { Perfil } from '../types/perfil'

export async function buscarPerfil(id: string) {
  const { data, error } = await supabase.from('perfis').select('*').eq('id', id).single<Perfil>()
  if (error) throw error
  return data
}
