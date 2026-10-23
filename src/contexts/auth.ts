import { createContext } from 'react'
import type { Session, User } from '@supabase/supabase-js'

export type EstadoAuth = {
  sessao: Session | null
  usuario: User | null
  carregando: boolean
}

export const AuthContext = createContext<EstadoAuth | null>(null)
