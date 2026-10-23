import { useContext } from 'react'
import { AuthContext } from '../contexts/auth'

export function useAuth() {
  const estado = useContext(AuthContext)
  if (!estado) throw new Error('useAuth precisa estar dentro do <AuthProvider>')
  return estado
}
