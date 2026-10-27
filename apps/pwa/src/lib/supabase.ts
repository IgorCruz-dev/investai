import { createClient } from '@supabase/supabase-js'
import type { Database } from '../types/database'

const url = import.meta.env.VITE_SUPABASE_URL

/**
 * Chave publicável (sb_publishable_…) com a anônima como reserva: a Supabase
 * recomenda a publicável para projeto novo, porque ela gira sozinha, mas
 * projeto antigo só tem a anônima.
 *
 * As duas são públicas de propósito — elas vão para o navegador no build. O que
 * protege os dados é o RLS, não o segredo da chave.
 */
const chavePublica =
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY

/** false quando faltam as variáveis do .env.local; o main.tsx mostra um aviso em vez do app. */
export const supabaseConfigurado = Boolean(url && chavePublica)

// Valores de mentira só para não quebrar o import; sem configuração o app nem chega a usar o cliente
export const supabase = createClient<Database>(
  url || 'http://localhost',
  chavePublica || 'chave-ausente',
)
