import { createContext } from 'react'
import type { FormaPagamento, Transacao } from '../types/financas'

/** Valores já preenchidos ao abrir um lançamento novo (ex.: compra num cartão específico) */
export type PadraoLancamento = { forma?: FormaPagamento; cartaoId?: string }

export type ControleLancamentos = {
  /** Abre o modal de novo lançamento */
  novoLancamento: (padrao?: PadraoLancamento) => void
  /** Abre o modal para editar um lançamento; com excluir: true, já abre a confirmação de exclusão */
  editarLancamento: (transacao: Transacao, opcoes?: { excluir?: boolean }) => void
  /** Muda a cada lançamento salvo ou excluído; as telas usam para recarregar os dados */
  versao: number
  /** Faz as telas recarregarem (ex.: depois de sincronizar com o banco) */
  recarregar: () => void
}

export const LancamentosContext = createContext<ControleLancamentos | null>(null)
