import type { Cartao, Conta, Transacao } from '../types/financas'

/** Nome e cores (degradê do site) da empresa dona das contas e cartões marcados como "da empresa" */
export const EMPRESA = { nome: 'Empresa', de: '#6366F1', para: '#3B82F6' }

/**
 * Separa os lançamentos da empresa (feitos numa conta ou num cartão da empresa) dos pessoais.
 * Lançamento sem conta nem cartão conta como pessoal.
 */
export function separarDaEmpresa(transacoes: Transacao[], contas: Conta[], cartoes: Cartao[]) {
  const contasDaEmpresa = new Set(contas.filter((c) => c.empresarial).map((c) => c.id))
  const cartoesDaEmpresa = new Set(cartoes.filter((c) => c.empresarial).map((c) => c.id))
  const pessoais: Transacao[] = []
  const daEmpresa: Transacao[] = []
  for (const t of transacoes) {
    const ehDaEmpresa =
      (t.conta_id !== null && contasDaEmpresa.has(t.conta_id)) || (t.cartao_id !== null && cartoesDaEmpresa.has(t.cartao_id))
    ;(ehDaEmpresa ? daEmpresa : pessoais).push(t)
  }
  return { pessoais, daEmpresa }
}
