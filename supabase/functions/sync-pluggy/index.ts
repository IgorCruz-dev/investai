// Sincroniza contas, cartões e transações do Meu Pluggy (Open Finance, somente leitura).
//
// Secrets da função (nunca vão para o front):
//   PLUGGY_CLIENT_ID, PLUGGY_CLIENT_SECRET  credenciais da aplicação em dashboard.pluggy.ai
//   PLUGGY_ITEM_IDS                         ids das conexões do meu.pluggy.ai, separados por vírgula
//   PLUGGY_USER_ID                          id do usuário do app dono dessas conexões (só ele pode sincronizar)
//
// Corpo: { "acao": "contas" }       → atualiza status das conexões e a lista de contas da Pluggy
//        { "acao": "sincronizar" }  → isso + importa as transações (padrão)
//
// Roda com o login de quem chama: o RLS do banco vale para tudo o que a função lê e grava.
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2'

const PLUGGY = 'https://api.pluggy.ai'
const DIAS_PRIMEIRA_VEZ = 90
// Nas próximas vezes, volta alguns dias antes da última sincronização: pega compras que
// passaram de pendentes para lançadas e transações que o banco publicou atrasado
const DIAS_DE_FOLGA = 10
const FUSO = 'America/Sao_Paulo'

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
  date: string
  type?: 'DEBIT' | 'CREDIT'
  status?: string
  category?: string | null
  operationType?: string | null
  merchant?: { name?: string | null; businessName?: string | null } | null
  creditCardMetadata?: { installmentNumber?: number | null; totalInstallments?: number | null; billId?: string | null } | null
}

type FaturaPluggy = { id: string; dueDate: string }

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

const semAcento = (texto: string) => texto.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()

/** Nomes com que o banco aparece na descrição de um pagamento ("Nubank" também aparece como "Nu Pagamentos") */
function apelidosDoBanco(banco: string) {
  const palavra = semAcento(banco).split(/[^a-z0-9]+/).find((p) => p.length >= 3)
  if (!palavra) return []
  return palavra === 'nubank' ? ['nubank', 'nu pagamentos', 'nu pag'] : [palavra]
}

/**
 * Começo do nome do dono, para achar Pix/TED para si mesmo. O banco corta o nome
 * ("Ricardo Parise Macari"), então compara só as três primeiras palavras, até 18 letras.
 */
function comecoDoNome(nomeCompleto: string) {
  return semAcento(nomeCompleto).split(/\s+/).filter(Boolean).slice(0, 3).join(' ').slice(0, 18)
}

/** Nome do banco de uma conexão. Pelo Meu Pluggy o conector se chama "MeuPluggy": o banco sai do nome das contas */
function nomeDoBanco(conector: string, contas: ContaPluggy[]) {
  if (!/meu ?pluggy/i.test(conector)) return conector
  // Conta corrente primeiro: nome de cartão ("gold", "ELO MAIS") raramente diz o banco
  const nomes = [...contas.filter((c) => c.type === 'BANK'), ...contas.filter((c) => c.type !== 'BANK')].map((c) => c.name)
  for (const nome of nomes) {
    if (/nu pagamentos|nubank/i.test(nome)) return 'Nubank'
    const banco = nome.replace(/^banco\s+/i, '').split(/\s+-\s+|\s+s\.?\s?a\.?(\s|$)/i)[0].trim()
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

/** Fatura que um pagamento quita: a não paga cujo vencimento fica mais perto da data do pagamento */
function faturaDoPagamento(dia: string, cartao: Cartao, pagas: Set<string>) {
  const [ano, mes] = dia.split('-').map(Number)
  const alvo = Date.parse(`${dia}T12:00:00Z`)
  const candidatas = [-1, 0, 1].map((delta) => {
    const m = mes - 1 + delta
    const fatura = primeiroDoMes(ano, m)
    const [a, mm] = fatura.split('-').map(Number)
    const vencimento = Date.UTC(a, mm - 1, Math.min(cartao.dia_vencimento, ultimoDiaDoMes(a, mm - 1)), 12)
    return { fatura, distancia: Math.abs(vencimento - alvo) }
  })
  const livre = candidatas.filter((c) => !pagas.has(`${cartao.id}|${c.fatura}`)).sort((a, b) => a.distancia - b.distancia)[0]
  return livre?.fatura ?? null
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
      if (identidade?.fullName) nomesDoDono.add(comecoDoNome(identidade.fullName))
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
  const { error: e2 } = await db.from('pluggy_conexoes').delete().not('item_id', 'in', `(${itemIds.map((i) => `"${i}"`).join(',')})`)
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
) {
  const hoje = diaFormatado.format(new Date())

  const [ultimo, contasApp, cartoesApp, categorias, mapeamento, regras, ignoradas, pagamentos] = await Promise.all([
    db.from('sync_log').select('data').in('status', ['sucesso', 'parcial']).order('data', { ascending: false }).limit(1).maybeSingle(),
    db.from('contas').select('id, pluggy_account_id').not('pluggy_account_id', 'is', null),
    db.from('cartoes').select('id, nome, dia_fechamento, dia_vencimento, pluggy_account_id'),
    db.from('categorias').select('id, nome'),
    db.from('mapeamento_categorias').select('categoria_pluggy, categoria_id'),
    db.from('regras_categoria_local').select('local, categoria_id'),
    db.from('transacoes_ignoradas').select('id_externo'),
    db.from('transacoes').select('pagamento_cartao_id, pagamento_fatura, id_externo').not('pagamento_cartao_id', 'is', null),
  ])
  for (const r of [ultimo, contasApp, cartoesApp, categorias, mapeamento, regras, ignoradas, pagamentos]) if (r.error) throw r.error

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
  const jaIgnoradas = new Set(ignoradas.data!.map((i) => i.id_externo))
  // Faturas já pagas por outra transação (manual ou importada)
  const pagas = new Map(pagamentos.data!.map((p) => [`${p.pagamento_cartao_id}|${p.pagamento_fatura}`, p.id_externo]))

  /** Pix/TED de ou para o próprio nome: a outra ponta é outra conta da pessoa */
  const ehParaSiMesmo = (t: TransacaoPluggy) =>
    pareceTransferencia(t) && nomesDoDono.some((nome) => semAcento(t.description).includes(nome))

  /** Pix/TED para o banco de um cartão vinculado de outro banco (ex.: Nubank → Bradesco): é pagamento desse cartão */
  const pagaCartaoDeOutroBanco = (t: TransacaoPluggy, itemDaContaPagadora: string) =>
    pareceTransferencia(t) &&
    cartoesVinculados.some((c) => {
      const item = itemDoCartao.get(c.id)
      const banco = bancoDoItem.get(item ?? '')
      return item !== itemDaContaPagadora && banco && apelidosDoBanco(banco).some((a) => semAcento(t.description).includes(a))
    })

  const categoriaDe = (t: TransacaoPluggy, local: string | null) =>
    (local && porLocal.get(local.toLowerCase())) || (t.category && porCategoriaPluggy.get(t.category)) || outros

  const novas: Linha[] = []
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
    if (desdeUltima) {
      const { count, error } = await db
        .from('transacoes')
        .select('id', { count: 'exact', head: true })
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
      const valor = Math.round(Math.abs(t.amount) * 100) / 100
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
        // Pagamento de fatura: marca a fatura como paga e fica fora das despesas do mês
        const pagas_ = new Set([...pagas].filter(([, idExt]) => idExt !== t.id).map(([chave]) => chave))
        const alvo = cartaoDoPagamento(t, conta.itemId)
        const fatura = alvo ? faturaDoPagamento(data, alvo, pagas_) : null
        if (alvo && fatura) {
          pagas.set(`${alvo.id}|${fatura}`, t.id)
          novas.push({
            ...base,
            tipo: 'despesa',
            forma,
            conta_id: contaId!,
            local: `Fatura ${alvo.nome}`,
            categoria_id: null,
            pagamento_cartao_id: alvo.id,
            pagamento_fatura: fatura,
          })
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
        // Nem receita nem gasto: Pix para si mesmo (a Pluggy reconhece só alguns; o nome pega os outros),
        // caixinha, Pix no crédito e pagamento de cartão de outro banco
        transferencia_interna:
          t.category === 'Same person transfer' ||
          ehParaSiMesmo(t) ||
          RE_CAIXINHA.test(t.description) ||
          RE_PIX_NO_CREDITO.test(t.description) ||
          (!entrou && pagaCartaoDeOutroBanco(t, conta.itemId)),
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
      .in('id_externo', ids.slice(i, i + 200))
    if (error) throw error
    for (const e of data) existentes.set(e.id_externo!, e)
  }

  let atualizadas = 0
  let falhas = 0
  const inserir: Linha[] = []
  for (const n of novas) {
    const e = existentes.get(n.id_externo)
    if (!e) {
      inserir.push(n)
      continue
    }
    // Categoria, local, descrição e observação são do usuário: não mexe
    const mudancas: Record<string, unknown> = {}
    if (Number(e.valor) !== n.valor) mudancas.valor = n.valor
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

// ===================== Entrada =====================

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ erro: 'Use POST.' }, 405)

  const authorization = req.headers.get('Authorization') ?? ''
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false },
  })
  const { data: auth } = await db.auth.getUser(authorization.replace(/^Bearer\s+/i, ''))
  const usuario = auth.user
  if (!usuario) return json({ erro: 'Faça login de novo.' }, 401)
  // As conexões são de uma pessoa só: nenhum outro usuário do app pode puxar esses dados
  if (usuario.id !== Deno.env.get('PLUGGY_USER_ID')) {
    return json({ erro: 'Open Finance não está liberado para esta conta.', codigo: 'nao_liberado' }, 403)
  }

  const itemIds = (Deno.env.get('PLUGGY_ITEM_IDS') ?? '').split(/[\s,;]+/).filter(Boolean)
  if (itemIds.length === 0) return json({ erro: 'Falta o secret PLUGGY_ITEM_IDS na função.', codigo: 'sem_conexoes' }, 400)

  const { acao = 'sincronizar' } = (await req.json().catch(() => ({}))) as { acao?: string }

  try {
    const pluggy = await conectarPluggy()
    const { conexoes, contas, bancoDoItem, nomesDoDono } = await atualizarConexoes(db, pluggy, usuario.id, itemIds)
    if (acao === 'contas') return json({ conexoes })

    const r = await sincronizar(db, pluggy, usuario.id, contas, bancoDoItem, nomesDoDono)
    const comProblema = conexoes.filter((c) => c.status !== 'UPDATED' && c.status !== 'UPDATING')
    const partes = [
      `${r.importadas} ${r.importadas === 1 ? 'nova' : 'novas'}`,
      `${r.atualizadas} ${r.atualizadas === 1 ? 'atualizada' : 'atualizadas'}`,
      r.falhas ? `${r.falhas} com erro` : '',
      r.semVinculo ? `${r.semVinculo} ${r.semVinculo === 1 ? 'conta sem vínculo' : 'contas sem vínculo'}` : '',
      ...comProblema.map((c) => `${c.banco}: ${c.erro ?? c.status}`),
      ...r.avisos,
    ].filter(Boolean)
    const status = r.falhas || comProblema.length ? 'parcial' : 'sucesso'
    const mensagem = partes.join('. ') + '.'

    await db.from('sync_log').insert({ user_id: usuario.id, status, mensagem, importadas: r.importadas, atualizadas: r.atualizadas })
    return json({ status, mensagem, ...r })
  } catch (e) {
    // Erros do banco (PostgrestError) não são Error, mas têm message
    const mensagem = (e as { message?: string })?.message || 'Erro inesperado.'
    console.error('sync-pluggy', e)
    await db.from('sync_log').insert({ user_id: usuario.id, status: 'erro', mensagem })
    return json({ erro: mensagem }, 502)
  }
})
