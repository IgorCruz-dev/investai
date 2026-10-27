import { supabase } from '../lib/supabase'

export async function listarCategorias() {
  const { data, error } = await supabase.from('categorias').select('*').order('nome')
  if (error) throw error
  return data
}

export async function criarCategoria(nome: string, cor: string) {
  const { data, error } = await supabase
    .from('categorias')
    .insert({ nome: nome.trim(), cor, icone: 'outros' })
    .select()
    .single()
  if (error) {
    if (error.code === '23505') throw new Error('Já existe uma categoria com esse nome.')
    throw new Error('Não foi possível criar a categoria.')
  }
  return data
}
