// Radar de oportunidades: grava os sinais do dia, iguais para todo mundo.
//
// Chamada pelo pg_cron 1x por dia, depois do mercado-sync e do noticias-sync da noite. Qualquer JWT válido do
// projeto pode chamar; quem grava é a service role.
//
// Dois tipos de sinal:
// - quant: regras numéricas sem IA (dólar vs média de 200 dias, dólar vs Focus, juro real, queda de juros esperada).
//   Sempre recalculados.
// - ia: até 3 teses que o modelo monta com as notícias relevantes + os números. No máximo 1 geração por dia e dentro do
//   teto de gasto; passou do teto, ficam só os quant.
//
// Nada pessoal vai para a IA: reserva de emergência, teto de 10% do patrimônio e perda em reais são aplicados no app.
//
// Corpo: {} | { refazer: true } → gera de novo as teses de hoje (gasta outra chamada)
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { z } from 'npm:zod@4.6.7'
import { LimiteAtingido, perguntar } from '../_shared/ia.ts'

const FUSO = 'America/Sao_Paulo'
const MAX_TESES = 3
// Teto do % sugerido em qualquer tese (o app ainda limita a 10% do patrimônio pessoal)
const PCT_MAX = 10

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const json = (corpo: unknown, status = 200) =>
  new Response(JSON.stringify(corpo), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

const hoje = () => new Intl.DateTimeFormat('en-CA', { timeZone: FUSO }).format(new Date())
const pct = (x: number) => `${x.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%`
const reais = (x: number) => `R$ ${x.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

type Sinal = {
  origem: 'quant' | 'ia'
  classe: 'pos_fixado' | 'prefixado' | 'ipca' | 'cambio' | 'acoes' | 'outro'
  ativo: string | null
  direcao: 'alta' | 'baixa' | 'neutra' | null
  titulo: string
  tese: string
  objetivo: string
  embutido?: string | null
  confirma?: string | null
  invalida?: string | null
  risco?: string | null
  prazo_dias?: number | null
  pct_max?: number | null
  perda_contraria_pct?: number | null
  relevancia?: number | null
  noticias?: string[]
}

type Numeros = {
  selic: number | null
  ipca12m: number | null
  dolar: number | null
  mm200: number | null
  focus: { selic: Record<number, number>; ipca: Record<number, number>; cambio: Record<number, number> }
}

async function buscarNumeros(db: SupabaseClient): Promise<Numeros> {
  const ultimo = async (serie: string) => {
    const { data, error } = await db
      .from('indicadores')
      .select('valor')
      .eq('serie', serie)
      .order('dia', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (error) throw error
    return data ? Number(data.valor) : null
  }
  const { data: dolares, error } = await db
    .from('indicadores')
    .select('valor')
    .eq('serie', 'dolar')
    .order('dia', { ascending: false })
    .limit(200)
  if (error) throw error

  const ano = Number(hoje().slice(0, 4))
  const { data: exp, error: e2 } = await db
    .from('expectativas')
    .select('indicador, ano, data_coleta, mediana')
    .in('ano', [ano, ano + 1])
    .order('data_coleta', { ascending: false })
    .limit(60)
  if (e2) throw e2
  const focus: Numeros['focus'] = { selic: {}, ipca: {}, cambio: {} }
  const chave: Record<string, keyof Numeros['focus']> = { Selic: 'selic', IPCA: 'ipca', Câmbio: 'cambio' }
  // Já vem da coleta mais recente para a mais antiga: fica a primeira de cada indicador/ano
  for (const e of exp) {
    const k = chave[e.indicador]
    if (k && focus[k][e.ano] === undefined) focus[k][e.ano] = Number(e.mediana)
  }

  return {
    selic: await ultimo('selic_meta'),
    ipca12m: await ultimo('ipca_12m'),
    dolar: dolares[0] ? Number(dolares[0].valor) : null,
    mm200: dolares.length >= 200 ? dolares.reduce((s, d) => s + Number(d.valor), 0) / dolares.length : null,
    focus,
  }
}

/** Regras numéricas, sem IA. Só vira sinal o que foge do normal; juro real sempre aparece (guia a reserva). */
export function sinaisQuantitativos(n: Numeros): Sinal[] {
  const ano = Number(hoje().slice(0, 4))
  const sinais: Sinal[] = []

  if (n.dolar && n.mm200) {
    const desvio = (n.dolar / n.mm200 - 1) * 100
    if (Math.abs(desvio) >= 5) {
      const caro = desvio > 0
      sinais.push({
        origem: 'quant',
        classe: 'cambio',
        ativo: 'dolar',
        direcao: caro ? 'baixa' : 'alta',
        titulo: caro ? 'Dólar bem acima da média de 200 dias' : 'Dólar bem abaixo da média de 200 dias',
        tese: `O dólar está em ${reais(n.dolar)}, ${pct(Math.abs(desvio))} ${caro ? 'acima' : 'abaixo'} da média de 200 dias (${reais(n.mm200)}). Distâncias assim costumam diminuir com o tempo, mas podem durar enquanto o motivo continuar.`,
        objetivo: caro
          ? 'Evitar comprar dólar caro agora; quem já tem pode aproveitar para vender parte.'
          : 'Comprar dólar mais barato que o normal, para viagem ou proteção do patrimônio.',
        prazo_dias: 90,
        relevancia: Math.min(1, Math.abs(desvio) / 15),
      })
    }
  }

  const cambioFim = n.focus.cambio[ano]
  if (n.dolar && cambioFim) {
    const dif = (cambioFim / n.dolar - 1) * 100
    if (Math.abs(dif) >= 3) {
      sinais.push({
        origem: 'quant',
        classe: 'cambio',
        ativo: 'dolar',
        direcao: dif > 0 ? 'alta' : 'baixa',
        titulo: dif > 0 ? 'Mercado espera dólar mais caro no fim do ano' : 'Mercado espera dólar mais barato no fim do ano',
        tese: `O Focus projeta ${reais(cambioFim)} no fim de ${ano}, ${pct(Math.abs(dif))} ${dif > 0 ? 'acima' : 'abaixo'} do dólar de hoje (${reais(n.dolar)}). É a mediana dos economistas, que erra com frequência.`,
        objetivo:
          dif > 0
            ? 'Antecipar a compra de dólar, se você vai precisar dele, antes de ficar mais caro.'
            : 'Esperar para comprar dólar, se você vai precisar dele, porque o mercado acha que vai baratear.',
        prazo_dias: 60,
        relevancia: Math.min(1, Math.abs(dif) / 10),
      })
    }
  }

  if (n.selic !== null && n.ipca12m !== null) {
    const real = ((1 + n.selic / 100) / (1 + n.ipca12m / 100) - 1) * 100
    sinais.push({
      origem: 'quant',
      classe: 'pos_fixado',
      ativo: 'selic',
      direcao: 'neutra',
      titulo: real >= 6 ? 'Juro real alto: pós-fixado rende bem acima da inflação' : 'Juro real do pós-fixado',
      tese: `Com Selic de ${pct(n.selic)} e inflação de ${pct(n.ipca12m)} em 12 meses, o pós-fixado rende cerca de ${pct(real)} ao ano acima da inflação, sem risco de preço. É o lugar da reserva de emergência.`,
      objetivo: 'Fazer o dinheiro da reserva crescer acima da inflação sem correr risco.',
      prazo_dias: 365,
      relevancia: Math.min(1, Math.max(0.3, real / 10)),
    })
  }

  const selicProx = n.focus.selic[ano + 1]
  if (n.selic !== null && selicProx !== undefined && n.selic - selicProx >= 1.5) {
    sinais.push({
      origem: 'quant',
      classe: 'prefixado',
      ativo: 'prefixado',
      direcao: 'alta',
      titulo: 'Mercado espera queda forte dos juros',
      tese: `O Focus projeta Selic de ${pct(selicProx)} no fim de ${ano + 1}, contra ${pct(n.selic)} hoje. Se a queda vier, títulos prefixados e IPCA+ comprados agora sobem de preço; se os juros não caírem, eles perdem para o pós-fixado.`,
      objetivo: 'Travar uma taxa alta hoje para ganhar mais se os juros caírem nos próximos anos.',
      prazo_dias: 365,
      relevancia: Math.min(1, (n.selic - selicProx) / 4),
    })
  }
  return sinais
}

const Teses = z.object({
  teses: z
    .array(
      z.object({
        classe: z.enum(['pos_fixado', 'prefixado', 'ipca', 'cambio', 'acoes', 'outro']),
        ativo: z.string().describe('dolar, selic, prefixado, ipca, ibovespa ou um ticker'),
        direcao: z.enum(['alta', 'baixa', 'neutra']).describe('direção esperada do preço do ativo'),
        titulo: z.string().describe('até 8 palavras'),
        tese: z.string().describe('2 a 3 frases: o que aconteceu e por que pode mexer com o preço'),
        objetivo: z
          .string()
          .describe(
            '1 frase, começando com verbo, do que a pessoa ganha seguindo a tese (ex.: "Lucrar com a queda do dólar comprando...", "Proteger o patrimônio de...")',
          ),
        embutido: z.string().describe('o que o preço de hoje já embute, 1 frase'),
        confirma: z.string().describe('o que confirmaria a tese, 1 frase'),
        invalida: z.string().describe('o que invalidaria a tese, 1 frase'),
        risco: z.enum(['baixo', 'medio', 'alto']),
        prazo_dias: z.number().int(),
        pct_max: z.number().describe(`% máximo do dinheiro livre para essa aposta, de 0 a ${PCT_MAX}`),
        perda_contraria_pct: z.number().describe('quanto o ativo cairia (em %, número positivo) no cenário contrário'),
        relevancia: z.number().describe('0 a 1'),
        noticias: z.array(z.number().int()).describe('números das manchetes que embasam a tese'),
      }),
    )
    .describe(`no máximo ${MAX_TESES}; lista vazia se nada for forte o bastante`),
})

const SISTEMA = `Você é um analista que ajuda um investidor pessoa física brasileiro, iniciante, a enxergar
oportunidades táticas a partir das notícias e dos números do dia. Monte no máximo ${MAX_TESES} teses, só as
fortes; prefira nenhuma a uma fraca. Toda tese precisa dizer o que o preço já embute, o que confirma, o que invalida
e quanto se perde se der errado. Seja conservador no % sugerido (máximo ${PCT_MAX}%, normalmente 2 a 5%) e honesto
sobre a incerteza: notícia de hoje muitas vezes já está no preço. Não repita os sinais numéricos como tese própria,
use-os como contexto. Escreva em português do Brasil, frases curtas e sem jargão.`

async function gerarTeses(db: SupabaseClient, n: Numeros, quant: Sinal[]): Promise<Sinal[]> {
  const desde = new Date(Date.now() - 3 * 86_400_000).toISOString()
  const { data: noticias, error } = await db
    .from('noticias')
    .select('id, titulo, fonte, publicada_em, classificacao, relevancia')
    .gte('publicada_em', desde)
    .gte('relevancia', 0.5)
    .order('relevancia', { ascending: false })
    .limit(25)
  if (error) throw error
  if (!noticias.length) return []

  const ano = Number(hoje().slice(0, 4))
  const numeros = [
    n.selic !== null && `Selic: ${pct(n.selic)}`,
    n.ipca12m !== null && `IPCA 12 meses: ${pct(n.ipca12m)}`,
    n.dolar && `Dólar: ${reais(n.dolar)}${n.mm200 ? ` (média de 200 dias ${reais(n.mm200)})` : ''}`,
    ...[ano, ano + 1].map(
      (a) =>
        `Focus fim de ${a}: Selic ${n.focus.selic[a] ?? '?'}%, IPCA ${n.focus.ipca[a] ?? '?'}%, dólar R$ ${n.focus.cambio[a] ?? '?'}`,
    ),
  ].filter(Boolean)
  const lista = noticias
    .map((x, i) => {
      const c = x.classificacao as { ativos?: string[]; direcao?: string } | null
      const dia = x.publicada_em.slice(0, 10).split('-').reverse().join('/')
      return `${i}. [${dia}] ${x.titulo}${x.fonte ? ` (${x.fonte})` : ''}${c?.ativos?.length ? ` → ${c.ativos.join(', ')} ${c.direcao ?? ''}` : ''}`
    })
    .join('\n')

  const r = await perguntar(db, {
    sistema: SISTEMA,
    pergunta: `Hoje é ${hoje().split('-').reverse().join('/')}.

Números:
${numeros.join('\n')}

Sinais numéricos de hoje:
${quant.map((s) => `- ${s.titulo}`).join('\n') || '- nenhum'}

Manchetes relevantes dos últimos 3 dias (com a classificação prévia):
${lista}`,
    schema: Teses,
    maxTokens: 2000,
  })

  return r.teses.slice(0, MAX_TESES).map((t) => ({
    origem: 'ia',
    classe: t.classe,
    ativo: t.ativo.toLowerCase() === 'dolar' ? 'dolar' : t.ativo,
    direcao: t.direcao,
    titulo: t.titulo,
    tese: t.tese,
    objetivo: t.objetivo,
    embutido: t.embutido,
    confirma: t.confirma,
    invalida: t.invalida,
    risco: t.risco,
    prazo_dias: Math.max(1, t.prazo_dias),
    // Regras fixas no código, não no prompt
    pct_max: Math.min(PCT_MAX, Math.max(0, t.pct_max)),
    perda_contraria_pct: Math.abs(t.perda_contraria_pct),
    relevancia: Math.min(1, Math.max(0, t.relevancia)),
    noticias: t.noticias.map((i) => noticias[i]?.id).filter((id): id is string => !!id),
  }))
}

export async function atualizarRadar(db: SupabaseClient, refazer: boolean) {
  const dia = hoje()
  const avisos: string[] = []
  const numeros = await buscarNumeros(db)
  const quant = sinaisQuantitativos(numeros)

  const { error: e1 } = await db.from('sinais').delete().eq('dia', dia).eq('origem', 'quant')
  if (e1) throw e1
  if (quant.length) {
    const { error } = await db.from('sinais').insert(quant.map((s) => ({ ...s, dia })))
    if (error) throw error
  }

  const { count, error: e2 } = await db
    .from('sinais')
    .select('id', { count: 'exact', head: true })
    .eq('dia', dia)
    .eq('origem', 'ia')
  if (e2) throw e2
  let teses = count ?? 0
  if (refazer || !teses) {
    try {
      const novas = await gerarTeses(db, numeros, quant)
      const { error: e3 } = await db.from('sinais').delete().eq('dia', dia).eq('origem', 'ia')
      if (e3) throw e3
      if (novas.length) {
        const { error } = await db.from('sinais').insert(novas.map((s) => ({ ...s, dia })))
        if (error) throw error
      }
      teses = novas.length
    } catch (e) {
      if (!(e instanceof LimiteAtingido)) console.error('gerarTeses', e)
      avisos.push(`teses: ${(e as Error).message}`)
    }
  }

  // Sinais com mais de 90 dias saem; os que viraram tese no diário ficam (sinal_id vira null)
  const limite = new Date(Date.now() - 90 * 86_400_000).toISOString().slice(0, 10)
  await db.from('sinais').delete().lt('dia', limite)

  return { dia, quant: quant.length, teses, avisos }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ erro: 'Use POST.' }, 405)

  const corpo = await req.json().catch(() => ({}))
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false },
  })
  try {
    const r = await atualizarRadar(db, corpo?.refazer === true)
    return json({ status: r.avisos.length ? 'parcial' : 'sucesso', ...r })
  } catch (e) {
    const mensagem = (e as { message?: string })?.message || 'Erro inesperado.'
    console.error('radar-sync', e)
    return json({ erro: mensagem }, 502)
  }
})
