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

/** Divide um total (em centavos) em parcelas iguais; o centavo que sobra vai na primeira. 10000 em 3 → [3334, 3333, 3333] */
export function dividirEmParcelas(totalCentavos: number, parcelas: number) {
  const base = Math.floor(totalCentavos / parcelas)
  const resto = totalCentavos - base * parcelas
  return Array.from({ length: parcelas }, (_, i) => (i === 0 ? base + resto : base))
}
