import { deISO, hojeISO, paraISO } from '../lib/datas'
import { supabase } from '../lib/supabase'
import type { Tables } from '../types/database'

export type Noticia = Tables<'noticias'> & {
  classificacao: { ativos: string[]; direcao: Direcao; prazo: string } | null
}
export type Sinal = Tables<'sinais'>
export type Tese = Tables<'teses'>
export type Direcao = 'alta' | 'baixa' | 'neutra'
export type GastoIA = { gasto: number; limite: number }

export const TEMAS: Record<string, string> = {
  cambio: 'Câmbio',
  juros: 'Juros',
  inflacao: 'Inflação',
  fiscal: 'Fiscal',
  politica: 'Política',
  bolsa: 'Bolsa',
  exterior: 'Exterior',
}

/** Teto do app sobre qualquer aposta tática, em % do patrimônio pessoal (regra fixa, não depende da IA) */
export const TETO_TATICO = 10
const LIMITE_PADRAO_USD = 2
const DIAS_DE_NOTICIAS = 3

function diasAtras(dias: number) {
  const d = new Date()
  d.setDate(d.getDate() - dias)
  return paraISO(d)
}

function somarDias(dia: string, dias: number) {
  const d = deISO(dia)
  d.setDate(d.getDate() + dias)
  return paraISO(d)
}

export async function listarNoticias(): Promise<Noticia[]> {
  const { data, error } = await supabase
    .from('noticias')
    .select('*')
    .gte('publicada_em', diasAtras(DIAS_DE_NOTICIAS))
    .order('publicada_em', { ascending: false })
    .limit(300)
  if (error) throw error
  return data as Noticia[]
}

/** Sinais do dia mais recente que tem sinal (o radar roda à noite; de manhã, mostra os de ontem) */
export async function listarSinais(): Promise<Sinal[]> {
  const { data: ultimo, error } = await supabase
    .from('sinais')
    .select('dia')
    .order('dia', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw error
  if (!ultimo) return []
  const { data, error: e } = await supabase
    .from('sinais')
    .select('*')
    .eq('dia', ultimo.dia)
    .order('relevancia', { ascending: false, nullsFirst: false })
  if (e) throw e
  return data
}

export async function buscarGastoIA(): Promise<GastoIA> {
  const mes = `${hojeISO().slice(0, 7)}-01`
  const { data, error } = await supabase.from('ia_uso').select('custo_usd, limite_usd').eq('mes', mes).maybeSingle()
  if (error) throw error
  // Sem chamada no mês, vale o último limite gravado
  let limite = data?.limite_usd
  if (limite == null) {
    const { data: antes } = await supabase
      .from('ia_uso')
      .select('limite_usd')
      .not('limite_usd', 'is', null)
      .order('mes', { ascending: false })
      .limit(1)
      .maybeSingle()
    limite = antes?.limite_usd ?? LIMITE_PADRAO_USD
  }
  return { gasto: Number(data?.custo_usd ?? 0), limite: Number(limite) }
}

/** Preço de hoje de um ativo acompanhável (dólar ou ticker); juros e renda fixa não têm preço aqui */
export async function precoAtual(ativo: string | null): Promise<number | null> {
  if (!ativo) return null
  if (ativo === 'dolar') {
    const { data } = await supabase
      .from('indicadores')
      .select('valor')
      .eq('serie', 'dolar')
      .order('dia', { ascending: false })
      .limit(1)
      .maybeSingle()
    return data ? Number(data.valor) : null
  }
  if (!/^[A-Z]{4}\d{1,2}$/.test(ativo.toUpperCase())) return null
  const { data } = await supabase.from('cotacoes').select('preco').eq('ticker', ativo.toUpperCase()).maybeSingle()
  return data ? Number(data.preco) : null
}

async function precoEm(ativo: string, dia: string): Promise<number | null> {
  if (ativo !== 'dolar') return precoAtual(ativo)
  const { data } = await supabase
    .from('indicadores')
    .select('valor')
    .eq('serie', 'dolar')
    .lte('dia', dia)
    .order('dia', { ascending: false })
    .limit(1)
    .maybeSingle()
  return data ? Number(data.valor) : null
}

export async function registrarTese(sinal: Sinal, decisao: 'entrei' | 'passei', valor: number | null) {
  const { error } = await supabase.from('teses').insert({
    sinal_id: sinal.id,
    titulo: sinal.titulo,
    ativo: sinal.ativo,
    direcao: sinal.direcao,
    decisao,
    valor,
    preco_entrada: await precoAtual(sinal.ativo),
    prazo_dias: sinal.prazo_dias,
  })
  if (error) throw error
}

export async function excluirTese(id: string) {
  const { error } = await supabase.from('teses').delete().eq('id', id)
  if (error) throw error
}

/**
 * Teses do usuário. As que venceram o prazo e têm preço para comparar são fechadas aqui: acertou se o preço andou na
 * direção da tese (vale também para as que o usuário passou, porque o que se mede é o sinal).
 */
export async function listarTeses(): Promise<Tese[]> {
  const { data, error } = await supabase.from('teses').select('*').order('dia', { ascending: false })
  if (error) throw error

  const hoje = hojeISO()
  for (const t of data) {
    if (t.resultado || !t.ativo || t.preco_entrada == null || !t.prazo_dias) continue
    if (t.direcao !== 'alta' && t.direcao !== 'baixa') continue
    const fim = somarDias(t.dia, t.prazo_dias)
    if (fim > hoje) continue
    const final = await precoEm(t.ativo, fim)
    if (final === null) continue
    const subiu = final > Number(t.preco_entrada)
    const resultado = (t.direcao === 'alta') === subiu ? 'acertou' : 'errou'
    const { error: e } = await supabase.from('teses').update({ preco_final: final, resultado, fechada_em: fim }).eq('id', t.id)
    if (!e) Object.assign(t, { preco_final: final, resultado, fechada_em: fim })
  }
  return data
}
