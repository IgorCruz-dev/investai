import { deISO, inicioDoMes } from './datas'
import type { Assinatura } from '../types/financas'

/** Dia da cobrança num mês; se o mês for mais curto (ex.: dia 31 em abril), usa o último dia */
export function dataDeCobranca(mes: Date, diaCobranca: number) {
  const ultimoDia = new Date(mes.getFullYear(), mes.getMonth() + 1, 0).getDate()
  return new Date(mes.getFullYear(), mes.getMonth(), Math.min(diaCobranca, ultimoDia))
}

function semHora(data: Date) {
  return new Date(data.getFullYear(), data.getMonth(), data.getDate())
}

/** A cobrança deste mês já foi lançada? (mesma regra da função lancar_assinaturas_pendentes) */
export function jaLancadaNoMes(assinatura: Pick<Assinatura, 'ultimo_lancamento'>, hoje = new Date()) {
  return assinatura.ultimo_lancamento !== null && deISO(assinatura.ultimo_lancamento) >= inicioDoMes(hoje)
}

/** Próxima cobrança ainda não lançada: a deste mês, se ainda não passou; senão a do mês que vem */
export function proximaCobranca(assinatura: Assinatura, hoje = new Date()) {
  const deste = dataDeCobranca(hoje, assinatura.dia_cobranca)
  if (!jaLancadaNoMes(assinatura, hoje) && deste >= semHora(hoje)) return deste
  return dataDeCobranca(new Date(hoje.getFullYear(), hoje.getMonth() + 1, 1), assinatura.dia_cobranca)
}

/** Dias inteiros de hoje até a data (0 = hoje) */
export function diasAte(data: Date, hoje = new Date()) {
  return Math.round((semHora(data).getTime() - semHora(hoje).getTime()) / 86_400_000)
}

export function textoDiasAte(dias: number) {
  if (dias <= 0) return 'Cobra hoje'
  if (dias === 1) return 'Cobra amanhã'
  return `Cobra em ${dias} dias`
}
