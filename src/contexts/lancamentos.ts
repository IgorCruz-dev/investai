import { createContext } from 'react'
import type { Transacao } from '../types/financas'

export type ControleLancamentos = {
  /** Abre o modal de novo lançamento */
  novoLancamento: () => void
  /** Abre o modal para editar/excluir um lançamento */
  editarLancamento: (transacao: Transacao) => void
  /** Muda a cada lançamento salvo ou excluído; as telas usam para recarregar os dados */
  versao: number
}

export const LancamentosContext = createContext<ControleLancamentos | null>(null)
