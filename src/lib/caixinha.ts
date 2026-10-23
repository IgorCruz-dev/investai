import type { MovimentoCaixinha } from '../types/financas'

const centavos = (valor: number) => Math.round(valor * 100)
const sinal = (m: Pick<MovimentoCaixinha, 'tipo'>) => (m.tipo === 'deposito' ? 1 : -1)

/** Total guardado = depósitos − retiradas */
export function totalGuardado(movimentos: MovimentoCaixinha[]) {
  return movimentos.reduce((soma, m) => soma + sinal(m) * centavos(m.valor), 0) / 100
}

export type PontoCaixinha = { mes: Date; total: number }

/** Total guardado no fim de cada mês, nos últimos `meses` meses até o mês de `ate` */
export function evolucaoMensal(movimentos: MovimentoCaixinha[], meses = 12, ate = new Date()): PontoCaixinha[] {
  const primeiro = new Date(ate.getFullYear(), ate.getMonth() - (meses - 1), 1)
  const chave = (d: Date) => d.getFullYear() * 12 + d.getMonth()

  // Tudo o que veio antes da janela já entra como saldo inicial
  let acumulado = 0
  const porMes = new Map<number, number>()
  for (const m of movimentos) {
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
