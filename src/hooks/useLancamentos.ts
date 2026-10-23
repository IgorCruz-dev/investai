import { useContext } from 'react'
import { LancamentosContext } from '../contexts/lancamentos'

export function useLancamentos() {
  const controle = useContext(LancamentosContext)
  if (!controle) throw new Error('useLancamentos precisa estar dentro do AppLayout')
  return controle
}
