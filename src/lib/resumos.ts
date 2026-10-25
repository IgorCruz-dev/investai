import { diasNoMes, hojeISO, mesAnterior, paraISO } from './datas'
import type { Transacao } from '../types/financas'

/** Ponto do gráfico de gastos acumulados; null = sem linha naquele dia */
export type PontoGasto = { dia: number; atual: number | null; anterior: number | null }

export type GastoCategoria = {
  /** id da categoria ou 'sem' para lançamentos sem categoria */
  chave: string
  atual: number
  anterior: number
}

const centavos = (valor: number) => Math.round(valor * 100)

/**
 * Pagamento de fatura não é gasto novo: as compras já contaram quando foram feitas no crédito.
 * Ele só desconta do saldo; fica fora de despesas, categorias e gráficos.
 */
export function ehPagamentoDeFatura(t: Pick<Transacao, 'pagamento_cartao_id'>) {
  return t.pagamento_cartao_id !== null
}

/** Transferência entre as próprias contas: mexe no saldo de cada conta, mas não é receita nem gasto */
export function ehTransferencia(t: Pick<Transacao, 'transferencia_interna'>) {
  return t.transferencia_interna
}

/** Despesa que conta como gasto (todas as formas, inclusive crédito, menos pagamento de fatura e transferência) */
export function ehGasto(t: Transacao) {
  return t.tipo === 'despesa' && !ehPagamentoDeFatura(t) && !ehTransferencia(t)
}

/** Crédito lançado no cartão (estorno, crédito de rotativo): abate a fatura, não é dinheiro que entrou */
export function ehCreditoNoCartao(t: Pick<Transacao, 'tipo' | 'forma'>) {
  return t.tipo === 'receita' && t.forma === 'credito'
}

/** Receita de verdade (transferência entre as próprias contas e crédito no cartão não contam) */
export function ehReceita(t: Transacao) {
  return t.tipo === 'receita' && !ehTransferencia(t) && !ehCreditoNoCartao(t)
}

/** Quanto o lançamento soma aos gastos, em centavos: crédito no cartão desconta; o que não é gasto vale 0 */
export function gastoEmCentavos(t: Transacao) {
  if (ehGasto(t)) return centavos(t.valor)
  if (ehCreditoNoCartao(t)) return -centavos(t.valor)
  return 0
}

function despesasPorDia(transacoes: Transacao[]) {
  const porDia = new Map<number, number>()
  for (const t of transacoes) {
    const gasto = gastoEmCentavos(t)
    if (!gasto) continue
    const dia = Number(t.data.slice(8, 10))
    porDia.set(dia, (porDia.get(dia) ?? 0) + gasto)
  }
  return porDia
}

/**
 * Gastos (despesas de todas as formas, inclusive crédito) somados dia a dia.
 * No mês corrente a linha para em hoje; a do mês anterior vai até o último dia dele.
 */
export function gastosAcumuladosPorDia(doMes: Transacao[], doMesAnterior: Transacao[], mes: Date): PontoGasto[] {
  const totalDias = diasNoMes(mes)
  const diasAnterior = diasNoMes(mesAnterior(mes))
  const hoje = hojeISO()
  const ultimoDiaComLinha = hoje.slice(0, 7) === paraISO(mes).slice(0, 7) ? Number(hoje.slice(8, 10)) : totalDias

  const atual = despesasPorDia(doMes)
  const anterior = despesasPorDia(doMesAnterior)
  let somaAtual = 0
  let somaAnterior = 0

  return Array.from({ length: totalDias }, (_, i) => {
    const dia = i + 1
    somaAtual += atual.get(dia) ?? 0
    somaAnterior += anterior.get(dia) ?? 0
    return {
      dia,
      atual: dia <= ultimoDiaComLinha ? somaAtual / 100 : null,
      anterior: dia <= diasAnterior ? somaAnterior / 100 : null,
    }
  })
}

/** Despesas por categoria no mês e no anterior, da maior para a menor no mês */
export function gastosPorCategoria(doMes: Transacao[], doMesAnterior: Transacao[]): GastoCategoria[] {
  const somas = new Map<string, { atual: number; anterior: number }>()
  const somar = (lista: Transacao[], campo: 'atual' | 'anterior') => {
    for (const t of lista) {
      const gasto = gastoEmCentavos(t)
      if (!gasto) continue
      const chave = t.categoria_id ?? 'sem'
      const soma = somas.get(chave) ?? { atual: 0, anterior: 0 }
      soma[campo] += gasto
      somas.set(chave, soma)
    }
  }
  somar(doMes, 'atual')
  somar(doMesAnterior, 'anterior')

  return [...somas.entries()]
    .filter(([, s]) => s.atual > 0)
    .map(([chave, s]) => ({ chave, atual: s.atual / 100, anterior: s.anterior / 100 }))
    .sort((a, b) => b.atual - a.atual)
}

/** Variação percentual arredondada; null quando não havia gasto no mês anterior */
export function variacaoPercentual(atual: number, anterior: number) {
  if (anterior === 0) return null
  return Math.round(((atual - anterior) / anterior) * 100)
}
