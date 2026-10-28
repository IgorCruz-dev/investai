// Sincroniza contas, cartões e transações do Meu Pluggy (Open Finance, somente leitura).
//
// Secrets da função (nunca vão para o front):
//   PLUGGY_CLIENT_ID, PLUGGY_CLIENT_SECRET  credenciais da aplicação em dashboard.pluggy.ai
//   PLUGGY_ITEM_IDS                         ids das conexões do meu.pluggy.ai, separados por vírgula
//   PLUGGY_USER_ID                          id do usuário do app dono dessas conexões (só ele pode sincronizar)
//
// Corpo: { "acao": "contas" }       → atualiza status das conexões e a lista de contas da Pluggy
//        { "acao": "sincronizar" }  → isso + importa as transações (padrão)
//        { "acao": "reimportar" }   → igual, mas busca de novo os últimos 90 dias de todas as contas
//        { "automatica": true }     → pg_cron: sincroniza o dono (PLUGGY_USER_ID) e chama a notificar
//
// Com login, roda com o JWT de quem chama (RLS). No modo automático não há usuário: usa o service role,
// por isso toda consulta também filtra por user_id. Para o anon key não virar gatilho à vontade, o modo
// automático só roda se a última sincronização tiver mais de INTERVALO_MINIMO_MIN minutos.
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2'

const PLUGGY = 'https://api.pluggy.ai'
const DIAS_PRIMEIRA_VEZ = 90
// Nas próximas vezes, volta alguns dias antes da última sincronização: pega compras que
// passaram de pendentes para lançadas e transações que o banco publicou atrasado
const DIAS_DE_FOLGA = 10
const FUSO = 'America/Sao_Paulo'
const INTERVALO_MINIMO_MIN = 90

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const json = (corpo: unknown, status = 200) =>
  new Response(JSON.stringify(corpo), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

// ===================== Pluggy =====================

type ItemPluggy = {
  id: string
  status: string
  executionStatus?: string
  lastUpdatedAt?: string | null
  consentExpiresAt?: string | null
  error?: { code?: string; message?: string } | null
  connector?: { name?: string }
}

type ContaPluggy = {
  id: string
  itemId: string
  type: 'BANK' | 'CREDIT'
  subtype?: string
  name: string
  marketingName?: string | null
  number?: string | null
  balance?: number | null
  creditData?: {
    creditLimit?: number | null
    balanceCloseDate?: string | null
    balanceDueDate?: string | null
    brand?: string | null
  } | null
}

type TransacaoPluggy = {
  id: string
  description: string
  amount: number
  /** Moeda de amount: em compra internacional vem a original (ex.: USD) */
  currencyCode?: string | null
  /** Valor na moeda da conta (BRL); só vem quando a compra foi em outra moeda */
  amountInAccountCurrency?: number | null
  date: string
  type?: 'DEBIT' | 'CREDIT'
  status?: string
  category?: string | null
  operationType?: string | null
  merchant?: { name?: string | null; businessName?: string | null } | null
  creditCardMetadata?: { installmentNumber?: number | null; totalInstallments?: number | null; billId?: string | null } | null
}

type FaturaPluggy = { id: string; dueDate: string }

type InvestimentoPluggy = {
  id: string
  itemId: string
  type: string
  subtype?: string | null
  name: string
  code?: string | null
  issuer?: string | null
  /** Líquido (depois de IR e taxas) */
  balance?: number | null
  /** Bruto */
  amount?: number | null
  amountOriginal?: number | null
  quantity?: number | null
  rate?: number | null
  rateType?: string | null
  fixedAnnualRate?: number | null
  dueDate?: string | null
  status?: string | null
}

class ErroPluggy extends Error {
  constructor(
    mensagem: string,
    readonly status: number,
  ) {
    super(mensagem)
  }
}

async function conectarPluggy() {
  const clientId = Deno.env.get('PLUGGY_CLIENT_ID')
  const clientSecret = Deno.env.get('PLUGGY_CLIENT_SECRET')
  if (!clientId || !clientSecret) throw new Error('Faltam os secrets PLUGGY_CLIENT_ID e PLUGGY_CLIENT_SECRET na função.')

  const resposta = await fetch(`${PLUGGY}/auth`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clientId, clientSecret }),
  })
  if (!resposta.ok) throw new ErroPluggy(`A Pluggy recusou as credenciais (${resposta.status}).`, resposta.status)
  const { apiKey } = (await resposta.json()) as { apiKey: string }

  async function get<T>(caminhoOuUrl: string, parametros: Record<string, string> = {}): Promise<T> {
    const url = new URL(caminhoOuUrl.startsWith('http') ? caminhoOuUrl : `${PLUGGY}${caminhoOuUrl}`)
    for (const [k, v] of Object.entries(parametros)) url.searchParams.set(k, v)
    const r = await fetch(url, { headers: { 'X-API-KEY': apiKey } })
    if (!r.ok) throw new ErroPluggy(`Pluggy respondeu ${r.status} em ${url.pathname}.`, r.status)
    return (await r.json()) as T
  }

  /** Listas paginadas por página (accounts, bills) */
  async function todasAsPaginas<T>(caminho: string, parametros: Record<string, string>) {
    const itens: T[] = []
    for (let pagina = 1; ; pagina++) {
      const r = await get<{ results: T[]; totalPages?: number }>(caminho, { ...parametros, page: String(pagina) })
      itens.push(...r.results)
      if (!r.totalPages || pagina >= r.totalPages) return itens
    }
  }

  /** GET /v2/transactions: paginação por cursor ("next") */
  async function transacoes(accountId: string, dateFrom: string) {
    const itens: TransacaoPluggy[] = []
    let r = await get<{ results: TransacaoPluggy[]; next?: string | null }>('/v2/transactions', { accountId, dateFrom })
    itens.push(...r.results)
    while (r.next) {
      const next = r.next
      // A doc diz que "next" vem pronto para usar; aceita URL, caminho, query string ou só o cursor
      if (next.startsWith('http') || next.startsWith('/')) r = await get(next)
      else if (next.startsWith('?')) r = await get(`/v2/transactions${next}`)
      else r = await get('/v2/transactions', { accountId, dateFrom, after: next })
      itens.push(...r.results)
    }
    return itens
  }

  return {
    item: (id: string) => get<ItemPluggy>(`/items/${id}`),
    identidade: (itemId: string) => get<{ fullName?: string | null }>('/identity', { itemId }),
    contas: (itemId: string) => todasAsPaginas<ContaPluggy>('/accounts', { itemId }),
    faturas: (accountId: string) => todasAsPaginas<FaturaPluggy>('/bills', { accountId }),
    investimentos: (itemId: string) => todasAsPaginas<InvestimentoPluggy>('/investments', { itemId }),
    transacoes,
  }
}

type Pluggy = Awaited<ReturnType<typeof conectarPluggy>>

// ===================== Datas =====================

const diaFormatado = new Intl.DateTimeFormat('en-CA', { timeZone: FUSO, year: 'numeric', month: '2-digit', day: '2-digit' })

/** "2026-10-20T03:00:00.000Z" → "2026-10-20" no horário de Brasília. Meia-noite UTC exata é só data: fica como veio. */
function diaLocal(iso: string) {
  if (/T00:00:00(\.0+)?Z$/.test(iso)) return iso.slice(0, 10)
  return diaFormatado.format(new Date(iso))
}

function somarDias(dia: string, dias: number) {
  const d = new Date(`${dia}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + dias)
  return d.toISOString().slice(0, 10)
}

const ultimoDiaDoMes = (ano: number, mes0: number) => new Date(Date.UTC(ano, mes0 + 1, 0)).getUTCDate()
const primeiroDoMes = (ano: number, mes0: number) => new Date(Date.UTC(ano, mes0, 1)).toISOString().slice(0, 10)

/** Mesma regra do app (lib/fatura.ts e mes_da_fatura no banco): dia 1 do mês de vencimento */
function mesDaFatura(dia: string, fechamento: number, vencimento: number) {
  const [ano, mes, d] = dia.split('-').map(Number)
  const diaFechamento = Math.min(fechamento, ultimoDiaDoMes(ano, mes - 1))
  const meses = (d >= diaFechamento ? 1 : 0) + (vencimento <= fechamento ? 1 : 0)
  return primeiroDoMes(ano, mes - 1 + meses)
}

// ===================== Regras de importação =====================

type Cartao = { id: string; nome: string; dia_fechamento: number; dia_vencimento: number; pluggy_account_id: string | null }

type Linha = {
  user_id: string
  origem: 'pluggy'
  id_externo: string
  tipo: 'receita' | 'despesa'
  forma: 'debito' | 'pix' | 'credito'
  valor: number
  data: string
  local: string | null
  descricao: string | null
  categoria_id: string | null
  categoria_pluggy: string | null
  conta_id: string | null
  cartao_id: string | null
  fatura: string | null
  parcela_atual: number | null
  total_parcelas: number | null
  pagamento_cartao_id: string | null
  pagamento_fatura: string | null
  transferencia_interna: boolean
  caixinha: boolean
  terceiro: string | null
}

// ===================== Lançamento agendado =====================

/** Lançamento que o usuário criou antes de acontecer (data depois do dia em que foi criado) e o banco ainda não trouxe */
type Agendado = {
  id: string
  tipo: 'receita' | 'despesa'
  forma: string
  valor: number
  data: string
  conta_id: string | null
  cartao_id: string | null
  local: string | null
  descricao: string | null
}

const DIAS_PARA_CASAR = 5

/**
 * Quando o lançamento de verdade chega do banco, ele "vira" o agendado em vez de entrar duplicado: mesmo tipo, mesma
 * conta (pix e débito valem igual) ou mesmo cartão, valor até 5% (mínimo R$ 2) de diferença e data até 5 dias antes ou
 * depois. Se mais de um servir, fica o de data e valor mais perto. Devolve id_externo → id do agendado.
 */
function casarComAgendados(novas: Linha[], agendados: Agendado[]) {
  const casados = new Map<string, string>()
  const usados = new Set<string>()
  const dias = (a: string, b: string) => Math.abs(Date.parse(a) - Date.parse(b)) / 86_400_000
  for (const n of novas) {
    if (n.transferencia_interna || n.caixinha || n.pagamento_cartao_id) continue
    const candidatos = agendados.filter(
      (a) =>
        !usados.has(a.id) &&
        a.tipo === n.tipo &&
        (n.forma === 'credito'
          ? a.forma === 'credito' && a.cartao_id === n.cartao_id
          : a.forma !== 'credito' && a.conta_id === n.conta_id) &&
        Math.abs(a.valor - n.valor) <= Math.max(2, a.valor * 0.05) &&
        dias(a.data, n.data) <= DIAS_PARA_CASAR,
    )
    const melhor = candidatos.sort(
      (x, y) => dias(x.data, n.data) - dias(y.data, n.data) || Math.abs(x.valor - n.valor) - Math.abs(y.valor - n.valor),
    )[0]
    if (!melhor) continue
    usados.add(melhor.id)
    casados.set(n.id_externo, melhor.id)
  }
  return casados
}

// "GASTOS CARTAO DE CREDITO" é o débito automático da fatura no Bradesco; "PAGTO ANTECIPADO" é pagamento antes do vencimento
const RE_PAGAMENTO_FATURA =
  /pagamento.*(fatura|cart[aã]o)|pgto.*(fat|cart)|pag\.? fatura|fatura.*cart[aã]o|gastos cart[aã]o|pagto antec/i

// Fatura não paga inteira: o banco zera a antiga com "Crédito de rotativo" e cobra o resto na nova como "Saldo em rotativo".
// A Pluggy põe os dois na fatura nova; o crédito é da anterior.
const RE_CREDITO_ROTATIVO = /cr[eé]dito de rotativo/i

// Caixinha do Nubank: dinheiro guardado ("Aplicação RDB") ou tirado ("Resgate RDB") continua sendo da pessoa
const RE_CAIXINHA = /^(aplica[cç][aã]o|resgate) rdb\b/i
// Pix no crédito (Nubank): o cartão põe o valor na conta e o Pix sai em seguida; o gasto é a compra no cartão
const RE_PIX_NO_CREDITO = /valor adicionado na conta por cart[aã]o de cr[eé]dito/i

function faturaAnterior(fatura: string) {
  const [ano, mes] = fatura.split('-').map(Number)
  return primeiroDoMes(ano, mes - 2)
}

function ehPagamentoDeFatura(t: TransacaoPluggy) {
  return t.category === 'Credit card payment' || RE_PAGAMENTO_FATURA.test(t.description)
}

/** Cara de transferência (Pix, TED, "transf..."): candidata a ser entre as próprias contas */
function pareceTransferencia(t: TransacaoPluggy) {
  return (
    ehPix(t) ||
    t.operationType === 'TED' ||
    /^Transfer|Same person transfer/.test(t.category ?? '') ||
    /transf|\bted\b|\bdoc\b/i.test(t.description)
  )
}

const semAcento = (texto: string) =>
  texto
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()

/** Nomes com que o banco aparece na descrição de um pagamento ("Nubank" também aparece como "Nu Pagamentos") */
function apelidosDoBanco(banco: string) {
  const palavra = semAcento(banco)
    .split(/[^a-z0-9]+/)
    .find((p) => p.length >= 3)
  if (!palavra) return []
  return palavra === 'nubank' ? ['nubank', 'nu pagamentos', 'nu pag'] : [palavra]
}

/**
 * Nome do dono, para achar Pix/TED para si mesmo. Tem que ser o nome inteiro: parente com nome
 * parecido ("Ricardo Parise Macarios", pai de "... Junior") é outra pessoa. Quando o banco corta
 * o nome ("Ricardo Parise Macari"), quem acha a transferência é o pareamento entre as contas.
 */
function nomeCompleto(nome: string) {
  return semAcento(nome).split(/\s+/).filter(Boolean).join(' ')
}

/** Nome do banco de uma conexão. Pelo Meu Pluggy o conector se chama "MeuPluggy": o banco sai do nome das contas */
function nomeDoBanco(conector: string, contas: ContaPluggy[]) {
  if (!/meu ?pluggy/i.test(conector)) return conector
  // Conta corrente primeiro: nome de cartão ("gold", "ELO MAIS") raramente diz o banco
  const nomes = [...contas.filter((c) => c.type === 'BANK'), ...contas.filter((c) => c.type !== 'BANK')].map((c) => c.name)
  for (const nome of nomes) {
    if (/nu pagamentos|nubank/i.test(nome)) return 'Nubank'
    const banco = nome
      .replace(/^banco\s+/i, '')
      .split(/\s+-\s+|\s+s\.?\s?a\.?(\s|$)/i)[0]
      .trim()
    if (banco) return banco
  }
  return conector
}

function ehPix(t: TransacaoPluggy) {
  return t.operationType === 'PIX' || /\bpix\b/i.test(t.description) || /PIX/.test(t.category ?? '')
}

const limpar = (texto: string | null | undefined) => texto?.replace(/\s+/g, ' ').trim() || null

function localDa(t: TransacaoPluggy) {
  return limpar(t.merchant?.name) ?? limpar(t.merchant?.businessName) ?? limpar(t.description)
}

/**
 * Fatura que um pagamento quita: das que vencem perto da data do pagamento, a mais próxima que ainda
 * tem valor em aberto (a fatura pode ser paga em partes). Se todas já estão pagas, a mais próxima.
 * falta: centavos em aberto por "idDoCartão|2026-11-01".
 */
function faturaDoPagamento(dia: string, cartao: Cartao, falta: Map<string, number>) {
  const [ano, mes] = dia.split('-').map(Number)
  const alvo = Date.parse(`${dia}T12:00:00Z`)
  const candidatas = [-1, 0, 1]
    .map((delta) => {
      const m = mes - 1 + delta
      const fatura = primeiroDoMes(ano, m)
      const [a, mm] = fatura.split('-').map(Number)
      const vencimento = Date.UTC(a, mm - 1, Math.min(cartao.dia_vencimento, ultimoDiaDoMes(a, mm - 1)), 12)
      return { fatura, distancia: Math.abs(vencimento - alvo) }
    })
    .sort((a, b) => a.distancia - b.distancia)
  const emAberto = candidatas.find((c) => (falta.get(`${cartao.id}|${c.fatura}`) ?? 0) > 0)
  return (emAberto ?? candidatas[0]).fatura
}

// ===================== Conexões e contas =====================

async function atualizarConexoes(db: SupabaseClient, pluggy: Pluggy, userId: string, itemIds: string[]) {
  const conexoes = []
  const contas: ContaPluggy[] = []
  const bancoDoItem = new Map<string, string>()
  const nomesDoDono = new Set<string>()

  for (const itemId of itemIds) {
    try {
      const item = await pluggy.item(itemId)
      const contasDoItem = await pluggy.contas(itemId)
      const banco = nomeDoBanco(item.connector?.name ?? 'Banco', contasDoItem)
      bancoDoItem.set(itemId, banco)
      // Sem identidade (banco não compartilha) só deixa de reconhecer Pix para si mesmo pelo nome
      const identidade = await pluggy.identidade(itemId).catch(() => null)
      if (identidade?.fullName) nomesDoDono.add(nomeCompleto(identidade.fullName))
      conexoes.push({
        user_id: userId,
        item_id: itemId,
        banco,
        status: item.status,
        erro: item.error?.code ?? (item.status === 'UPDATED' ? null : (item.executionStatus ?? null)),
        consentimento_expira_em: item.consentExpiresAt ?? null,
        atualizado_no_banco_em: item.lastUpdatedAt ?? null,
        verificado_em: new Date().toISOString(),
      })
      contas.push(...contasDoItem)
    } catch (e) {
      if (!(e instanceof ErroPluggy) || (e.status !== 404 && e.status !== 403)) throw e
      // Item sumiu (ex.: reautorizou no meu.pluggy.ai e o id mudou)
      conexoes.push({
        user_id: userId,
        item_id: itemId,
        banco: 'Conexão não encontrada',
        status: 'NAO_ENCONTRADO',
        erro: 'ITEM_NOT_FOUND',
        consentimento_expira_em: null,
        atualizado_no_banco_em: null,
        verificado_em: new Date().toISOString(),
      })
    }
  }

  const { error: e1 } = await db.from('pluggy_conexoes').upsert(conexoes, { onConflict: 'user_id,item_id' })
  if (e1) throw e1
  // Conexões que saíram do secret PLUGGY_ITEM_IDS
  const { error: e2 } = await db
    .from('pluggy_conexoes')
    .delete()
    .eq('user_id', userId)
    .not('item_id', 'in', `(${itemIds.map((i) => `"${i}"`).join(',')})`)
  if (e2) throw e2

  const linhas = contas.map((c) => ({
    user_id: userId,
    id: c.id,
    item_id: c.itemId,
    tipo: c.type,
    // Conta: "Bradesco Corrente" em vez do nome oficial ("Nu Pagamentos S.A. - Instituição de Pagamento (Conta Pré-paga)")
    nome:
      c.type === 'BANK'
        ? `${bancoDoItem.get(c.itemId) ?? 'Conta'} ${c.subtype === 'SAVINGS_ACCOUNT' ? 'Poupança' : 'Corrente'}`
        : (limpar(c.marketingName) ?? limpar(c.name) ?? 'Cartão'),
    numero: c.number ?? null,
    banco: bancoDoItem.get(c.itemId) ?? null,
    saldo: c.balance ?? null,
    limite: c.creditData?.creditLimit ?? null,
    bandeira: limpar(c.creditData?.brand),
    dia_fechamento: c.creditData?.balanceCloseDate ? Number(diaLocal(c.creditData.balanceCloseDate).slice(8, 10)) : null,
    dia_vencimento: c.creditData?.balanceDueDate ? Number(diaLocal(c.creditData.balanceDueDate).slice(8, 10)) : null,
    atualizado_em: new Date().toISOString(),
  }))
  if (linhas.length) {
    const { error } = await db.from('pluggy_contas').upsert(linhas, { onConflict: 'user_id,id' })
    if (error) throw error
  }
  // Contas que não vieram mais da Pluggy (os vínculos em contas/cartoes ficam como estão)
  const ids = linhas.map((l) => `"${l.id}"`).join(',')
  const apagar = db.from('pluggy_contas').delete().eq('user_id', userId)
  const { error: e3 } = ids ? await apagar.not('id', 'in', `(${ids})`) : await apagar
  if (e3) throw e3

  return { conexoes, contas, bancoDoItem, nomesDoDono: [...nomesDoDono] }
}

// ===================== Sincronização =====================

async function sincronizar(
  db: SupabaseClient,
  pluggy: Pluggy,
  userId: string,
  contasPluggy: ContaPluggy[],
  bancoDoItem: Map<string, string>,
  nomesDoDono: string[],
  /** Reimportar: busca de novo os últimos 90 dias de todas as contas (corrige valores já gravados) */
  completo = false,
) {
  const hoje = diaFormatado.format(new Date())

  const [ultimo, contasApp, cartoesApp, categorias, mapeamento, regras, ignoradas, pagamentos, parcelasDeTerceiros] = await Promise.all([
    db
      .from('sync_log')
      .select('data')
      .eq('user_id', userId)
      .in('status', ['sucesso', 'parcial'])
      .order('data', { ascending: false })
      .limit(1)
      .maybeSingle(),
    db.from('contas').select('id, pluggy_account_id').eq('user_id', userId).not('pluggy_account_id', 'is', null),
    db.from('cartoes').select('id, nome, dia_fechamento, dia_vencimento, pluggy_account_id').eq('user_id', userId),
    db.from('categorias').select('id, nome').eq('user_id', userId),
    db.from('mapeamento_categorias').select('categoria_pluggy, categoria_id').eq('user_id', userId),
    db.from('regras_categoria_local').select('local, categoria_id, terceiro').eq('user_id', userId),
    db.from('transacoes_ignoradas').select('id_externo').eq('user_id', userId),
    db
      .from('transacoes')
      .select('pagamento_cartao_id, pagamento_fatura, valor')
      .eq('user_id', userId)
      .not('pagamento_cartao_id', 'is', null),
    db
      .from('transacoes')
      .select('cartao_id, descricao, total_parcelas, valor, terceiro')
      .eq('user_id', userId)
      .not('terceiro', 'is', null)
      .not('total_parcelas', 'is', null),
  ])
  for (const r of [ultimo, contasApp, cartoesApp, categorias, mapeamento, regras, ignoradas, pagamentos, parcelasDeTerceiros])
    if (r.error) throw r.error

  const desdeUltima = ultimo.data ? somarDias(diaLocal(ultimo.data.data), -DIAS_DE_FOLGA) : null
  const primeiraVez = somarDias(hoje, -DIAS_PRIMEIRA_VEZ)
  const contaPorPluggy = new Map(contasApp.data!.map((c) => [c.pluggy_account_id as string, c.id as string]))
  const cartoes = cartoesApp.data as Cartao[]
  const cartaoPorPluggy = new Map(cartoes.filter((c) => c.pluggy_account_id).map((c) => [c.pluggy_account_id!, c]))
  const cartoesVinculados = [...cartaoPorPluggy.values()]
  // Banco (item) de cada cartão vinculado, para achar o cartão de um pagamento de fatura
  const itemDaConta = new Map(contasPluggy.map((c) => [c.id, c.itemId]))
  const itemDoCartao = new Map(cartoesVinculados.map((c) => [c.id, itemDaConta.get(c.pluggy_account_id!)]))

  /** Cartão que um pagamento quita: o citado na descrição; senão o do mesmo banco da conta; senão o único */
  function cartaoDoPagamento(t: TransacaoPluggy, itemDaContaPagadora: string) {
    const descricao = semAcento(t.description)
    const citados = cartoesVinculados.filter((c) => {
      const banco = bancoDoItem.get(itemDoCartao.get(c.id) ?? '')
      return banco && apelidosDoBanco(banco).some((apelido) => descricao.includes(apelido))
    })
    if (citados.length === 1) return citados[0]
    const doMesmoBanco = cartoesVinculados.filter((c) => itemDoCartao.get(c.id) === itemDaContaPagadora)
    if (doMesmoBanco.length === 1) return doMesmoBanco[0]
    return cartoesVinculados.length === 1 ? cartoesVinculados[0] : undefined
  }
  const outros = categorias.data!.find((c) => c.nome === 'Outros')?.id ?? null
  const porCategoriaPluggy = new Map(mapeamento.data!.map((m) => [m.categoria_pluggy, m.categoria_id]))
  const porLocal = new Map(regras.data!.map((r) => [r.local, r.categoria_id]))
  const terceiroPorLocal = new Map(regras.data!.filter((r) => r.terceiro).map((r) => [r.local, r.terceiro as string]))
  const jaIgnoradas = new Set(ignoradas.data!.map((i) => i.id_externo))

  /** Pix/TED de ou para o próprio nome: a outra ponta é outra conta da pessoa */
  const ehParaSiMesmo = (t: TransacaoPluggy) =>
    pareceTransferencia(t) && nomesDoDono.some((nome) => nomeCompleto(t.description).includes(nome))

  /** Pix/TED para o banco de um cartão vinculado de outro banco (ex.: Nubank → Bradesco): é pagamento desse cartão */
  const pagaCartaoDeOutroBanco = (t: TransacaoPluggy, itemDaContaPagadora: string) =>
    pareceTransferencia(t) &&
    cartoesVinculados.some((c) => {
      const item = itemDoCartao.get(c.id)
      const banco = bancoDoItem.get(item ?? '')
      return item !== itemDaContaPagadora && banco && apelidosDoBanco(banco).some((a) => semAcento(t.description).includes(a))
    })

  /**
   * Dono de uma parcela cuja compra já foi marcada como de outra pessoa: mesmo cartão, mesma descrição
   * sem o "n/m", mesmo número de parcelas e valor igual (pode mudar 1 centavo entre as parcelas)
   */
  const semNumeroDaParcela = (texto: string | null) => (texto ?? '').replace(/\s*\d+\/\d+\s*$/, '')
  const terceiroDaCompra = (cartaoId: string, descricao: string | null, total: number, valor: number) =>
    parcelasDeTerceiros.data!.find(
      (p) =>
        p.cartao_id === cartaoId &&
        p.total_parcelas === total &&
        Math.abs(Number(p.valor) - valor) <= 0.05 &&
        semNumeroDaParcela(p.descricao) === semNumeroDaParcela(descricao),
    )?.terceiro ?? null

  const categoriaDe = (t: TransacaoPluggy, local: string | null) =>
    (local && porLocal.get(local.toLowerCase())) || (t.category && porCategoriaPluggy.get(t.category)) || outros

  /** Regra por local que diz que o lançamento é de outra pessoa */
  const terceiroDe = (local: string | null) => (local && terceiroPorLocal.get(local.toLowerCase())) || null

  const novas: Linha[] = []
  // Pagamentos de fatura: a fatura de cada um é escolhida depois, quando já se sabe quanto falta pagar
  const pagamentosNovos: { linha: Linha; cartao: Cartao }[] = []
  // Saídas/entradas com cara de transferência, para parear entre contas depois
  const pareaveis = new Set<string>()
  const avisos: string[] = []
  let semVinculo = 0

  for (const conta of contasPluggy) {
    const contaId = conta.type === 'BANK' ? contaPorPluggy.get(conta.id) : undefined
    const cartao = conta.type === 'CREDIT' ? cartaoPorPluggy.get(conta.id) : undefined
    if (!contaId && !cartao) {
      semVinculo++
      continue
    }

    // Limite do cartão: o que o banco informa
    if (cartao && typeof conta.creditData?.creditLimit === 'number' && conta.creditData.creditLimit >= 0) {
      const { error } = await db.from('cartoes').update({ limite: conta.creditData.creditLimit }).eq('id', cartao.id)
      if (error) throw error
    }

    // Conta recém-vinculada (nada importado ainda) pega os 90 dias; as outras, desde a última sincronização
    let desde = primeiraVez
    if (desdeUltima && !completo) {
      const { count, error } = await db
        .from('transacoes')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId)
        .eq('origem', 'pluggy')
        .eq(cartao ? 'cartao_id' : 'conta_id', cartao ? cartao.id : contaId!)
      if (error) throw error
      if (count) desde = desdeUltima
    }

    const vencimentoDaFatura = new Map<string, string>()
    if (cartao) {
      for (const f of await pluggy.faturas(conta.id)) {
        const dia = diaLocal(f.dueDate)
        vencimentoDaFatura.set(f.id, `${dia.slice(0, 7)}-01`)
      }
    }

    for (const t of await pluggy.transacoes(conta.id, desde)) {
      if (jaIgnoradas.has(t.id)) continue
      // Compra internacional: amount vem em dólar (ou outra moeda); o que sai da fatura é o valor em reais
      const valor = Math.round(Math.abs(t.amountInAccountCurrency ?? t.amount) * 100) / 100
      if (valor === 0) continue
      const data = diaLocal(t.date)
      const local = localDa(t)
      const base = {
        user_id: userId,
        origem: 'pluggy' as const,
        id_externo: t.id,
        valor,
        data,
        local,
        descricao: limpar(t.description),
        categoria_pluggy: limpar(t.category),
        conta_id: null,
        cartao_id: null,
        fatura: null,
        parcela_atual: null,
        total_parcelas: null,
        pagamento_cartao_id: null,
        pagamento_fatura: null,
        transferencia_interna: false,
        caixinha: false,
        terceiro: null,
      }

      if (cartao) {
        // No cartão: positivo = compra; negativo = pagamento (fica no extrato da conta) ou estorno
        if (t.amount < 0 && ehPagamentoDeFatura(t)) continue
        const md = t.creditCardMetadata
        const parcela = md?.installmentNumber ?? null
        const total = md?.totalInstallments ?? null
        const parcelado = parcela !== null && total !== null && total > 1 && parcela >= 1 && parcela <= total
        const fatura =
          (md?.billId && vencimentoDaFatura.get(md.billId)) || mesDaFatura(data, cartao.dia_fechamento, cartao.dia_vencimento)
        novas.push({
          ...base,
          tipo: t.amount < 0 ? 'receita' : 'despesa',
          forma: 'credito',
          cartao_id: cartao.id,
          local: local ?? 'Compra no cartão',
          categoria_id: categoriaDe(t, local),
          // Regra por local; senão, parcela de uma compra já marcada como de outra pessoa
          terceiro:
            terceiroDe(local) ??
            (t.amount > 0 && parcelado ? terceiroDaCompra(cartao.id, base.descricao, total!, valor) : null),
          fatura: t.amount < 0 && RE_CREDITO_ROTATIVO.test(t.description) ? faturaAnterior(fatura) : fatura,
          parcela_atual: parcelado ? parcela : null,
          total_parcelas: parcelado ? total : null,
        })
        continue
      }

      // Na conta: CREDIT = entrou; DEBIT = saiu (sem type, vale o sinal)
      const entrou = t.type ? t.type === 'CREDIT' : t.amount > 0
      const forma = ehPix(t) ? 'pix' : 'debito'

      if (!entrou && ehPagamentoDeFatura(t) && cartoesVinculados.length > 0) {
        // Pagamento de fatura: paga a fatura (inteira ou em parte) e fica fora das despesas do mês
        const alvo = cartaoDoPagamento(t, conta.itemId)
        if (alvo) {
          const linha: Linha = {
            ...base,
            tipo: 'despesa',
            forma,
            conta_id: contaId!,
            local: `Fatura ${alvo.nome}`,
            categoria_id: null,
            pagamento_cartao_id: alvo.id,
          }
          novas.push(linha)
          pagamentosNovos.push({ linha, cartao: alvo })
          continue
        }
        avisos.push(`Pagamento de fatura de ${data} entrou como despesa comum (não deu para saber qual cartão).`)
      }

      if (pareceTransferencia(t)) pareaveis.add(t.id)
      novas.push({
        ...base,
        tipo: entrou ? 'receita' : 'despesa',
        forma,
        conta_id: contaId!,
        categoria_id: categoriaDe(t, local),
        terceiro: terceiroDe(local),
        // Nem receita nem gasto: Pix para si mesmo (a Pluggy reconhece só alguns; o nome pega os outros),
        // caixinha, Pix no crédito e pagamento de cartão de outro banco
        transferencia_interna:
          t.category === 'Same person transfer' ||
          ehParaSiMesmo(t) ||
          RE_CAIXINHA.test(t.description) ||
          RE_PIX_NO_CREDITO.test(t.description) ||
          (!entrou && pagaCartaoDeOutroBanco(t, conta.itemId)),
        // Guardar tira das receitas do mês; resgatar devolve
        caixinha: RE_CAIXINHA.test(t.description),
      })
    }
  }

  // Transferência entre as próprias contas: saída numa conta e entrada do mesmo valor em outra, com até 1 dia
  const umDia = 24 * 60 * 60 * 1000
  const livres = novas.filter((n) => pareaveis.has(n.id_externo) && !n.transferencia_interna)
  const usadas = new Set<string>()
  for (const saida of livres.filter((n) => n.tipo === 'despesa')) {
    const entrada = livres.find(
      (n) =>
        n.tipo === 'receita' &&
        !usadas.has(n.id_externo) &&
        n.conta_id !== saida.conta_id &&
        n.valor === saida.valor &&
        Math.abs(Date.parse(n.data) - Date.parse(saida.data)) <= umDia,
    )
    if (!entrada) continue
    usadas.add(entrada.id_externo)
    saida.transferencia_interna = true
    entrada.transferencia_interna = true
  }

  // Pix no crédito: o Pix que sai junto com o "valor adicionado" (mesma conta, dia e valor) também não é gasto da conta
  for (const entrada of novas.filter((n) => n.tipo === 'receita' && RE_PIX_NO_CREDITO.test(n.descricao ?? ''))) {
    const saida = novas.find(
      (n) =>
        n.tipo === 'despesa' &&
        n.forma === 'pix' &&
        !n.transferencia_interna &&
        n.conta_id === entrada.conta_id &&
        n.data === entrada.data &&
        n.valor === entrada.valor,
    )
    if (saida) saida.transferencia_interna = true
  }

  // Transferência entre as próprias contas não é de outra pessoa
  for (const n of novas) if (n.transferencia_interna) n.terceiro = null

  // Separa o que já existe (atualiza só o que vem do banco) do que é novo
  type Existente = {
    id: string
    valor: number
    data: string
    fatura: string | null
    parcela_atual: number | null
    total_parcelas: number | null
    categoria_pluggy: string | null
  }
  const existentes = new Map<string, Existente>()
  const ids = novas.map((n) => n.id_externo)
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await db
      .from('transacoes')
      .select('id, id_externo, valor, data, fatura, parcela_atual, total_parcelas, categoria_pluggy')
      .eq('user_id', userId)
      .in('id_externo', ids.slice(i, i + 200))
    if (error) throw error
    for (const e of data) existentes.set(e.id_externo!, e)
  }

  // Importadas que o usuário dividiu: o valor do banco é o do original somado ao das partes
  const somaDasPartes = new Map<string, number>()
  const idsExistentes = [...existentes.values()].map((e) => e.id)
  for (let i = 0; i < idsExistentes.length; i += 200) {
    const { data, error } = await db
      .from('transacoes')
      .select('dividida_de, valor')
      .eq('user_id', userId)
      .in('dividida_de', idsExistentes.slice(i, i + 200))
    if (error) throw error
    for (const p of data) {
      somaDasPartes.set(p.dividida_de!, (somaDasPartes.get(p.dividida_de!) ?? 0) + Math.round(Number(p.valor) * 100))
    }
  }

  // Fatura de cada pagamento novo. O que falta pagar vem do que já está gravado (compras dos cartões
  // vinculados menos pagamentos) mais as compras que entram agora; pagamentos mais antigos primeiro
  const pendentes = pagamentosNovos.filter((p) => !existentes.has(p.linha.id_externo))
  if (pendentes.length) {
    const falta = new Map<string, number>()
    const somar = (chave: string, centavos: number) => falta.set(chave, (falta.get(chave) ?? 0) + centavos)
    const { data: compras, error } = await db
      .from('transacoes')
      .select('cartao_id, fatura, valor, tipo')
      .eq('user_id', userId)
      .in(
        'cartao_id',
        cartoesVinculados.map((c) => c.id),
      )
    if (error) throw error
    for (const c of compras)
      somar(`${c.cartao_id}|${c.fatura}`, (c.tipo === 'despesa' ? 1 : -1) * Math.round(Number(c.valor) * 100))
    for (const n of novas) {
      if (n.forma !== 'credito' || existentes.has(n.id_externo)) continue
      somar(`${n.cartao_id}|${n.fatura}`, (n.tipo === 'despesa' ? 1 : -1) * Math.round(n.valor * 100))
    }
    for (const p of pagamentos.data!) somar(`${p.pagamento_cartao_id}|${p.pagamento_fatura}`, -Math.round(Number(p.valor) * 100))

    for (const { linha, cartao } of pendentes.sort((a, b) => a.linha.data.localeCompare(b.linha.data))) {
      const fatura = faturaDoPagamento(linha.data, cartao, falta)
      linha.pagamento_fatura = fatura
      somar(`${cartao.id}|${fatura}`, -Math.round(linha.valor * 100))
    }
  }

  // Lançamentos agendados pelo usuário que o banco pode estar trazendo agora
  const novasDeVerdade = novas.filter((n) => !existentes.has(n.id_externo))
  const agendados: Agendado[] = []
  if (novasDeVerdade.length) {
    const desdeAgendado = novasDeVerdade.reduce((m, n) => (n.data < m ? n.data : m), novasDeVerdade[0].data)
    const inicio = somarDias(desdeAgendado, -DIAS_PARA_CASAR)
    const { data, error } = await db
      .from('transacoes')
      .select('id, tipo, forma, valor, data, conta_id, cartao_id, local, descricao, criado_em')
      .eq('user_id', userId)
      .eq('origem', 'manual')
      .is('id_externo', null)
      .is('dividida_de', null)
      .is('pagamento_cartao_id', null)
      .eq('transferencia_interna', false)
      .gte('data', inicio)
    if (error) throw error
    for (const a of data) {
      // Só o que foi criado antes da data (agendado); o que foi lançado depois de acontecer é outro gasto
      if (a.data <= diaLocal(a.criado_em)) continue
      agendados.push({ ...a, valor: Number(a.valor) } as Agendado)
    }
  }
  const casados = casarComAgendados(novasDeVerdade, agendados)

  let atualizadas = 0
  let falhas = 0
  const inserir: Linha[] = []
  for (const n of novas) {
    const e = existentes.get(n.id_externo)
    const agendado = casados.get(n.id_externo)
    if (!e && agendado) {
      // Vira o agendado: dados do banco (valor, data, conta, fatura...), mas categoria, descrição e de quem é ficam do usuário
      const a = agendados.find((x) => x.id === agendado)!
      const { error } = await db
        .from('transacoes')
        .update({
          origem: 'pluggy',
          id_externo: n.id_externo,
          valor: n.valor,
          data: n.data,
          forma: n.forma,
          conta_id: n.conta_id,
          cartao_id: n.cartao_id,
          fatura: n.fatura,
          parcela_atual: n.parcela_atual,
          total_parcelas: n.total_parcelas,
          categoria_pluggy: n.categoria_pluggy,
          local: a.local ?? n.local,
          descricao: a.descricao ?? n.descricao,
        })
        .eq('id', agendado)
      if (error) {
        console.error('Não deu para juntar com o agendado', n.id_externo, error.message)
        inserir.push(n)
      } else atualizadas++
      continue
    }
    if (!e) {
      inserir.push(n)
      continue
    }
    // Categoria, local, descrição e observação são do usuário: não mexe
    const mudancas: Record<string, unknown> = {}
    // Dividida: o original fica com o valor do banco menos as partes
    const partes = somaDasPartes.get(e.id) ?? 0
    const valorCentavos = Math.round(n.valor * 100) - partes
    if (Math.round(Number(e.valor) * 100) !== valorCentavos && valorCentavos > 0) mudancas.valor = valorCentavos / 100
    if (e.data !== n.data) mudancas.data = n.data
    if (e.categoria_pluggy !== n.categoria_pluggy) mudancas.categoria_pluggy = n.categoria_pluggy
    if (n.forma === 'credito' && e.fatura !== n.fatura) mudancas.fatura = n.fatura
    if (n.forma === 'credito' && (e.parcela_atual !== n.parcela_atual || e.total_parcelas !== n.total_parcelas)) {
      mudancas.parcela_atual = n.parcela_atual
      mudancas.total_parcelas = n.total_parcelas
    }
    if (Object.keys(mudancas).length === 0) continue
    const { error } = await db.from('transacoes').update(mudancas).eq('id', e.id)
    if (error) falhas++
    else atualizadas++
  }

  let importadas = 0
  for (let i = 0; i < inserir.length; i += 200) {
    const lote = inserir.slice(i, i + 200)
    const { error } = await db.from('transacoes').upsert(lote, { onConflict: 'user_id,id_externo', ignoreDuplicates: true })
    if (!error) {
      importadas += lote.length
      continue
    }
    // Lote recusado: tenta uma a uma para salvar o que der
    for (const linha of lote) {
      const { error: e } = await db.from('transacoes').upsert(linha, { onConflict: 'user_id,id_externo', ignoreDuplicates: true })
      if (e) {
        falhas++
        console.error('Transação recusada', linha.id_externo, e.message)
      } else importadas++
    }
  }

  return { importadas, atualizadas, falhas, semVinculo, avisos }
}

// ===================== Investimentos =====================

/**
 * Posições de investimento de cada conexão. Conexão com conta da empresa: as posições são da empresa (ficam fora do
 * patrimônio pessoal). Grava também o saldo do dia, para a evolução. Pelo Open Finance a Pluggy não informa
 * rendimento: o app calcula pela variação do saldo.
 */
async function sincronizarInvestimentos(
  db: SupabaseClient,
  pluggy: Pluggy,
  userId: string,
  itemIds: string[],
  contasPluggy: ContaPluggy[],
  bancoDoItem: Map<string, string>,
) {
  const { data: contasApp, error } = await db
    .from('contas')
    .select('pluggy_account_id, empresarial')
    .eq('user_id', userId)
    .not('pluggy_account_id', 'is', null)
  if (error) throw error
  const empresarialPorConta = new Map(contasApp.map((c) => [c.pluggy_account_id as string, c.empresarial as boolean]))
  const itemDaEmpresa = (itemId: string) =>
    contasPluggy.some((c) => c.itemId === itemId && empresarialPorConta.get(c.id) === true)

  const linhas = []
  for (const itemId of itemIds) {
    const posicoes = await pluggy.investimentos(itemId).catch((e) => {
      // Banco que não compartilha investimentos (ou item sumido) não impede os outros
      if (e instanceof ErroPluggy && [400, 403, 404].includes(e.status)) return [] as InvestimentoPluggy[]
      throw e
    })
    for (const i of posicoes) {
      linhas.push({
        user_id: userId,
        origem: 'pluggy',
        id_externo: i.id,
        instituicao: bancoDoItem.get(itemId) ?? null,
        tipo: i.type,
        subtipo: i.subtype ?? null,
        nome: limpar(i.name) ?? 'Investimento',
        codigo: limpar(i.code),
        emissor: limpar(i.issuer),
        indexador: i.rateType ?? null,
        taxa: i.rate ?? null,
        taxa_anual_fixa: i.fixedAnnualRate ?? null,
        vencimento: i.dueDate ? diaLocal(i.dueDate) : null,
        quantidade: i.quantity ?? null,
        valor_aplicado: i.amountOriginal ?? null,
        saldo_bruto: i.amount ?? i.balance ?? 0,
        saldo_liquido: i.balance ?? null,
        empresarial: itemDaEmpresa(itemId),
        status: i.status ?? 'ACTIVE',
        atualizado_em: new Date().toISOString(),
      })
    }
  }
  if (linhas.length === 0) return 0

  const { data: gravados, error: e1 } = await db
    .from('investimentos')
    .upsert(linhas, { onConflict: 'user_id,id_externo' })
    .select('id, saldo_bruto, saldo_liquido')
  if (e1) throw e1
  const dia = diaFormatado.format(new Date())
  const { error: e2 } = await db.from('investimentos_historico').upsert(
    gravados.map((g) => ({
      investimento_id: g.id,
      user_id: userId,
      dia,
      saldo_bruto: g.saldo_bruto,
      saldo_liquido: g.saldo_liquido,
    })),
    { onConflict: 'investimento_id,dia' },
  )
  if (e2) throw e2
  return linhas.length
}

// ===================== Entrada =====================

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ erro: 'Use POST.' }, 405)

  const authorization = req.headers.get('Authorization') ?? ''
  const corpo = (await req.json().catch(() => ({}))) as { acao?: string; automatica?: boolean }
  const automatica = corpo.automatica === true
  const dono = Deno.env.get('PLUGGY_USER_ID')

  let db: SupabaseClient
  let usuario: { id: string }
  if (automatica) {
    if (!dono) return json({ erro: 'Falta o secret PLUGGY_USER_ID na função.' }, 400)
    db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
      auth: { persistSession: false },
    })
    usuario = { id: dono }
    const { data: ultima } = await db
      .from('sync_log')
      .select('data')
      .eq('user_id', dono)
      .order('data', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (ultima && Date.now() - new Date(ultima.data).getTime() < INTERVALO_MINIMO_MIN * 60_000) {
      return json({ status: 'recente', ultima: ultima.data })
    }
  } else {
    db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false },
    })
    const { data: auth } = await db.auth.getUser(authorization.replace(/^Bearer\s+/i, ''))
    if (!auth.user) return json({ erro: 'Faça login de novo.' }, 401)
    usuario = auth.user
    // As conexões são de uma pessoa só: nenhum outro usuário do app pode puxar esses dados
    if (usuario.id !== dono) {
      return json({ erro: 'Open Finance não está liberado para esta conta.', codigo: 'nao_liberado' }, 403)
    }
  }

  const itemIds = (Deno.env.get('PLUGGY_ITEM_IDS') ?? '').split(/[\s,;]+/).filter(Boolean)
  if (itemIds.length === 0) return json({ erro: 'Falta o secret PLUGGY_ITEM_IDS na função.', codigo: 'sem_conexoes' }, 400)

  const { acao = 'sincronizar' } = corpo

  try {
    const pluggy = await conectarPluggy()
    const { conexoes, contas, bancoDoItem, nomesDoDono } = await atualizarConexoes(db, pluggy, usuario.id, itemIds)
    if (acao === 'contas') return json({ conexoes })

    const r = await sincronizar(db, pluggy, usuario.id, contas, bancoDoItem, nomesDoDono, acao === 'reimportar')
    // Investimentos: se falhar, as transações já foram e a sincronização sai como parcial
    let avisoInvestimentos = ''
    await sincronizarInvestimentos(db, pluggy, usuario.id, itemIds, contas, bancoDoItem).catch((e) => {
      console.error('investimentos', e)
      avisoInvestimentos = `Investimentos: ${(e as { message?: string })?.message ?? 'erro'}`
    })
    const comProblema = conexoes.filter((c) => c.status !== 'UPDATED' && c.status !== 'UPDATING')
    const partes = [
      `${r.importadas} ${r.importadas === 1 ? 'nova' : 'novas'}`,
      `${r.atualizadas} ${r.atualizadas === 1 ? 'atualizada' : 'atualizadas'}`,
      r.falhas ? `${r.falhas} com erro` : '',
      r.semVinculo ? `${r.semVinculo} ${r.semVinculo === 1 ? 'conta sem vínculo' : 'contas sem vínculo'}` : '',
      ...comProblema.map((c) => `${c.banco}: ${c.erro ?? c.status}`),
      ...r.avisos,
      avisoInvestimentos,
    ].filter(Boolean)
    const status = r.falhas || comProblema.length || avisoInvestimentos ? 'parcial' : 'sucesso'
    const mensagem = partes.join('. ') + '.'

    await db
      .from('sync_log')
      .insert({ user_id: usuario.id, status, mensagem, importadas: r.importadas, atualizadas: r.atualizadas, automatica })
    // Avisa no celular o que entrou
    if (automatica && r.importadas > 0) {
      await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/notificar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: authorization },
        body: JSON.stringify({ apos_sync: true }),
      }).catch((e) => console.error('notificar', e))
    }
    return json({ status, mensagem, ...r })
  } catch (e) {
    // Erros do banco (PostgrestError) não são Error, mas têm message
    const mensagem = (e as { message?: string })?.message || 'Erro inesperado.'
    console.error('sync-pluggy', e)
    await db.from('sync_log').insert({ user_id: usuario.id, status: 'erro', mensagem, automatica })
    return json({ erro: mensagem }, 502)
  }
})
