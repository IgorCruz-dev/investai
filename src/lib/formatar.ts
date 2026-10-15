const moeda = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })
const mesAno = new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric' })

/** 1234.5 → "R$ 1.234,50" */
export function formatarMoeda(valor: number) {
  return moeda.format(valor)
}

/** Data → "Outubro de 2026" */
export function formatarMesAno(data: Date) {
  const texto = mesAno.format(data)
  return texto.charAt(0).toUpperCase() + texto.slice(1)
}
