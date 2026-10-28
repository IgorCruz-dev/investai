import type { MovimentoCaixinha } from '../types/financas'

const centavos = (valor: number) => Math.round(valor * 100)
const sinal = (m: Pick<MovimentoCaixinha, 'tipo'>) => (m.tipo === 'deposito' ? 1 : -1)

/**
 * Ponto de partida do total: quanto já estava guardado em `desde` ("2026-09-27").
 * Movimentos anteriores a `desde` ficam no histórico, mas não entram no total.
 */
export type PartidaCaixinha = { saldoInicial: number; desde: string | null }

export const SEM_PARTIDA: PartidaCaixinha = { saldoInicial: 0, desde: null }

/** O movimento entra no total? (não entra quando é anterior à data de partida) */
export function entraNoTotal(m: Pick<MovimentoCaixinha, 'data'>, partida: PartidaCaixinha) {
  return !partida.desde || m.data >= partida.desde
}

/** Total guardado = saldo de partida + depósitos − retiradas a partir da data de partida */
export function totalGuardado(movimentos: MovimentoCaixinha[], partida = SEM_PARTIDA) {
  const soma = movimentos.reduce((s, m) => (entraNoTotal(m, partida) ? s + sinal(m) * centavos(m.valor) : s), 0)
  return (centavos(partida.saldoInicial) + soma) / 100
}

/** Saldo de partida que faz o total de hoje bater com `totalReal` (ex.: o que o banco mostra) */
export function saldoInicialPara(totalReal: number, movimentos: MovimentoCaixinha[], partida: PartidaCaixinha) {
  return (centavos(totalReal) - centavos(totalGuardado(movimentos, { ...partida, saldoInicial: 0 }))) / 100
}

export type PontoCaixinha = { mes: Date; total: number }

/** Total guardado no fim de cada mês, nos últimos `meses` meses até o mês de `ate` */
export function evolucaoMensal(movimentos: MovimentoCaixinha[], meses = 12, ate = new Date(), partida = SEM_PARTIDA): PontoCaixinha[] {
  const primeiro = new Date(ate.getFullYear(), ate.getMonth() - (meses - 1), 1)
  const chave = (d: Date) => d.getFullYear() * 12 + d.getMonth()

  // Tudo o que veio antes da janela (e o saldo de partida) já entra como saldo inicial
  let acumulado = centavos(partida.saldoInicial)
  const porMes = new Map<number, number>()
  for (const m of movimentos) {
    if (!entraNoTotal(m, partida)) continue
    const [ano, mes] = m.data.split('-').map(Number)
    const k = ano * 12 + (mes - 1)
    const valor = sinal(m) * centavos(m.valor)
    if (k < chave(primeiro)) acumulado += valor
    else porMes.set(k, (porMes.get(k) ?? 0) + valor)
  }

  return Array.from({ length: meses }, (_, i) => {
    const mes = new Date(primeiro.getFullYear(), primeiro.getMonth() + i, 1)
    acumulado += porMes.get(chave(mes)) ?? 0
    return { mes, total: acumulado / 100 }
  })
}
