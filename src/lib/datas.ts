/** Primeiro dia do mês da data informada (hoje, se nada for passado) */
export function inicioDoMes(data = new Date()) {
  return new Date(data.getFullYear(), data.getMonth(), 1)
}

/** Date → "2026-10-23", usando a data local (sem conversão de fuso) */
export function paraISO(data: Date) {
  const mes = String(data.getMonth() + 1).padStart(2, '0')
  const dia = String(data.getDate()).padStart(2, '0')
  return `${data.getFullYear()}-${mes}-${dia}`
}

/** "2026-10-23" → Date local à meia-noite */
export function deISO(iso: string) {
  const [ano, mes, dia] = iso.split('-').map(Number)
  return new Date(ano, mes - 1, dia)
}

export function hojeISO() {
  return paraISO(new Date())
}

/** Soma meses mantendo o dia; se o mês de destino não tiver esse dia, usa o último (31/01 + 1 → 28/02) */
export function somarMeses(data: Date, meses: number) {
  const alvo = new Date(data.getFullYear(), data.getMonth() + meses, 1)
  const ultimoDia = new Date(alvo.getFullYear(), alvo.getMonth() + 1, 0).getDate()
  alvo.setDate(Math.min(data.getDate(), ultimoDia))
  return alvo
}

export function diasNoMes(mes: Date) {
  return new Date(mes.getFullYear(), mes.getMonth() + 1, 0).getDate()
}

export function mesAnterior(mes: Date) {
  return new Date(mes.getFullYear(), mes.getMonth() - 1, 1)
}

/** Date → "2026-10" (para usar na URL) */
export function paraMesISO(mes: Date) {
  return paraISO(mes).slice(0, 7)
}

/** "2026-10" → primeiro dia do mês; null se o texto não for um mês válido */
export function deMesISO(texto: string | null) {
  const partes = texto?.match(/^(\d{4})-(\d{2})$/)
  if (!partes) return null
  const mes = Number(partes[2])
  if (mes < 1 || mes > 12) return null
  return new Date(Number(partes[1]), mes - 1, 1)
}

/** Primeiro e último dia do mês, em ISO, para filtrar consultas */
export function intervaloDoMes(mes: Date): [string, string] {
  const inicio = new Date(mes.getFullYear(), mes.getMonth(), 1)
  const fim = new Date(mes.getFullYear(), mes.getMonth() + 1, 0)
  return [paraISO(inicio), paraISO(fim)]
}
