import { AuthError } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'

export async function cadastroDisponivel() {
  const { data, error } = await supabase.rpc('cadastro_disponivel')
  if (error) throw error
  return data
}

export async function entrar(email: string, senha: string) {
  const { error } = await supabase.auth.signInWithPassword({ email, password: senha })
  if (error) throw new Error(traduzirErro(error))
}

/** Retorna true se a conta já está ativa, false se precisa confirmar pelo e-mail. */
export async function cadastrar(nome: string, email: string, senha: string) {
  const { data, error } = await supabase.auth.signUp({
    email,
    password: senha,
    options: {
      data: { nome },
      // O link do e-mail de confirmação volta para o app (precisa estar em Authentication > URL Configuration)
      emailRedirectTo: `${window.location.origin}/login`,
    },
  })
  if (error) throw new Error(traduzirErro(error))
  return data.session !== null
}

export async function sair() {
  await supabase.auth.signOut()
}

function traduzirErro(error: AuthError) {
  switch (error.code) {
    case 'invalid_credentials':
      return 'E-mail ou senha incorretos.'
    case 'email_not_confirmed':
      return 'Confirme seu e-mail antes de entrar. Veja sua caixa de entrada.'
    case 'user_already_exists':
    case 'email_exists':
      return 'Já existe uma conta com este e-mail.'
    case 'weak_password':
      return 'Senha fraca. Use pelo menos 6 caracteres.'
    case 'email_address_invalid':
      return 'E-mail inválido.'
    case 'over_email_send_rate_limit':
    case 'over_request_rate_limit':
      return 'Muitas tentativas. Aguarde um pouco e tente de novo.'
    default:
      return 'Algo deu errado. Tente novamente.'
  }
}
