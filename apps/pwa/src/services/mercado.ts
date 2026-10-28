import { supabase } from '../lib/supabase'
import { hojeISO, paraISO } from '../lib/datas'

export type Serie = 'selic_meta' | 'cdi_anual' | 'ipca_mes' | 'ipca_12m' | 'dolar'
export type Ponto = { dia: string; valor: number }

/** Valor de hoje (último publicado) e de ~30 dias antes, para a variação */
export type Indicador = { atual: Ponto; antes: Ponto | null }

/** Mediana do Focus para o fim do ano, na coleta mais recente */
export type Expectativa = { indicador: string; ano: number; mediana: number; coleta: string }

export type Mercado = {
  indicadores: Partial<Record<Serie, Indicador>>
  /** Dólar dos últimos ~22 meses: o gráfico mostra 12, o resto é para a média de 200 dias úteis já começar cheia */
  dolar: Ponto[]
  expectativas: Expectativa[]
  /** Quando a última série foi gravada */
  atualizadoEm: string | null
}

const SERIES: Serie[] = ['selic_meta', 'cdi_anual', 'ipca_12m', 'ipca_mes']
const HORAS_PARA_FICAR_VELHO = 26

function diasAtras(dias: number) {
  const d = new Date()
  d.setDate(d.getDate() - dias)
  return paraISO(d)
}

async function ultimoAte(serie: Serie, ate: string) {
  const { data, error } = await supabase
    .from('indicadores')
    .select('dia, valor, gravado_em')
    .eq('serie', serie)
    .lte('dia', ate)
    .order('dia', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw error
  return data
}

export async function buscarMercado(): Promise<Mercado> {
  const hoje = hojeISO()
  const mesPassado = diasAtras(30)

  const [series, dolar, focus] = await Promise.all([
    Promise.all(SERIES.map(async (s) => ({ s, atual: await ultimoAte(s, hoje), antes: await ultimoAte(s, mesPassado) }))),
    supabase.from('indicadores').select('dia, valor, gravado_em').eq('serie', 'dolar').gte('dia', diasAtras(680)).order('dia'),
    supabase
      .from('expectativas')
      .select('indicador, ano, mediana, data_coleta')
      .gte('data_coleta', diasAtras(21))
      .order('data_coleta', { ascending: false }),
  ])
  if (dolar.error) throw dolar.error
  if (focus.error) throw focus.error

  const indicadores: Mercado['indicadores'] = {}
  let atualizadoEm: string | null = null
  const marcar = (gravado: string) => {
    if (!atualizadoEm || gravado > atualizadoEm) atualizadoEm = gravado
  }
  for (const { s, atual, antes } of series) {
    if (!atual) continue
    marcar(atual.gravado_em)
    indicadores[s] = {
      atual: { dia: atual.dia, valor: Number(atual.valor) },
      antes: antes && antes.dia !== atual.dia ? { dia: antes.dia, valor: Number(antes.valor) } : null,
    }
  }
  const pontosDolar = dolar.data.map((p) => ({ dia: p.dia, valor: Number(p.valor) }))
  const ultimoDolar = dolar.data[dolar.data.length - 1]
  if (ultimoDolar) {
    marcar(ultimoDolar.gravado_em)
    const antes = [...pontosDolar].reverse().find((p) => p.dia <= mesPassado) ?? null
    indicadores.dolar = { atual: pontosDolar[pontosDolar.length - 1], antes }
  }

  // Só a coleta mais recente de cada indicador/ano
  const vistas = new Set<string>()
  const expectativas: Expectativa[] = []
  for (const e of focus.data) {
    const chave = `${e.indicador}|${e.ano}`
    if (vistas.has(chave)) continue
    vistas.add(chave)
    expectativas.push({ indicador: e.indicador, ano: e.ano, mediana: Number(e.mediana), coleta: e.data_coleta })
  }

  return { indicadores, dolar: pontosDolar, expectativas, atualizadoEm }
}

/** Dados com mais de um dia: pede para a função buscar de novo (ela mesma evita repetir) */
export function mercadoEstaVelho(m: Mercado) {
  return !m.atualizadoEm || Date.now() - Date.parse(m.atualizadoEm) > HORAS_PARA_FICAR_VELHO * 3_600_000
}

export async function atualizarMercado() {
  const { error } = await supabase.functions.invoke('mercado-sync', { body: {} })
  if (error) throw error
}

/** Média móvel simples dos últimos `janela` pontos (null enquanto não tem pontos suficientes) */
export function mediaMovel(pontos: Ponto[], janela: number) {
  let soma = 0
  return pontos.map((p, i) => {
    soma += p.valor
    if (i >= janela) soma -= pontos[i - janela].valor
    return i >= janela - 1 ? soma / janela : null
  })
}
