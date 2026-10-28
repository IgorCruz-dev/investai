/**
 * Fatura em que cai uma compra no crédito, como dia 1 do mês de VENCIMENTO.
 * - Compras a partir do dia do fechamento entram na fatura seguinte.
 * - Se o vencimento é no mesmo dia ou antes do fechamento, a fatura vence no mês seguinte ao fechamento.
 * - Fechamento em dia que o mês não tem (ex.: 31 em fevereiro) vira o último dia do mês.
 */
export function mesDaFatura(dataCompra: Date, diaFechamento: number, diaVencimento: number) {
  const ultimoDia = new Date(dataCompra.getFullYear(), dataCompra.getMonth() + 1, 0).getDate()
  const fechamento = Math.min(diaFechamento, ultimoDia)
  const mesDoFechamento = dataCompra.getDate() >= fechamento ? 1 : 0
  const mesDoVencimento = mesDoFechamento + (diaVencimento <= diaFechamento ? 1 : 0)
  return new Date(dataCompra.getFullYear(), dataCompra.getMonth() + mesDoVencimento, 1)
}

const ultimoDiaDoMes = (ano: number, mes: number) => new Date(ano, mes + 1, 0).getDate()

/**
 * Datas de uma fatura (identificada pelo dia 1 do mês de vencimento), coerentes com mesDaFatura:
 * fecha no dia do fechamento; compras até o dia anterior entram nela.
 */
export function datasDaFatura(fatura: Date, diaFechamento: number, diaVencimento: number) {
  const ano = fatura.getFullYear()
  const mes = fatura.getMonth()
  const vencimento = new Date(ano, mes, Math.min(diaVencimento, ultimoDiaDoMes(ano, mes)))
  const mesFechamento = new Date(ano, mes - (diaVencimento <= diaFechamento ? 1 : 0), 1)
  const fechamento = new Date(
    mesFechamento.getFullYear(),
    mesFechamento.getMonth(),
    Math.min(diaFechamento, ultimoDiaDoMes(mesFechamento.getFullYear(), mesFechamento.getMonth())),
  )
  const ultimoDiaDeCompras = new Date(fechamento.getFullYear(), fechamento.getMonth(), fechamento.getDate() - 1)
  return { fechamento, vencimento, ultimoDiaDeCompras }
}

export type StatusFatura = 'aberta' | 'fechada' | 'parcial' | 'paga'

/**
 * Paga quando os pagamentos somam o valor da fatura; paga em parte quando somam menos;
 * sem pagamento, fechada a partir do dia do fechamento e, antes disso, em aberto.
 */
export function statusDaFatura(fechamento: Date, pagoCentavos: number, totalCentavos: number, hoje = new Date()): StatusFatura {
  if (pagoCentavos > 0) return pagoCentavos >= totalCentavos ? 'paga' : 'parcial'
  const hojeSemHora = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate())
  return hojeSemHora >= fechamento ? 'fechada' : 'aberta'
}

/** Divide um total (em centavos) em parcelas iguais; o centavo que sobra vai na primeira. 10000 em 3 → [3334, 3333, 3333] */
export function dividirEmParcelas(totalCentavos: number, parcelas: number) {
  const base = Math.floor(totalCentavos / parcelas)
  const resto = totalCentavos - base * parcelas
  return Array.from({ length: parcelas }, (_, i) => (i === 0 ? base + resto : base))
}
