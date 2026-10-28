// Atualiza os dados de mercado (públicos): séries do Banco Central (SGS) e expectativas do Focus (Olinda).
//
// Chamada pelo pg_cron uma vez por dia e pelo app quando os dados estão velhos. Qualquer JWT válido do projeto
// pode chamar (os dados são iguais para todo mundo); quem grava é a service role.
//
// Corpo: {} → busca desde o último dia gravado de cada série (1ª vez: 5 anos)
//
// Também cota na brapi os tickers que aparecem nas carteiras (secret BRAPI_TOKEN ou BRAPI_API_KEY; plano grátis = 1 ticker por chamada)
// e atualiza o saldo dos investimentos cadastrados à mão que têm ticker e quantidade.
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2'

const SGS = 'https://api.bcb.gov.br/dados/serie/bcdata.sgs'
const FOCUS = 'https://olinda.bcb.gov.br/olinda/servico/Expectativas/versao/v1/odata/ExpectativasMercadoAnuais'
const FUSO = 'America/Sao_Paulo'
const ANOS_PRIMEIRA_VEZ = 5
// Rodou há menos que isso: não busca de novo (o app pode chamar várias vezes)
const MINUTOS_ENTRE_BUSCAS = 30

/** Nome no app → código da série no SGS */
const SERIES: Record<string, number> = {
  selic_meta: 432, // meta Selic, % ao ano
  cdi_anual: 4389, // CDI anualizado base 252, % ao ano
  ipca_mes: 433, // IPCA no mês, %
  ipca_12m: 13522, // IPCA acumulado em 12 meses, %
  dolar: 1, // dólar comercial venda, R$
}
const INDICADORES_FOCUS = ['Selic', 'IPCA', 'Câmbio']
const BRAPI = 'https://brapi.dev/api/quote'
// Ação, FII, ETF, BDR: 4 letras + 1 ou 2 dígitos (PETR4, HGLG11, BOVA11, AAPL34)
const RE_TICKER = /^[A-Z]{4}\d{1,2}$/

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const json = (corpo: unknown, status = 200) =>
  new Response(JSON.stringify(corpo), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

const hoje = () => new Intl.DateTimeFormat('en-CA', { timeZone: FUSO }).format(new Date())

function somarDias(dia: string, dias: number) {
  const d = new Date(`${dia}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + dias)
  return d.toISOString().slice(0, 10)
}

/** "2026-10-27" ↔ "27/10/2026" (formato do SGS) */
const paraBR = (dia: string) => dia.split('-').reverse().join('/')
const deBR = (dia: string) => dia.split('/').reverse().join('-')

async function buscarJson<T>(url: string): Promise<T> {
  // O BCB às vezes demora ou responde 5xx: tenta de novo uma vez
  for (let tentativa = 0; ; tentativa++) {
    const r = await fetch(url, { headers: { Accept: 'application/json' } })
    if (r.ok) return (await r.json()) as T
    if (tentativa >= 1 || r.status < 500) throw new Error(`${new URL(url).hostname} respondeu ${r.status}`)
    await new Promise((ok) => setTimeout(ok, 1500))
  }
}

/** Cota os tickers das carteiras e atualiza o saldo dos investimentos manuais com ticker e quantidade */
async function cotarCarteiras(db: SupabaseClient, dia: string) {
  const token = Deno.env.get('BRAPI_TOKEN') ?? Deno.env.get('BRAPI_API_KEY')
  const { data: posicoes, error } = await db
    .from('investimentos')
    .select('id, user_id, origem, codigo, quantidade')
    .neq('status', 'TOTAL_WITHDRAWAL')
    .not('codigo', 'is', null)
  if (error) throw error
  const tickers = [...new Set(posicoes.map((p) => String(p.codigo).toUpperCase()).filter((c) => RE_TICKER.test(c)))]
  if (tickers.length === 0) return 0
  if (!token) throw new Error('falta o secret BRAPI_TOKEN (ou BRAPI_API_KEY)')

  const precos = new Map<string, number>()
  for (const ticker of tickers) {
    const r = await fetch(`${BRAPI}/${ticker}?token=${encodeURIComponent(token)}`)
    if (!r.ok) {
      console.error('brapi', ticker, r.status)
      continue
    }
    const { results } = (await r.json()) as {
      results?: {
        symbol: string
        shortName?: string
        regularMarketPrice?: number
        regularMarketChangePercent?: number
        regularMarketTime?: string
      }[]
    }
    const q = results?.[0]
    if (!q || typeof q.regularMarketPrice !== 'number') continue
    precos.set(ticker, q.regularMarketPrice)
    const { error: e } = await db.from('cotacoes').upsert({
      ticker,
      nome: q.shortName ?? null,
      preco: q.regularMarketPrice,
      variacao_dia: q.regularMarketChangePercent ?? null,
      cotado_em: q.regularMarketTime ?? null,
      atualizado_em: new Date().toISOString(),
    })
    if (e) throw e
  }

  // Manuais: saldo = quantidade × preço de hoje
  for (const p of posicoes) {
    const preco = precos.get(String(p.codigo).toUpperCase())
    if (p.origem !== 'manual' || preco === undefined || !p.quantidade) continue
    const saldo = Math.round(Number(p.quantidade) * preco * 100) / 100
    const { error: e1 } = await db
      .from('investimentos')
      .update({ saldo_bruto: saldo, atualizado_em: new Date().toISOString() })
      .eq('id', p.id)
    if (e1) throw e1
    const { error: e2 } = await db
      .from('investimentos_historico')
      .upsert({ investimento_id: p.id, user_id: p.user_id, dia, saldo_bruto: saldo }, { onConflict: 'investimento_id,dia' })
    if (e2) throw e2
  }
  return precos.size
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ erro: 'Use POST.' }, 405)

  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false },
  })
  const dia = hoje()

  try {
    const { data: ultimos, error } = await db.rpc('ultimos_dias_indicadores')
    if (error) throw error
    const ultimoPorSerie = new Map((ultimos as { serie: string; dia: string; gravado_em: string }[]).map((u) => [u.serie, u]))
    const maisRecente = Math.max(0, ...[...ultimoPorSerie.values()].map((u) => Date.parse(u.gravado_em)))
    if (Date.now() - maisRecente < MINUTOS_ENTRE_BUSCAS * 60_000) return json({ status: 'em dia' })

    const resumo: Record<string, number> = {}
    const avisos: string[] = []

    for (const [serie, codigo] of Object.entries(SERIES)) {
      try {
        // Volta alguns dias: o BCB corrige valores recentes
        const ultimo = ultimoPorSerie.get(serie)?.dia
        const desde = ultimo ? somarDias(ultimo, -10) : somarDias(dia, -365 * ANOS_PRIMEIRA_VEZ)
        const pontos = await buscarJson<{ data: string; valor: string }[]>(
          `${SGS}.${codigo}/dados?formato=json&dataInicial=${paraBR(desde)}&dataFinal=${paraBR(dia)}`,
        )
        // A meta Selic vem com os dias seguintes já preenchidos: fica só até hoje
        const linhas = pontos
          .map((p) => ({ serie, dia: deBR(p.data), valor: Number(p.valor), gravado_em: new Date().toISOString() }))
          .filter((l) => l.dia <= dia && Number.isFinite(l.valor))
        for (let i = 0; i < linhas.length; i += 500) {
          const { error: e } = await db.from('indicadores').upsert(linhas.slice(i, i + 500), { onConflict: 'serie,dia' })
          if (e) throw e
        }
        resumo[serie] = linhas.length
      } catch (e) {
        avisos.push(`${serie}: ${(e as Error).message}`)
      }
    }

    try {
      const { data: ultimaColeta } = await db
        .from('expectativas')
        .select('data_coleta')
        .order('data_coleta', { ascending: false })
        .limit(1)
        .maybeSingle()
      const desde = ultimaColeta ? somarDias(ultimaColeta.data_coleta, -7) : somarDias(dia, -365)
      const filtro =
        `(${INDICADORES_FOCUS.map((i) => `Indicador eq '${i}'`).join(' or ')})` + ` and baseCalculo eq 0 and Data ge '${desde}'`
      const url = `${FOCUS}?$format=json&$top=10000&$select=Indicador,Data,DataReferencia,Mediana&$filter=${encodeURIComponent(filtro)}`
      const { value } = await buscarJson<{
        value: { Indicador: string; Data: string; DataReferencia: string; Mediana: number }[]
      }>(url)
      const ano = Number(dia.slice(0, 4))
      const linhas = value
        .map((v) => ({ indicador: v.Indicador, ano: Number(v.DataReferencia), data_coleta: v.Data, mediana: v.Mediana }))
        // Só o ano atual e os dois seguintes
        .filter((l) => l.ano >= ano && l.ano <= ano + 2 && Number.isFinite(l.mediana))
      for (let i = 0; i < linhas.length; i += 500) {
        const { error: e } = await db
          .from('expectativas')
          .upsert(linhas.slice(i, i + 500), { onConflict: 'indicador,ano,data_coleta' })
        if (e) throw e
      }
      resumo.focus = linhas.length
    } catch (e) {
      avisos.push(`focus: ${(e as Error).message}`)
    }

    try {
      resumo.cotacoes = await cotarCarteiras(db, dia)
    } catch (e) {
      avisos.push(`cotações: ${(e as Error).message}`)
    }

    return json({ status: avisos.length ? 'parcial' : 'sucesso', resumo, avisos })
  } catch (e) {
    const mensagem = (e as { message?: string })?.message || 'Erro inesperado.'
    console.error('mercado-sync', e)
    return json({ erro: mensagem }, 502)
  }
})
