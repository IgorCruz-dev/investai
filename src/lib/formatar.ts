import { deISO, hojeISO, paraISO } from './datas'

const moeda = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })
const mesAno = new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric' })
const diaComSemana = new Intl.DateTimeFormat('pt-BR', { weekday: 'short', day: 'numeric', month: 'short' })

/** 1234.5 → "R$ 1.234,50" */
export function formatarMoeda(valor: number) {
  return moeda.format(valor)
}

/** Data → "Outubro de 2026" */
export function formatarMesAno(data: Date) {
  const texto = mesAno.format(data)
  return texto.charAt(0).toUpperCase() + texto.slice(1)
}

const moedaCompacta = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
  notation: 'compact',
  maximumFractionDigits: 1,
})
const nomeDoMes = new Intl.DateTimeFormat('pt-BR', { month: 'long' })

/** 1250 → "R$ 1,3 mil" (para eixos de gráfico) */
export function formatarMoedaCompacta(valor: number) {
  return moedaCompacta.format(valor)
}

/** Data → "setembro" */
export function formatarNomeDoMes(data: Date) {
  return nomeDoMes.format(data)
}

const diaMes = new Intl.DateTimeFormat('pt-BR', { day: 'numeric', month: 'short' })

/** Date ou "2026-10-23" → "23 de out" */
export function formatarDiaMes(data: Date | string) {
  return diaMes.format(typeof data === 'string' ? deISO(data) : data).replace(/\.$/, '')
}

/** "2026-10-23" → "Hoje", "Ontem" ou "qui., 23 de out." */
export function formatarDia(iso: string) {
  if (iso === hojeISO()) return 'Hoje'
  const ontem = new Date()
  ontem.setDate(ontem.getDate() - 1)
  if (iso === paraISO(ontem)) return 'Ontem'
  const texto = diaComSemana.format(deISO(iso))
  return texto.charAt(0).toUpperCase() + texto.slice(1)
}

const hora = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' })

/** "2026-10-23T21:02:00Z" → "hoje às 18:02", "ontem às 18:02" ou "20 de out às 18:02" */
export function formatarDataHora(iso: string) {
  const data = new Date(iso)
  const dia = paraISO(data)
  const ontem = new Date()
  ontem.setDate(ontem.getDate() - 1)
  const quando = dia === hojeISO() ? 'hoje' : dia === paraISO(ontem) ? 'ontem' : formatarDiaMes(data)
  return `${quando} às ${hora.format(data)}`
}
