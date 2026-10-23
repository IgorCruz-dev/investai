import { createClient } from '@supabase/supabase-js'
import type { Database } from '../types/database'

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

/** false quando faltam as variáveis do .env.local; o main.tsx mostra um aviso em vez do app. */
export const supabaseConfigurado = Boolean(url && anonKey)

// Valores de mentira só para não quebrar o import; sem configuração o app nem chega a usar o cliente
export const supabase = createClient<Database>(url || 'http://localhost', anonKey || 'chave-ausente')
