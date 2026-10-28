// Busca notícias que mexem com investimentos no Google News (RSS, pt-BR) e grava sem repetir.
//
// Chamada pelo pg_cron (a cada 2h em dia útil, 1x por dia no fim de semana). Qualquer JWT válido do projeto pode
// chamar; quem grava é a service role. O feed é para uso pessoal, não comercial (termos do Google News).
//
// Corpo: {} → busca os temas fixos + um tema por ticker das carteiras, das últimas 48h, e classifica com a IA as
// manchetes ainda sem classificação (dentro do teto de gasto do mês; passou do teto, só busca)
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { z } from 'npm:zod@4.6.7'
import { LimiteAtingido, perguntar } from '../_shared/ia.ts'

const RSS = 'https://news.google.com/rss/search'
const DIAS_GUARDADOS = 90
const POR_TEMA = 15
// Manchetes por chamada à IA (uma chamada por execução)
const POR_LOTE = 80

/** Tema → busca no Google News */
const TEMAS: Record<string, string> = {
  cambio: 'dólar câmbio real',
  juros: 'Copom Selic juros',
  inflacao: 'IPCA inflação',
  fiscal: 'arcabouço fiscal OR dívida pública OR gastos do governo',
  politica: 'eleição OR governo Lula mercado financeiro',
  bolsa: 'Ibovespa bolsa de valores',
  exterior: 'Fed juros Estados Unidos mercados',
}

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const json = (corpo: unknown, status = 200) =>
  new Response(JSON.stringify(corpo), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

type Noticia = {
  id: string
  titulo: string
  fonte: string | null
  link: string
  publicada_em: string
  temas: Set<string>
  tickers: Set<string>
}

const entidades: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", '#39': "'" }
const decodificar = (texto: string) =>
  texto
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&(#?\w+);/g, (m, e) => entidades[e] ?? (e.startsWith('#') ? String.fromCharCode(Number(e.slice(1))) : m))
    .trim()

const tag = (item: string, nome: string) => {
  const m = item.match(new RegExp(`<${nome}[^>]*>([\\s\\S]*?)</${nome}>`))
  return m ? decodificar(m[1]) : null
}

/** "Dólar fecha a R$ 5,40 - O GLOBO" → título sem a fonte, normalizado para achar a mesma matéria */
const normalizar = (titulo: string) =>
  titulo
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()

async function hash(texto: string) {
  const bytes = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(texto))
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

async function buscarTema(busca: string) {
  const url = `${RSS}?q=${encodeURIComponent(`${busca} when:2d`)}&hl=pt-BR&gl=BR&ceid=BR:pt-419`
  const r = await fetch(url)
  if (!r.ok) throw new Error(`Google News respondeu ${r.status}`)
  const xml = await r.text()
  const itens = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map((m) => m[1]).slice(0, POR_TEMA)
  return itens
    .map((item) => {
      const fonte = tag(item, 'source')
      let titulo = tag(item, 'title') ?? ''
      // O Google põe " - Fonte" no fim do título
      if (fonte && titulo.endsWith(` - ${fonte}`)) titulo = titulo.slice(0, -(fonte.length + 3))
      const data = tag(item, 'pubDate')
      return { titulo, fonte, link: tag(item, 'link') ?? '', publicada_em: data ? new Date(data).toISOString() : null }
    })
    .filter((n) => n.titulo && n.link && n.publicada_em)
}

export async function buscarNoticias(db: SupabaseClient) {
  const { data: posicoes, error } = await db.from('investimentos').select('codigo').not('codigo', 'is', null)
  if (error) throw error
  const tickers = [...new Set(posicoes.map((p) => String(p.codigo).toUpperCase()).filter((c) => /^[A-Z]{4}\d{1,2}$/.test(c)))]

  const buscas: { tema: string | null; ticker: string | null; busca: string }[] = [
    ...Object.entries(TEMAS).map(([tema, busca]) => ({ tema, ticker: null, busca })),
    ...tickers.map((t) => ({ tema: null, ticker: t, busca: `${t} ações` })),
  ]

  const porId = new Map<string, Noticia>()
  const avisos: string[] = []
  for (const b of buscas) {
    try {
      for (const n of await buscarTema(b.busca)) {
        const id = await hash(normalizar(n.titulo))
        const atual = porId.get(id) ?? { ...n, id, publicada_em: n.publicada_em!, temas: new Set(), tickers: new Set() }
        if (b.tema) atual.temas.add(b.tema)
        if (b.ticker) atual.tickers.add(b.ticker)
        porId.set(id, atual)
      }
    } catch (e) {
      avisos.push(`${b.tema ?? b.ticker}: ${(e as Error).message}`)
    }
  }

  // Já gravadas: junta os temas novos com os de antes
  const ids = [...porId.keys()]
  const existentes = new Map<string, { temas: string[]; tickers: string[] }>()
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error: e } = await db
      .from('noticias')
      .select('id, temas, tickers')
      .in('id', ids.slice(i, i + 200))
    if (e) throw e
    for (const n of data) existentes.set(n.id, n)
  }
  const linhas = [...porId.values()].map((n) => {
    const antes = existentes.get(n.id)
    return {
      id: n.id,
      titulo: n.titulo,
      fonte: n.fonte,
      link: n.link,
      publicada_em: n.publicada_em,
      temas: [...new Set([...(antes?.temas ?? []), ...n.temas])],
      tickers: [...new Set([...(antes?.tickers ?? []), ...n.tickers])],
    }
  })
  for (let i = 0; i < linhas.length; i += 200) {
    const { error: e } = await db.from('noticias').upsert(linhas.slice(i, i + 200), { onConflict: 'id' })
    if (e) throw e
  }

  const limite = new Date(Date.now() - DIAS_GUARDADOS * 86_400_000).toISOString()
  await db.from('noticias').delete().lt('publicada_em', limite)

  return { novas: linhas.length - existentes.size, total: linhas.length, avisos }
}

const ATIVOS = ['dolar', 'selic', 'ipca', 'prefixado', 'ibovespa', 'acoes', 'fii', 'cripto', 'ouro', 'petroleo'] as const

const Classificacoes = z.object({
  itens: z.array(
    z.object({
      i: z.number().int().describe('número da manchete na lista'),
      relevancia: z.number().describe('0 a 1: quanto a notícia pode mexer com preços no Brasil nas próximas semanas'),
      ativos: z.array(z.string()).describe(`afetados: ${ATIVOS.join(', ')} ou o ticker da manchete`),
      direcao: z.enum(['alta', 'baixa', 'neutra']).describe('direção provável do primeiro ativo da lista'),
      prazo: z.enum(['dias', 'semanas', 'meses']),
    }),
  ),
})

const SISTEMA = `Você classifica manchetes do mercado financeiro brasileiro para um investidor pessoa física.
Para cada manchete, diga quanto ela pode mexer com preços (relevancia de 0 a 1), quais ativos afeta, a direção
provável do ativo mais afetado e em que prazo. Notícia sem efeito em preço (fofoca, opinião genérica, propaganda,
resultado de jogo) tem relevancia abaixo de 0.2 e ativos vazio. Seja conservador: relevancia acima de 0.7 só para
decisão do Copom, dado de inflação fora do esperado, choque fiscal ou político, decisão do Fed, resultado de empresa
muito acima ou abaixo do esperado.`

/** Classifica as manchetes recentes que ainda não têm classificação. Devolve quantas classificou ou o aviso. */
export async function classificar(db: SupabaseClient) {
  const desde = new Date(Date.now() - 2 * 86_400_000).toISOString()
  const { data: pendentes, error } = await db
    .from('noticias')
    .select('id, titulo, fonte')
    .is('classificacao', null)
    .gte('publicada_em', desde)
    .order('publicada_em', { ascending: false })
    .limit(POR_LOTE)
  if (error) throw error
  if (!pendentes.length) return 0

  const lista = pendentes.map((n, i) => `${i}. ${n.titulo}${n.fonte ? ` (${n.fonte})` : ''}`).join('\n')
  const r = await perguntar(db, {
    sistema: SISTEMA,
    pergunta: `Manchetes:\n${lista}`,
    schema: Classificacoes,
    maxTokens: 60 * pendentes.length + 200,
  })

  let feitas = 0
  for (const c of r.itens) {
    const n = pendentes[c.i]
    if (!n) continue
    const relevancia = Math.min(1, Math.max(0, c.relevancia))
    const { error: e } = await db
      .from('noticias')
      .update({ classificacao: { ativos: c.ativos, direcao: c.direcao, prazo: c.prazo }, relevancia })
      .eq('id', n.id)
    if (e) throw e
    feitas++
  }
  return feitas
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ erro: 'Use POST.' }, 405)

  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false },
  })
  try {
    const r = await buscarNoticias(db)
    let classificadas = 0
    try {
      classificadas = await classificar(db)
    } catch (e) {
      // Sem IA (teto do mês, chave faltando, API fora) as notícias continuam chegando, só sem classificação
      if (!(e instanceof LimiteAtingido)) console.error('classificar', e)
      r.avisos.push(`classificação: ${(e as Error).message}`)
    }
    return json({ status: r.avisos.length ? 'parcial' : 'sucesso', ...r, classificadas })
  } catch (e) {
    const mensagem = (e as { message?: string })?.message || 'Erro inesperado.'
    console.error('noticias-sync', e)
    return json({ erro: mensagem }, 502)
  }
})
