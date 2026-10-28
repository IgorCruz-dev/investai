import { supabase } from '../lib/supabase'

export async function listarContas() {
  const { data, error } = await supabase.from('contas').select('*').order('nome')
  if (error) throw error
  return data
}

/** Conta da empresa fica fora do saldo e do resumo pessoal */
export async function marcarContaEmpresarial(id: string, empresarial: boolean) {
  const { error } = await supabase.from('contas').update({ empresarial }).eq('id', id)
  if (error) throw new Error('Não foi possível salvar a conta.')
}
