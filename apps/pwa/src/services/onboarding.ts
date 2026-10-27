import { supabase } from '../lib/supabase'
import type { Json, Tables } from '../types/database'
import perguntasJson from '../data/perguntas.json'

export type Job = Tables<'jobs'>

export type Opcao = { valor: string; rotulo: string; ajuda: string }
export type Pergunta = {
  chave: string
  bloco: string
  tipo: 'scale' | 'choice' | 'multi' | 'number'
  enunciado: string
  ajuda: string
  obrigatoria: boolean
  opcoes?: Opcao[]
  minimo?: number
  maximo?: number
  passo?: number
}
export type Bloco = { chave: string; titulo: string }

/** As 18 perguntas vêm de `questionnaire.py` por `scripts/exportar_perguntas.py`.
 *  A pontuação de risco **não** vem: ela mora no Python, e é a VM que conclui.
 *  `tests/test_onboarding_export.py` quebra se esta cópia envelhecer. */
export const blocos = perguntasJson.blocos as Bloco[]
export const perguntas = perguntasJson.perguntas as Pergunta[]
export const perguntaTemCarteira = perguntasJson.temCarteira as Pergunta

export type Respostas = Record<string, string | number | string[]>

export type Prerequisito = { titulo: string; detalhe: string; valor: number; bloqueia: boolean }
export type PosicaoSugerida = {
  ticker: string; nome: string; classe: string; setor: string
  pesoPct: number; valor: number; preco: number | null; cotas: number; justificativa: string
}
export type VetoNoticia = {
  ticker: string; criterio: string; motivo: string; frase: string; fonte: string; url: string
}
export type Plano = {
  planoId: number
  geradoEm: string
  aceitoEm: string | null
  perfil: { nome: string; score: number; horizonteAnos: number; disponivel: number; aporteMensal: number; alocacao: Record<string, number>; notas: string[] }
  prerequisitos: Prerequisito[]
  posicoes: PosicaoSugerida[]
  rejeitados: Record<string, string[]>
  vetos: VetoNoticia[]
  alertas: VetoNoticia[]
  triagemOk: boolean
  triagemMotivo: string
  resumo: string
  riscos: string
  proximosPassos: string[]
  incompleta: boolean
  aviso: string
}

/** O payload é JSON gravado pela VM, não um tipo garantido pelo banco: um plano
 *  publicado por uma versão anterior pode não ter todas as chaves de hoje. A
 *  tela desenha listas e campos aninhados, então o default vem aqui — e não em
 *  cada `?.` espalhado pela tela. */
function comoPlano(payload: Json, id: number, geradoEm: string, aceitoEm: string | null): Plano | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null
  const bruto = payload as Record<string, unknown>
  if (!Array.isArray(bruto.posicoes)) return null
  const perfil = (bruto.perfil && typeof bruto.perfil === 'object' && !Array.isArray(bruto.perfil)
    ? bruto.perfil : {}) as Partial<Plano['perfil']>
  const lista = (valor: unknown) => (Array.isArray(valor) ? valor : [])
  return {
    planoId: id,
    geradoEm,
    aceitoEm,
    perfil: {
      nome: perfil.nome ?? '—',
      score: typeof perfil.score === 'number' ? perfil.score : 0,
      horizonteAnos: typeof perfil.horizonteAnos === 'number' ? perfil.horizonteAnos : 0,
      disponivel: typeof perfil.disponivel === 'number' ? perfil.disponivel : 0,
      aporteMensal: typeof perfil.aporteMensal === 'number' ? perfil.aporteMensal : 0,
      alocacao: perfil.alocacao ?? {},
      notas: lista(perfil.notas) as string[],
    },
    prerequisitos: lista(bruto.prerequisitos) as Prerequisito[],
    posicoes: bruto.posicoes as PosicaoSugerida[],
    rejeitados: (bruto.rejeitados && typeof bruto.rejeitados === 'object' && !Array.isArray(bruto.rejeitados)
      ? bruto.rejeitados : {}) as Record<string, string[]>,
    vetos: lista(bruto.vetos) as VetoNoticia[],
    alertas: lista(bruto.alertas) as VetoNoticia[],
    triagemOk: bruto.triagemOk === true,
    triagemMotivo: typeof bruto.triagemMotivo === 'string' ? bruto.triagemMotivo : '',
    resumo: typeof bruto.resumo === 'string' ? bruto.resumo : '',
    riscos: typeof bruto.riscos === 'string' ? bruto.riscos : '',
    proximosPassos: lista(bruto.proximosPassos) as string[],
    incompleta: bruto.incompleta === true,
    aviso: typeof bruto.aviso === 'string' ? bruto.aviso : '',
  }
}

export async function carregarOnboarding() {
  const [perfil, plano, job] = await Promise.all([
    supabase.from('perfil_investidor').select('respostas,derivado,atualizado').eq('id', 1).maybeSingle(),
    supabase.from('planos').select('id,gerado_em,aceito_em,payload').order('gerado_em', { ascending: false }).limit(1).maybeSingle(),
    // Só o job de recomendação: um snapshot rodando não é a carteira sendo montada.
    supabase.from('jobs').select('*').eq('tipo', 'recomendacao').order('criado', { ascending: false }).limit(1).maybeSingle(),
  ])
  if (perfil.error) throw perfil.error
  if (plano.error) throw plano.error
  if (job.error) throw job.error

  const respostas = (perfil.data?.respostas ?? null) as Respostas | null
  const derivado = perfil.data?.derivado
  const temPerfilDerivado = !!derivado && typeof derivado === 'object' && !Array.isArray(derivado)
    && Object.keys(derivado).length > 0

  return {
    respostas,
    respondido: !!respostas && Object.keys(respostas).length > 0,
    temPerfilDerivado,
    plano: plano.data ? comoPlano(plano.data.payload, plano.data.id, plano.data.gerado_em, plano.data.aceito_em) : null,
    job: job.data,
  }
}

/** Grava as respostas sem tocar no `derivado`.
 *
 *  O `derivado` é da VM. Um upsert cheio apagaria o perfil anterior no instante
 *  do salvamento e deixaria a aba Investimentos sem alocação-alvo até o cron
 *  rodar — então aqui é update primeiro, insert só se não havia linha. */
export async function salvarRespostas(respostas: Respostas) {
  const atualizado = await supabase
    .from('perfil_investidor')
    .update({ respostas: respostas as unknown as Json })
    .eq('id', 1)
    .select('id')
  if (atualizado.error) throw atualizado.error
  if (atualizado.data && atualizado.data.length > 0) return

  const { error } = await supabase
    .from('perfil_investidor')
    .insert({ id: 1, respostas: respostas as unknown as Json, derivado: {} })
  if (error) throw error
}

/** Enfileira o cálculo da carteira. A VM deriva o perfil e publica o plano. */
export async function pedirRecomendacao() {
  const { data: existentes, error: erroBusca } = await supabase
    .from('jobs').select('id').eq('tipo', 'recomendacao').in('estado', ['pendente', 'rodando']).limit(1)
  if (erroBusca) throw erroBusca
  if (existentes.length) return
  const { error } = await supabase.from('jobs').insert({ tipo: 'recomendacao' })
  if (error) throw error
}

/** Marca o plano como aceito. **Não compra nada** (spec 002, item 4): a compra
 *  acontece na corretora e é declarada depois, pelo caminho normal de escrita. */
export async function aceitarPlano(id: number) {
  const { error } = await supabase
    .from('planos').update({ aceito_em: new Date().toISOString() }).eq('id', id)
  if (error) throw error
}

// --- Importação da carteira existente (spec 002, item 3a) -------------------

export type LinhaImportada = { ticker: string; cotas: number; precoMedio: number | null }

/** Lê `TICKER QUANTIDADE [PREÇO MÉDIO]`, uma por linha.
 *
 *  Entrada mínima é ticker e quantidade: é tudo que se pode exigir de alguém
 *  digitando no celular. Levanta no primeiro erro, citando a linha. */
export function lerCarteiraColada(texto: string): LinhaImportada[] {
  const linhas: LinhaImportada[] = []
  for (const bruta of texto.split('\n')) {
    const linha = bruta.trim()
    if (!linha) continue
    const partes = linha.split(/[\s,;]+/).filter(Boolean)
    if (partes.length < 2) {
      throw new Error(`"${linha}": informe o ticker e a quantidade, como "VALE3 100".`)
    }
    const ticker = partes[0].toUpperCase().replace(/\.SA$/, '')
    if (!/^[A-Z]{4,6}\d{1,2}$/.test(ticker)) {
      throw new Error(`"${partes[0]}" não parece um ticker da B3, como VALE3 ou HGLG11.`)
    }
    const cotas = Number(partes[1].replace(',', '.'))
    if (!Number.isFinite(cotas) || cotas <= 0) {
      throw new Error(`"${linha}": a quantidade tem que ser um número maior que zero.`)
    }
    let precoMedio: number | null = null
    if (partes.length > 2) {
      precoMedio = Number(partes[2].replace(/\./g, '').replace(',', '.'))
      if (!Number.isFinite(precoMedio) || precoMedio <= 0) {
        throw new Error(`"${linha}": o preço médio tem que ser um número maior que zero.`)
      }
    }
    linhas.push({ ticker: `${ticker}.SA`, cotas, precoMedio })
  }
  if (!linhas.length) throw new Error('Nenhuma linha para importar.')
  return linhas
}

/** Cotações do último snapshot, para a linha sem preço médio informado. */
async function cotacoesConhecidas(): Promise<Map<string, number>> {
  const { data, error } = await supabase
    .from('snapshots').select('payload').order('gerado_em', { ascending: false }).limit(1).maybeSingle()
  if (error || !data) return new Map()
  const payload = data.payload
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return new Map()
  const bruto = payload as Record<string, unknown>
  const precos = new Map<string, number>()

  // `positions` traz o preço pronto; `assets` guarda a série, e o preço de lá
  // está em `indicators.price_current` (ou no último fechamento da série).
  if (Array.isArray(bruto.positions)) {
    for (const item of bruto.positions as Record<string, unknown>[]) {
      const ticker = typeof item?.ticker === 'string' ? item.ticker.toUpperCase() : ''
      const preco = item?.price
      if (ticker && typeof preco === 'number' && preco > 0) precos.set(ticker, preco)
    }
  }
  const assets = bruto.assets
  if (assets && typeof assets === 'object' && !Array.isArray(assets)) {
    for (const [ticker, dados] of Object.entries(assets as Record<string, unknown>)) {
      if (!dados || typeof dados !== 'object' || precos.has(ticker.toUpperCase())) continue
      const indicadores = (dados as Record<string, unknown>).indicators
      const atual = indicadores && typeof indicadores === 'object'
        ? (indicadores as Record<string, unknown>).price_current : undefined
      if (typeof atual === 'number' && atual > 0) {
        precos.set(ticker.toUpperCase(), atual)
        continue
      }
      const fechamentos = (dados as Record<string, unknown>).close
      if (Array.isArray(fechamentos)) {
        const ultimo = [...fechamentos].reverse().find((v) => typeof v === 'number' && v > 0)
        if (typeof ultimo === 'number') precos.set(ticker.toUpperCase(), ultimo)
      }
    }
  }
  return precos
}

/** Importa a carteira que já existia, como `origem='onboarding'`.
 *
 *  `origem='onboarding'` é o que impede a despesa retroativa da spec 004: o
 *  dinheiro dessas compras saiu antes de o sistema existir, e lançar isso como
 *  gasto do mês destruiria o fluxo de caixa. O gatilho do banco já garante isso.
 *
 *  Sobre o preço médio: informado, entra como está e o resultado é real desde o
 *  primeiro dia. Não informado, entra pela cotação conhecida, com `nota`
 *  dizendo isso — e o sistema avisa que o resultado só passa a significar algo
 *  dali para frente. Sem cotação conhecida, **pede o preço** em vez de inventar
 *  um plausível: um lucro falso em cima do qual alguém decide é pior que a
 *  pergunta extra. */
export async function importarCarteira(linhas: LinhaImportada[]) {
  const precos = await cotacoesConhecidas()
  const semPreco = linhas.filter((l) => l.precoMedio === null && !precos.has(l.ticker.toUpperCase()))
  if (semPreco.length) {
    throw new Error(
      'Ainda não tenho cotação de ' + semPreco.map((l) => l.ticker.replace(/\.SA$/, '')).join(', ')
      + '. Informe o preço médio dessas linhas (ex.: "VALE3 100 61,40") — eu não vou'
      + ' chutar um preço, porque isso viraria lucro falso.',
    )
  }

  const { error: erroAtivos } = await supabase
    .from('ativos')
    .upsert(linhas.map((l) => ({ ticker: l.ticker })), { onConflict: 'ticker', ignoreDuplicates: true })
  if (erroAtivos) throw erroAtivos

  const hoje = new Date().toISOString().slice(0, 10)
  const movimentos = linhas.map((l) => {
    const informado = l.precoMedio !== null
    return {
      tipo: 'compra', ticker: l.ticker, shares: l.cotas,
      preco: informado ? (l.precoMedio as number) : (precos.get(l.ticker.toUpperCase()) as number),
      taxas: 0, data: hoje, origem: 'onboarding',
      nota: informado
        ? 'Posição que já existia; preço médio informado por você.'
        : 'Posição que já existia; preço médio não informado, entrou pela cotação da importação. '
          + 'O resultado só tem significado a partir desta data.',
    }
  })

  const { error } = await supabase.from('movimentacoes').insert(movimentos)
  if (error) throw error
}
