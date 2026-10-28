// Notificações push. O pg_cron chama de hora em hora; fora das 8h às 22h (Brasília) não envia nada.
// A sync-pluggy automática chama com { apos_sync: true } depois de importar algo: o aviso sai na hora, mesmo fora da janela.
// Os crons notificar-noticias-*, notificar-mercado-* e notificar-radar chamam com { apos_coleta: '<fonte>' } 5 minutos
// depois de cada coleta, para o aviso de "dados atualizados" e as regras que dependem do que acabou de chegar.
//
// Para cada pessoa com aparelho inscrito, roda as regras abaixo e envia o que for novo. Cada aviso tem uma chave
// (ex.: fatura:<cartão>:<mês>:d3); a chave vai para notificacoes_enviadas antes do envio, então o mesmo aviso nunca
// sai duas vezes, mesmo com o cron rodando de hora em hora. Tipos que a pessoa desligou são pulados.
//
// Corpo:
//   {}                                  → roda para todo mundo (cron)
//   { teste: true }                     → manda uma notificação de teste para quem chamou (JWT do usuário)
//   { bom_dia: true }                   → só o "Bom dia" com saldo e teto do dia (cron das 7h45)
//   { apos_sync: true }                 → avisos do que a sincronização automática acabou de trazer
//   { apos_coleta: 'noticias' }         → aviso da coleta (noticias, mercado ou radar) e as regras ligadas a ela
//   { noite: true }                     → teto do dia estourado (cron das 21h30, depois da sync das 21h10)
//   { previa: true }                    → devolve os avisos que quem chamou receberia agora, sem enviar nem gravar
//
// Secret: VAPID_KEYS (JSON com publicKey e privateKey em JWK, gerado com @negrel/webpush)
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2'
import * as webpush from 'jsr:@negrel/webpush@0.5.0'

const FUSO = 'America/Sao_Paulo'
// "sub" do VAPID: os serviços de push usam para contatar o dono do servidor
const CONTATO = 'https://investai-two.vercel.app'
const MESES_DE_RESERVA = 6
const MARCOS_DA_RESERVA = [25, 50, 75, 100]
// Horários (Brasília) dos crons sync-pluggy-auto e sync-pluggy-noite, como [hora, minuto]. O Meu Pluggy atualiza os
// bancos uma vez a cada 24h (perto das 20h50 nas conexões atuais): a das 21h10 pega isso; as outras são de reserva.
const HORARIOS_DA_SYNC: [number, number][] = [
  [7, 0],
  [18, 0],
  [21, 10],
]

// Horários (Brasília) do noticias-sync: de 2 em 2 horas nos dias úteis, uma vez no fim de semana
const HORAS_DAS_NOTICIAS_UTIL = [8, 10, 12, 14, 16, 18, 20]
const HORAS_DAS_NOTICIAS_FDS = [11]
const RELEVANCIA_MINIMA = 0.9
const DIAS_DA_SEMANA = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado']

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const json = (corpo: unknown, status = 200) =>
  new Response(JSON.stringify(corpo), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

type Tipo =
  | 'fatura'
  | 'assinatura'
  | 'receita'
  | 'gasto_alto'
  | 'resumo_semanal'
  | 'fechamento'
  | 'acerto'
  | 'reserva'
  | 'radar'
  | 'tese'
  | 'dolar'
  | 'conexao'
  | 'ia'
  | 'sincronizacao'
  | 'bom_dia'
  | 'teto'
  | 'coleta'
  | 'fatura_fechou'
  | 'duplicada'
  | 'preco_assinatura'
  | 'nova_assinatura'
  | 'acerto_recebido'
  | 'sem_categoria'
  | 'selic'
  | 'noticia'

type Fonte = 'noticias' | 'mercado' | 'radar'
type Aviso = { tipo: Tipo; chave: string; titulo: string; corpo: string; url: string; dados?: Record<string, unknown> }

// ---------- datas no fuso de Brasília, como texto ISO ----------

function agora() {
  const partes = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: FUSO,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
      weekday: 'short',
    })
      .formatToParts(new Date())
      .map((p) => [p.type, p.value]),
  )
  return {
    hoje: `${partes.year}-${partes.month}-${partes.day}`,
    hora: Number(partes.hour),
    minuto: Number(partes.minute),
    semana: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(partes.weekday),
    domingo: partes.weekday === 'Sun',
    segunda: partes.weekday === 'Mon',
    sabado: partes.weekday === 'Sat',
  }
}

const utc = (iso: string) => new Date(`${iso.slice(0, 10)}T12:00:00Z`)
const iso = (d: Date) => d.toISOString().slice(0, 10)
const somarDias = (dia: string, n: number) => {
  const d = utc(dia)
  d.setUTCDate(d.getUTCDate() + n)
  return iso(d)
}
const diasEntre = (de: string, ate: string) => Math.round((utc(ate).getTime() - utc(de).getTime()) / 86_400_000)
const ultimoDia = (ano: number, mes0: number) => new Date(Date.UTC(ano, mes0 + 1, 0)).getUTCDate()
/** Primeiro dia do mês, deslocado em meses: "2026-10-27", 1 → "2026-11-01" */
const inicioDoMes = (dia: string, desloc = 0) => {
  const d = utc(dia)
  return iso(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + desloc, 1, 12)))
}
/** Dia do mês ajustado ao tamanho do mês (dia 31 em fevereiro vira 28/29) */
const diaNoMes = (inicio: string, dia: number) => {
  const d = utc(inicio)
  return iso(
    new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), Math.min(dia, ultimoDia(d.getUTCFullYear(), d.getUTCMonth())), 12)),
  )
}
const nomeDoMes = (inicio: string) => new Intl.DateTimeFormat('pt-BR', { month: 'long', timeZone: 'UTC' }).format(utc(inicio))
const diaMes = (dia: string) => `${dia.slice(8, 10)}/${dia.slice(5, 7)}`
/** Fatura (dia 1 do mês de vencimento) em que cai uma compra do dia; mesma regra de src/lib/fatura.ts */
const mesDaFatura = (dia: string, diaFechamento: number, diaVencimento: number) => {
  const d = utc(dia)
  const fechamento = Math.min(diaFechamento, ultimoDia(d.getUTCFullYear(), d.getUTCMonth()))
  const mesDoFechamento = d.getUTCDate() >= fechamento ? 1 : 0
  return inicioDoMes(dia, mesDoFechamento + (diaVencimento <= diaFechamento ? 1 : 0))
}
const horaMin = (h: number, m = 0) => `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
const recente = (iso: string, horas: number) => new Date(iso).getTime() >= Date.now() - horas * 3_600_000
/** Lançamento que acabou de chegar: importado nas últimas 26h e com data dos últimos 3 dias (o histórico antigo, importado
 * de uma vez, não conta) */
const chegou = (t: { criado_em: string; data: string }, hoje: string) => recente(t.criado_em, 26) && t.data >= somarDias(hoje, -3)

const reais = (x: number) => x.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const usd = (x: number) => x.toLocaleString('pt-BR', { style: 'currency', currency: 'USD' })
const pct = (x: number) => `${x.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`
const centavos = (x: number) => Math.round(Number(x) * 100)
const maiuscula = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

// ---------- mesmas regras de src/lib/resumos.ts ----------

type Transacao = {
  id: string
  data: string
  criado_em: string
  tipo: string
  forma: string
  valor: number
  local: string | null
  descricao: string | null
  categoria_id: string | null
  conta_id: string | null
  cartao_id: string | null
  terceiro: string | null
  emprestimo: boolean
  caixinha: boolean
  transferencia_interna: boolean
  pagamento_cartao_id: string | null
  assinatura_id: string | null
}

const ehGasto = (t: Transacao) =>
  t.tipo === 'despesa' && t.pagamento_cartao_id === null && !t.transferencia_interna && t.terceiro === null
const ehCreditoNoCartao = (t: Transacao) => t.tipo === 'receita' && t.forma === 'credito'
const gastoEmCentavos = (t: Transacao) =>
  ehGasto(t) ? centavos(t.valor) : ehCreditoNoCartao(t) && t.terceiro === null ? -centavos(t.valor) : 0
const receitaEmCentavos = (t: Transacao) => {
  if (t.tipo === 'receita' && !t.transferencia_interna && !ehCreditoNoCartao(t) && t.terceiro === null) return centavos(t.valor)
  if (t.caixinha) return t.tipo === 'receita' ? centavos(t.valor) : -centavos(t.valor)
  return 0
}

/** Saldo de cada pessoa nos acertos (mesma regra de src/lib/acertos.ts): positivo = ela me deve */
function acertosPorPessoa(transacoes: Transacao[], mesAtual: string) {
  const porPessoa = new Map<string, { saldo: number; ultimo: string }>()
  const emprestado = new Map<string, number>()
  const fecharMes = () => {
    for (const [pessoa, a] of porPessoa) {
      const doEmprestimo = emprestado.get(pessoa) ?? 0
      if (a.saldo - doEmprestimo >= 0) continue
      if (doEmprestimo === 0) porPessoa.delete(pessoa)
      else a.saldo = doEmprestimo
    }
  }
  let mesAberto: string | null = null
  for (const t of [...transacoes].sort((a, b) => a.data.localeCompare(b.data))) {
    if (!t.terceiro) continue
    const mes = t.data.slice(0, 7)
    if (mesAberto !== null && mes !== mesAberto && mesAberto < mesAtual) fecharMes()
    mesAberto = mes
    const a = porPessoa.get(t.terceiro) ?? { saldo: 0, ultimo: t.data }
    if (t.tipo === 'despesa') a.saldo += centavos(t.valor)
    else if (t.forma === 'credito') a.saldo -= centavos(t.valor)
    else a.saldo -= centavos(t.valor)
    a.ultimo = t.data
    if (t.emprestimo) {
      const sinal = t.tipo === 'despesa' ? 1 : -1
      emprestado.set(t.terceiro, (emprestado.get(t.terceiro) ?? 0) + sinal * centavos(t.valor))
    }
    porPessoa.set(t.terceiro, a)
  }
  if (mesAberto !== null && mesAberto < mesAtual) fecharMes()
  return porPessoa
}

// ---------- dados ----------

type Global = {
  dolar: { dia: string; valor: number }[]
  cotacoes: Map<string, number>
  sinais: { id: string; dia: string; titulo: string; classe: string | null }[]
  ia: { custo: number; limite: number } | null
  selic: { dia: string; valor: number }[]
  cdi: number | null
  ipca12m: number | null
  /** Notícias de relevância alta das últimas 24 horas */
  noticias: { id: string; titulo: string; fonte: string | null; criada_em: string }[]
  /** Notícias gravadas nos últimos 40 minutos (a coleta que acabou de rodar) */
  noticiasNovas: number
}

async function carregarGlobal(db: SupabaseClient, hoje: string): Promise<Global> {
  const mes = inicioDoMes(hoje)
  const serie = (nome: string, n: number) =>
    db.from('indicadores').select('dia, valor').eq('serie', nome).order('dia', { ascending: false }).limit(n)
  const [dolar, cotacoes, ultimoSinal, ia, selic, cdi, ipca, noticias, noticiasNovas] = await Promise.all([
    serie('dolar', 400),
    db.from('cotacoes').select('ticker, preco'),
    db.from('sinais').select('dia').order('dia', { ascending: false }).limit(1).maybeSingle(),
    db.from('ia_uso').select('custo_usd, limite_usd').eq('mes', mes).maybeSingle(),
    serie('selic_meta', 120),
    serie('cdi_anual', 1),
    serie('ipca_12m', 1),
    db
      .from('noticias')
      .select('id, titulo, fonte, criada_em')
      .gte('relevancia', RELEVANCIA_MINIMA)
      .gte('criada_em', new Date(Date.now() - 24 * 3_600_000).toISOString())
      .order('relevancia', { ascending: false }),
    db
      .from('noticias')
      .select('id', { count: 'exact', head: true })
      .gte('criada_em', new Date(Date.now() - 40 * 60_000).toISOString()),
  ])
  const sinais = ultimoSinal.data
    ? ((await db.from('sinais').select('id, dia, titulo, classe').eq('dia', ultimoSinal.data.dia).eq('origem', 'ia')).data ?? [])
    : []
  return {
    dolar: (dolar.data ?? []).map((d) => ({ dia: d.dia, valor: Number(d.valor) })),
    cotacoes: new Map((cotacoes.data ?? []).map((c) => [c.ticker, Number(c.preco)])),
    sinais,
    ia: ia.data ? { custo: Number(ia.data.custo_usd), limite: Number(ia.data.limite_usd ?? 2) } : null,
    selic: (selic.data ?? []).map((d) => ({ dia: d.dia, valor: Number(d.valor) })),
    cdi: cdi.data?.[0] ? Number(cdi.data[0].valor) : null,
    ipca12m: ipca.data?.[0] ? Number(ipca.data[0].valor) : null,
    noticias: noticias.data ?? [],
    noticiasNovas: noticiasNovas.count ?? 0,
  }
}

async function carregarPessoa(db: SupabaseClient, uid: string, hoje: string) {
  const desde = somarDias(inicioDoMes(hoje, -3), -1)
  const campos =
    'id, data, criado_em, tipo, forma, valor, local, descricao, categoria_id, conta_id, cartao_id, terceiro, emprestimo, caixinha, transferencia_interna, pagamento_cartao_id, assinatura_id'
  const [
    cartoes,
    contas,
    assinaturas,
    receitas,
    conexoes,
    investimentos,
    teses,
    transacoes,
    deTerceiros,
    categorias,
    perfil,
    syncs,
    saldo,
    todasAssinaturas,
    enviadas,
  ] = await Promise.all([
    db.from('cartoes').select('id, nome, dia_fechamento, dia_vencimento, empresarial').eq('user_id', uid),
    db.from('contas').select('id, empresarial').eq('user_id', uid),
    db
      .from('assinaturas')
      .select('id, nome, valor, dia_cobranca, cartao_id, ultimo_lancamento')
      .eq('user_id', uid)
      .eq('ativa', true),
    db.from('receitas_previstas').select('id, nome, valor, dia').eq('user_id', uid),
    db.from('pluggy_conexoes').select('item_id, banco, status, erro, consentimento_expira_em, verificado_em').eq('user_id', uid),
    db.from('investimentos').select('saldo_bruto, saldo_liquido, empresarial, status').eq('user_id', uid),
    db
      .from('teses')
      .select('id, titulo, ativo, direcao, preco_entrada, dia, prazo_dias, preco_final, resultado, fechada_em')
      .eq('user_id', uid),
    db.from('transacoes').select(campos).eq('user_id', uid).gte('data', desde).lte('data', hoje).limit(5000),
    db.from('transacoes').select(campos).eq('user_id', uid).not('terceiro', 'is', null).limit(5000),
    db.from('categorias').select('id, nome').eq('user_id', uid),
    db.from('perfis').select('nome').eq('id', uid).maybeSingle(),
    // Só a sincronização automática mais recente que trouxe novidade, das últimas 3 horas
    db
      .from('sync_log')
      .select('id, importadas, data')
      .eq('user_id', uid)
      .eq('automatica', true)
      .gt('importadas', 0)
      .gte('data', new Date(Date.now() - 3 * 3_600_000).toISOString())
      .order('data', { ascending: false })
      .limit(1),
    db.rpc('saldo_do_usuario', { p_user: uid, p_dia: hoje }),
    // Inclusive as pausadas: servem para não sugerir de novo uma assinatura que a pessoa já conhece
    db.from('assinaturas').select('nome, chave').eq('user_id', uid),
    // Avisos recentes cujos dados as regras consultam (teto do bom dia, notícias e cobranças já avisadas)
    db
      .from('notificacoes_enviadas')
      .select('tipo, chave, dados')
      .eq('user_id', uid)
      .in('tipo', ['bom_dia', 'noticia', 'nova_assinatura'])
      .gte('enviada_em', new Date(Date.now() - 120 * 86_400_000).toISOString()),
  ])
  const contasDaEmpresa = new Set((contas.data ?? []).filter((c) => c.empresarial).map((c) => c.id))
  const cartoesDaEmpresa = new Set((cartoes.data ?? []).filter((c) => c.empresarial).map((c) => c.id))
  const pessoal = (t: Transacao) =>
    !(t.conta_id && contasDaEmpresa.has(t.conta_id)) && !(t.cartao_id && cartoesDaEmpresa.has(t.cartao_id))
  return {
    cartoes: cartoes.data ?? [],
    assinaturas: assinaturas.data ?? [],
    receitas: receitas.data ?? [],
    conexoes: conexoes.data ?? [],
    investimentos: (investimentos.data ?? []).filter((i) => !i.empresarial && i.status !== 'TOTAL_WITHDRAWAL'),
    teses: teses.data ?? [],
    transacoes: ((transacoes.data ?? []) as Transacao[]).filter(pessoal),
    deTerceiros: (deTerceiros.data ?? []) as Transacao[],
    categorias: new Map((categorias.data ?? []).map((c) => [c.id, c.nome as string])),
    primeiroNome:
      String(perfil.data?.nome ?? '')
        .trim()
        .split(/\s+/)[0] ?? '',
    syncs: (syncs.data ?? []) as { id: string; importadas: number; data: string }[],
    saldo: saldo.data === null || saldo.data === undefined ? null : Number(saldo.data),
    assinaturasConhecidas: new Set(
      (todasAssinaturas.data ?? []).flatMap((a) => [a.chave, String(a.nome).toLowerCase().trim()]).filter(Boolean),
    ),
    enviadas: (enviadas.data ?? []) as { tipo: string; chave: string; dados: Record<string, unknown> | null }[],
  }
}

type Pessoa = Awaited<ReturnType<typeof carregarPessoa>>
type Contexto = {
  db: SupabaseClient
  uid: string
  hoje: string
  hora: number
  minuto: number
  semana: number
  domingo: boolean
  segunda: boolean
  sabado: boolean
  g: Global
  p: Pessoa
}

/** Gasto médio por mês nos últimos 3 meses fechados que têm lançamento (igual ao perfil financeiro do app) */
function gastoMedioMensal(c: Contexto) {
  const meses = [1, 2, 3].map((n) => inicioDoMes(c.hoje, -n))
  const porMes = meses
    .map((m) => c.p.transacoes.filter((t) => t.data.startsWith(m.slice(0, 7))))
    .filter((ts) => ts.length > 0)
    .map((ts) => ts.reduce((s, t) => s + gastoEmCentavos(t), 0) / 100)
  return porMes.length ? porMes.reduce((s, x) => s + x, 0) / porMes.length : 0
}

function reserva(c: Contexto) {
  const patrimonio = c.p.investimentos.reduce((s, i) => s + Number(i.saldo_liquido ?? i.saldo_bruto), 0)
  const meta = gastoMedioMensal(c) * MESES_DE_RESERVA
  return { patrimonio, meta, completa: meta > 0 && patrimonio >= meta }
}

// ---------- regras ----------

/**
 * O que falta pagar da minha parte da fatura, em reais: compras menos pagamentos, sem passar das compras que são minhas
 * (sem terceiro). Igual à tela do cartão: o pagamento abate primeiro a parte de outras pessoas.
 */
async function faltaPagar(c: Contexto, cartaoId: string, fatura: string) {
  const [compras, pagamentos] = await Promise.all([
    c.db.from('transacoes').select('valor, tipo, terceiro').eq('user_id', c.uid).eq('cartao_id', cartaoId).eq('fatura', fatura),
    c.db
      .from('transacoes')
      .select('valor')
      .eq('user_id', c.uid)
      .eq('pagamento_cartao_id', cartaoId)
      .eq('pagamento_fatura', fatura),
  ])
  const somar = (ts: { valor: number; tipo: string }[]) =>
    ts.reduce((s, t) => s + centavos(t.valor) * (t.tipo === 'despesa' ? 1 : -1), 0)
  const total = somar(compras.data ?? [])
  const minhaParte = somar((compras.data ?? []).filter((t) => !t.terceiro))
  const pago = (pagamentos.data ?? []).reduce((s, t) => s + centavos(t.valor), 0)
  return Math.min(total - pago, minhaParte) / 100
}

/** Fatura vencendo em 3 dias e no dia, com o que falta pagar */
async function faturas(c: Contexto): Promise<Aviso[]> {
  if (c.hora < 9) return []
  const avisos: Aviso[] = []
  for (const cartao of c.p.cartoes) {
    // Fatura que vence a seguir: a deste mês, se o vencimento ainda não passou; senão, a do mês que vem
    let fatura = inicioDoMes(c.hoje)
    let vencimento = diaNoMes(fatura, cartao.dia_vencimento)
    if (vencimento < c.hoje) {
      fatura = inicioDoMes(c.hoje, 1)
      vencimento = diaNoMes(fatura, cartao.dia_vencimento)
    }
    const faltam = diasEntre(c.hoje, vencimento)
    if (faltam !== 3 && faltam !== 0) continue

    const resta = await faltaPagar(c, cartao.id, fatura)
    if (resta < 1) continue
    avisos.push({
      tipo: 'fatura',
      chave: `fatura:${cartao.id}:${fatura}:d${faltam}`,
      titulo: faltam === 0 ? `Fatura do ${cartao.nome} vence hoje` : `Fatura do ${cartao.nome} vence em 3 dias`,
      corpo: faltam === 0 ? `Faltam pagar ${reais(resta)}.` : `${reais(resta)}, vencimento em ${diaMes(vencimento)}.`,
      url: `/cartoes/${cartao.id}`,
    })
  }
  return avisos
}

/** Assinaturas que cobram amanhã, juntas num aviso só */
function assinaturas(c: Contexto): Aviso[] {
  if (c.hora < 9) return []
  const amanha = somarDias(c.hoje, 1)
  const cobram = c.p.assinaturas.filter((a) => diaNoMes(inicioDoMes(amanha), a.dia_cobranca) === amanha)
  if (cobram.length === 0) return []
  const total = cobram.reduce((s, a) => s + Number(a.valor), 0)
  const lista = cobram.map((a) => `${a.nome} (${reais(Number(a.valor))})`)
  return [
    {
      tipo: 'assinatura',
      chave: `assinatura:${amanha}`,
      titulo: cobram.length === 1 ? `Amanhã cai ${cobram[0].nome}` : `Amanhã caem ${cobram.length} assinaturas`,
      corpo: cobram.length === 1 ? `${reais(total)} no dia ${diaMes(amanha)}.` : `${lista.join(', ')}. Total: ${reais(total)}.`,
      url: '/assinaturas',
    },
  ]
}

/** Entrou uma receita de valor parecido (±15%) desde uns dias antes do previsto, no mesmo mês? */
const receitaEntrou = (c: Contexto, valor: number, esperado: string) =>
  c.p.transacoes.some(
    (t) =>
      receitaEmCentavos(t) > 0 &&
      t.data >= somarDias(esperado, -5) &&
      t.data.startsWith(esperado.slice(0, 7)) &&
      Number(t.valor) >= valor * 0.85 &&
      Number(t.valor) <= valor * 1.15,
  )

/** Receita prevista que passou do dia e não entrou (procura um valor parecido desde uns dias antes) */
function receitasPrevistas(c: Contexto): Aviso[] {
  if (c.hora < 10) return []
  const mes = inicioDoMes(c.hoje)
  const avisos: Aviso[] = []
  for (const r of c.p.receitas) {
    const esperado = diaNoMes(mes, r.dia)
    const atraso = diasEntre(esperado, c.hoje)
    if (atraso < 1 || atraso > 4) continue
    const valor = Number(r.valor)
    if (receitaEntrou(c, valor, esperado)) continue
    avisos.push({
      tipo: 'receita',
      chave: `receita:${r.id}:${mes}`,
      titulo: `${r.nome} ainda não entrou`,
      corpo: `Estava previsto para o dia ${diaMes(esperado)}: ${reais(valor)}.`,
      url: '/dashboard',
    })
  }
  return avisos
}

/** Compra recém-importada bem acima do seu gasto médio por compra */
function gastosAltos(c: Contexto): Aviso[] {
  const limite = Date.now() - 26 * 3_600_000
  const recentes = c.p.transacoes.filter(
    (t) => ehGasto(t) && new Date(t.criado_em).getTime() >= limite && t.data >= somarDias(c.hoje, -3),
  )
  if (recentes.length === 0) return []
  const ids = new Set(recentes.map((t) => t.id))
  const antes = c.p.transacoes.filter((t) => ehGasto(t) && !ids.has(t.id))
  if (antes.length < 20) return [] // pouco histórico para saber o que é "fora do padrão"
  const media = antes.reduce((s, t) => s + Number(t.valor), 0) / antes.length
  const corte = Math.max(150, media * 3)
  return recentes
    .filter((t) => Number(t.valor) >= corte)
    .sort((a, b) => Number(b.valor) - Number(a.valor))
    .slice(0, 2)
    .map((t) => ({
      tipo: 'gasto_alto' as const,
      chave: `gasto:${t.id}`,
      titulo: `Gasto alto: ${reais(Number(t.valor))}${t.local ? ` em ${t.local}` : ''}`,
      corpo: `${(Number(t.valor) / media).toLocaleString('pt-BR', { maximumFractionDigits: 0 })}× o seu gasto médio por compra (${reais(media)}).`,
      url: '/lancamentos',
    }))
}

/** Domingo à noite: a semana, comparada com a anterior */
function resumoSemanal(c: Contexto): Aviso[] {
  if (!c.domingo || c.hora < 19) return []
  const soma = (de: string, ate: string) =>
    c.p.transacoes.filter((t) => t.data >= de && t.data <= ate).reduce((s, t) => s + gastoEmCentavos(t), 0) / 100
  const semana = soma(somarDias(c.hoje, -6), c.hoje)
  const anterior = soma(somarDias(c.hoje, -13), somarDias(c.hoje, -7))
  const noMes = soma(inicioDoMes(c.hoje), c.hoje)
  const porCategoria = new Map<string, number>()
  for (const t of c.p.transacoes) {
    if (t.data < somarDias(c.hoje, -6) || !ehGasto(t)) continue
    const nome = (t.categoria_id && c.p.categorias.get(t.categoria_id)) || 'Sem categoria'
    porCategoria.set(nome, (porCategoria.get(nome) ?? 0) + Number(t.valor))
  }
  const maior = [...porCategoria].sort((a, b) => b[1] - a[1])[0]
  const comparacao =
    anterior > 0 ? `${semana >= anterior ? '+' : '−'}${pct(Math.abs((semana / anterior - 1) * 100))} vs a semana passada. ` : ''
  return [
    {
      tipo: 'resumo_semanal',
      chave: `semana:${c.hoje}`,
      titulo: `Sua semana: ${reais(semana)} em gastos`,
      corpo: `${comparacao}${maior ? `Mais gasto: ${maior[0]} (${reais(maior[1])}). ` : ''}No mês: ${reais(noMes)}.`,
      url: '/dashboard',
    },
  ]
}

/** Começo do mês: como o anterior fechou e o próximo passo para a reserva */
function fechamento(c: Contexto): Aviso[] {
  const diaDoMes = Number(c.hoje.slice(8, 10))
  if (diaDoMes > 3 || c.hora < 10) return []
  const mes = inicioDoMes(c.hoje, -1)
  const doMes = c.p.transacoes.filter((t) => t.data.startsWith(mes.slice(0, 7)))
  if (doMes.length === 0) return []
  const sobra = doMes.reduce((s, t) => s + receitaEmCentavos(t) - gastoEmCentavos(t), 0) / 100
  const r = reserva(c)
  const passo =
    sobra > 0 && !r.completa && r.meta > 0
      ? ` Guardar na reserva aproxima a meta: faltam ${reais(r.meta - r.patrimonio)}.`
      : sobra < 0
        ? ' Vale olhar as maiores categorias do mês.'
        : ''
  return [
    {
      tipo: 'fechamento',
      chave: `fechamento:${mes}`,
      titulo:
        sobra >= 0
          ? `${maiuscula(nomeDoMes(mes))} fechou com sobra de ${reais(sobra)}`
          : `${maiuscula(nomeDoMes(mes))} fechou no vermelho em ${reais(-sobra)}`,
      corpo: `Receitas menos gastos pessoais do mês.${passo}`,
      url: '/comparativo',
    },
  ]
}

/** Segunda-feira: quem te deve há mais de uma semana sem movimento */
function acertos(c: Contexto): Aviso[] {
  if (!c.segunda || c.hora < 10) return []
  const avisos: Aviso[] = []
  for (const [pessoa, a] of acertosPorPessoa(c.p.deTerceiros, c.hoje.slice(0, 7))) {
    const parado = diasEntre(a.ultimo, c.hoje)
    if (a.saldo < 1000 || parado < 7) continue
    avisos.push({
      tipo: 'acerto',
      chave: `acerto:${pessoa}:${c.hoje}`,
      titulo: `${pessoa} te deve ${reais(a.saldo / 100)}`,
      corpo: `Sem movimento há ${parado} dias. Toque para ver o acerto.`,
      url: '/acertos',
    })
  }
  return avisos
}

/** Reserva de emergência: avisa o maior marco atingido (25, 50, 75, 100%), uma vez cada */
function marcosDaReserva(c: Contexto): Aviso[] {
  const r = reserva(c)
  if (r.meta <= 0 || r.patrimonio <= 0) return []
  const progresso = (r.patrimonio / r.meta) * 100
  const marco = [...MARCOS_DA_RESERVA].reverse().find((m) => progresso >= m)
  if (!marco) return []
  return [
    {
      tipo: 'reserva',
      chave: `reserva:${marco}`,
      titulo: marco === 100 ? 'Reserva de emergência completa! 🎉' : `Reserva de emergência em ${marco}%`,
      corpo:
        marco === 100
          ? `${reais(r.patrimonio)} guardados, ${MESES_DE_RESERVA} meses de gastos. O radar liberou as apostas táticas.`
          : `${reais(r.patrimonio)} de ${reais(r.meta)}. Faltam ${reais(r.meta - r.patrimonio)}.`,
      url: '/investimentos',
    },
  ]
}

/** Teses novas da IA que já valem para você (pós-fixado, ou qualquer uma com a reserva completa) */
function radar(c: Contexto): Aviso[] {
  const sinais = c.g.sinais.filter((s) => s.dia === c.hoje)
  if (sinais.length === 0 || c.hora < 20) return []
  const completa = reserva(c).completa
  const liberadas = sinais.filter((s) => s.classe === 'pos_fixado' || completa)
  if (liberadas.length === 0) return []
  return [
    {
      tipo: 'radar',
      chave: `radar:${c.hoje}`,
      titulo: liberadas.length === 1 ? 'Tese nova no radar' : `${liberadas.length} teses novas no radar`,
      corpo: liberadas.map((s) => s.titulo).join(' · '),
      url: '/investimentos',
    },
  ]
}

/** Fecha as teses que venceram (igual ao app) e avisa se acertaram */
async function teses(c: Contexto): Promise<Aviso[]> {
  const avisos: Aviso[] = []
  const precoEm = (ativo: string, dia: string) => {
    if (ativo === 'dolar') return c.g.dolar.find((d) => d.dia <= dia)?.valor ?? null
    return c.g.cotacoes.get(ativo.toUpperCase()) ?? null
  }
  const fmt = (ativo: string | null, x: number) =>
    ativo === 'dolar' ? reais(x) : x.toLocaleString('pt-BR', { maximumFractionDigits: 2 })
  for (const t of c.p.teses) {
    let { resultado, preco_final, fechada_em } = t
    if (!resultado && t.ativo && t.preco_entrada != null && t.prazo_dias && (t.direcao === 'alta' || t.direcao === 'baixa')) {
      const fim = somarDias(t.dia, t.prazo_dias)
      const final = fim <= c.hoje ? precoEm(t.ativo, fim) : null
      if (final !== null) {
        const subiu = final > Number(t.preco_entrada)
        resultado = (t.direcao === 'alta') === subiu ? 'acertou' : 'errou'
        preco_final = final
        fechada_em = fim
        await c.db.from('teses').update({ resultado, preco_final, fechada_em }).eq('id', t.id)
      }
    }
    if (!resultado || !fechada_em || diasEntre(fechada_em, c.hoje) > 3) continue
    avisos.push({
      tipo: 'tese',
      chave: `tese:${t.id}`,
      titulo: `Tese ${resultado === 'acertou' ? 'acertou ✅' : 'errou ❌'}: ${t.titulo}`,
      corpo:
        t.preco_entrada != null && preco_final != null
          ? `Entrada em ${fmt(t.ativo, Number(t.preco_entrada))}, no fim do prazo ${fmt(t.ativo, Number(preco_final))}.`
          : 'Veja no diário de teses.',
      url: '/investimentos',
    })
  }
  return avisos
}

/** Dólar com variação de 2% ou mais entre os dois últimos fechamentos */
function dolar(c: Contexto): Aviso[] {
  const [ultimo, anterior] = c.g.dolar
  if (!ultimo || !anterior || diasEntre(ultimo.dia, c.hoje) > 3) return []
  const variacao = (ultimo.valor / anterior.valor - 1) * 100
  if (Math.abs(variacao) < 2) return []
  return [
    {
      tipo: 'dolar',
      chave: `dolar:${ultimo.dia}`,
      titulo: `Dólar ${variacao > 0 ? 'subiu' : 'caiu'} ${pct(Math.abs(variacao))}`,
      corpo: `Fechou em ${reais(ultimo.valor)} no dia ${diaMes(ultimo.dia)}.`,
      url: '/investimentos',
    },
  ]
}

/** Consentimento do Open Finance acabando e sincronização com erro */
function conexoes(c: Contexto): Aviso[] {
  const avisos: Aviso[] = []
  for (const k of c.p.conexoes) {
    if (k.consentimento_expira_em) {
      const faltam = diasEntre(c.hoje, k.consentimento_expira_em.slice(0, 10))
      if (faltam >= 0 && faltam <= 7)
        avisos.push({
          tipo: 'conexao',
          chave: `conexao:${k.item_id}:${k.consentimento_expira_em.slice(0, 10)}`,
          titulo: faltam === 0 ? `Conexão com o ${k.banco} expira hoje` : `Conexão com o ${k.banco} expira em ${faltam} dias`,
          corpo: 'Renove na tela Bancos para não parar de sincronizar.',
          url: '/bancos',
        })
    }
    if (k.status !== 'UPDATED' && k.status !== 'UPDATING')
      avisos.push({
        tipo: 'conexao',
        chave: `conexao-erro:${k.item_id}:${String(k.verificado_em).slice(0, 10)}`,
        titulo: `A sincronização com o ${k.banco} parou`,
        corpo: 'Abra Bancos para reconectar. Até lá, os lançamentos novos não chegam.',
        url: '/bancos',
      })
  }
  return avisos
}

/** Gasto da IA no mês chegando no teto */
function ia(c: Contexto): Aviso[] {
  if (!c.g.ia || c.g.ia.limite <= 0) return []
  const { custo, limite } = c.g.ia
  const mes = inicioDoMes(c.hoje)
  if (custo >= limite)
    return [
      {
        tipo: 'ia',
        chave: `ia100:${mes}`,
        titulo: 'IA chegou no limite do mês',
        corpo: `${usd(custo)} de ${usd(limite)}. O radar segue só com os números até o mês virar.`,
        url: '/investimentos',
      },
    ]
  if (custo >= limite * 0.8)
    return [
      {
        tipo: 'ia',
        chave: `ia80:${mes}`,
        titulo: 'IA usou 80% do limite do mês',
        corpo: `${usd(custo)} de ${usd(limite)}. No limite, o radar segue só com os números.`,
        url: '/investimentos',
      },
    ]
  return []
}

/** Ids já avisados em avisos anteriores de um tipo (guardados em dados.ids) */
const jaAvisados = (c: Contexto, tipo: Tipo) =>
  new Set(c.p.enviadas.filter((e) => e.tipo === tipo).flatMap((e) => (e.dados?.ids as string[] | undefined) ?? []))

/** À noite, depois da última sincronização: o gasto de hoje passou do teto sugerido no bom dia? */
function tetoEstourado(c: Contexto): Aviso[] {
  if (c.hora < 21) return []
  const teto = Number(c.p.enviadas.find((e) => e.chave === `bomdia:${c.hoje}`)?.dados?.teto ?? 0)
  if (teto <= 0) return []
  const gasto = c.p.transacoes.filter((t) => t.data === c.hoje).reduce((s, t) => s + gastoEmCentavos(t), 0) / 100
  if (gasto <= teto) return []
  return [
    {
      tipo: 'teto',
      chave: `teto:${c.hoje}`,
      titulo: 'Passou do teto hoje 💸',
      corpo: `Gastou ${reais(gasto)}; a sugestão era ${reais(teto)}.\nO teto de amanhã já se ajusta a isso.`,
      url: '/lancamentos',
    },
  ]
}

/** Próximo horário do noticias-sync: "14:00", "amanhã, 08:00" ou "segunda, 08:00" */
function proximaBuscaDeNoticias(c: Contexto) {
  const horas = (dia: number) => (dia === 0 || dia === 6 ? HORAS_DAS_NOTICIAS_FDS : HORAS_DAS_NOTICIAS_UTIL)
  const hoje = horas(c.semana).find((h) => h * 60 > c.hora * 60 + c.minuto)
  if (hoje !== undefined) return horaMin(hoje)
  for (let n = 1; n <= 7; n++) {
    const dia = (c.semana + n) % 7
    const h = horas(dia)[0]
    if (h !== undefined) return `${n === 1 ? 'amanhã' : DIAS_DA_SEMANA[dia]}, ${horaMin(h)}`
  }
  return ''
}

/** Aviso de que uma coleta acabou de rodar, com o que ela trouxe */
function coleta(c: Contexto, fonte: Fonte): Aviso[] {
  if (fonte === 'noticias') {
    const n = c.g.noticiasNovas
    const altas = c.g.noticias.filter((x) => recente(x.criada_em, 40 / 60)).length
    return [
      {
        tipo: 'coleta',
        chave: `coleta:noticias:${c.hoje}:${c.hora}`,
        titulo: '📰 Notícias atualizadas',
        corpo: [
          n === 0 ? '• Nenhuma notícia nova' : `• ${n} ${n === 1 ? 'notícia nova' : 'notícias novas'}`,
          ...(altas ? [`• ${altas} de relevância alta`] : []),
          '',
          `Próxima busca: ${proximaBuscaDeNoticias(c)}`,
        ].join('\n'),
        url: '/investimentos',
      },
    ]
  }
  if (fonte === 'mercado') {
    const linhas = [
      c.g.dolar[0] ? `Dólar: ${reais(c.g.dolar[0].valor)}` : '',
      [c.g.selic[0] ? `Selic: ${pct(c.g.selic[0].valor)}` : '', c.g.cdi !== null ? `CDI: ${pct(c.g.cdi)}` : '']
        .filter(Boolean)
        .join(' · '),
      c.g.ipca12m !== null ? `IPCA 12 meses: ${pct(c.g.ipca12m)}` : '',
    ].filter(Boolean)
    return [
      {
        tipo: 'coleta',
        chave: `coleta:mercado:${c.hoje}:${c.hora}`,
        titulo: '🏦 Banco Central atualizado',
        corpo: [...linhas, '', `Próxima busca: ${c.hora < 20 ? '20:00' : 'amanhã, 20:00'}`].join('\n'),
        url: '/investimentos',
      },
    ]
  }
  const teses = c.g.sinais.filter((s) => s.dia === c.hoje).length
  return [
    {
      tipo: 'coleta',
      chave: `coleta:radar:${c.hoje}`,
      titulo: '🎯 Radar atualizado',
      corpo: [
        teses === 0 ? 'Sem teses novas da IA hoje.' : `${teses} ${teses === 1 ? 'tese nova' : 'teses novas'} da IA hoje.`,
        '',
        'Próxima: amanhã, 20:40',
      ].join('\n'),
      url: '/investimentos',
    },
  ]
}

/** Notícias de relevância 0,9 ou mais que ainda não foram avisadas, juntas num aviso só */
function noticiasImportantes(c: Contexto): Aviso[] {
  const avisadas = jaAvisados(c, 'noticia')
  const novas = c.g.noticias.filter((n) => !avisadas.has(n.id))
  if (novas.length === 0) return []
  const titulo = (n: (typeof novas)[number]) => (n.fonte ? `${n.titulo} (${n.fonte})` : n.titulo)
  return [
    {
      tipo: 'noticia',
      chave: `noticia:${novas[0].id}`,
      titulo: novas.length === 1 ? '📰 Notícia importante' : `📰 ${novas.length} notícias importantes`,
      corpo:
        novas.length === 1
          ? titulo(novas[0])
          : [...novas.slice(0, 3).map((n) => `• ${titulo(n)}`), ...(novas.length > 3 ? [`e mais ${novas.length - 3}`] : [])].join(
              '\n',
            ),
      url: '/investimentos',
      dados: { ids: novas.map((n) => n.id) },
    },
  ]
}

/** Copom mexeu na meta Selic nos últimos dias */
function selic(c: Contexto): Aviso[] {
  const [atual] = c.g.selic
  if (!atual) return []
  const i = c.g.selic.findIndex((s) => s.valor !== atual.valor)
  if (i <= 0) return []
  const antes = c.g.selic[i].valor
  const desde = c.g.selic[i - 1].dia // primeiro dia com a meta nova
  if (diasEntre(desde, c.hoje) > 5) return []
  const subiu = atual.valor > antes
  return [
    {
      tipo: 'selic',
      chave: `selic:${desde}`,
      titulo: `Selic ${subiu ? 'subiu' : 'caiu'} para ${pct(atual.valor)}`,
      corpo: `Era ${pct(antes)}. ${
        subiu
          ? 'Pós-fixados (CDI, Tesouro Selic) passam a render mais.'
          : 'Pós-fixados (CDI, Tesouro Selic) passam a render menos; prefixados ficam mais atrativos.'
      }`,
      url: '/investimentos',
    },
  ]
}

/** No dia do fechamento do cartão: quanto deu a fatura que acabou de fechar */
async function faturasFechadas(c: Contexto): Promise<Aviso[]> {
  if (c.hora < 10) return []
  const avisos: Aviso[] = []
  for (const cartao of c.p.cartoes) {
    if (diaNoMes(inicioDoMes(c.hoje), cartao.dia_fechamento) !== c.hoje) continue
    // Compras até ontem entram na fatura que fechou hoje
    const fatura = mesDaFatura(somarDias(c.hoje, -1), cartao.dia_fechamento, cartao.dia_vencimento)
    const resta = await faltaPagar(c, cartao.id, fatura)
    if (resta < 1) continue
    avisos.push({
      tipo: 'fatura_fechou',
      chave: `fatura-fechou:${cartao.id}:${fatura}`,
      titulo: `Fatura do ${cartao.nome} fechou`,
      corpo: `${reais(resta)} a pagar, vencimento em ${diaMes(diaNoMes(fatura, cartao.dia_vencimento))}.`,
      url: `/cartoes/${cartao.id}`,
    })
  }
  return avisos
}

/** Mesmo valor, no mesmo lugar e no mesmo dia, mais de uma vez (com pelo menos uma recém-importada) */
function cobrancasDuplicadas(c: Contexto): Aviso[] {
  const grupos = new Map<string, Transacao[]>()
  for (const t of c.p.transacoes) {
    if (!ehGasto(t) || !t.local?.trim() || Number(t.valor) < 5) continue
    const k = `${t.data}|${t.local.toLowerCase().trim()}|${centavos(t.valor)}`
    grupos.set(k, [...(grupos.get(k) ?? []), t])
  }
  return [...grupos.values()]
    .filter((g) => g.length >= 2 && g.some((t) => chegou(t, c.hoje)))
    .map((g) => {
      const [t] = [...g].sort((a, b) => a.id.localeCompare(b.id))
      return {
        tipo: 'duplicada' as const,
        chave: `duplicada:${t.id}`,
        titulo: `Cobrança duplicada? ${reais(Number(t.valor))} em ${t.local}`,
        corpo: `${g.length} cobranças iguais no dia ${diaMes(t.data)}. Confira se não é erro do estabelecimento.`,
        url: '/lancamentos',
      }
    })
}

/** Cobrança de assinatura com valor diferente da anterior */
function precosDeAssinatura(c: Contexto): Aviso[] {
  const avisos: Aviso[] = []
  for (const t of c.p.transacoes) {
    if (!t.assinatura_id || t.tipo !== 'despesa' || !chegou(t, c.hoje)) continue
    const anterior = c.p.transacoes
      .filter((x) => x.assinatura_id === t.assinatura_id && x.id !== t.id && x.data < t.data)
      .sort((a, b) => b.data.localeCompare(a.data))[0]
    if (!anterior) continue
    const de = Number(anterior.valor)
    const para = Number(t.valor)
    const diferenca = para - de
    if (Math.abs(diferenca) < 1 || Math.abs(diferenca) / de < 0.01) continue
    const nome = c.p.assinaturas.find((a) => a.id === t.assinatura_id)?.nome ?? t.local ?? 'Assinatura'
    avisos.push({
      tipo: 'preco_assinatura',
      chave: `preco:${t.id}`,
      titulo: `${nome} ${diferenca > 0 ? 'subiu' : 'baixou'} de preço`,
      corpo: `De ${reais(de)} para ${reais(para)} (${diferenca > 0 ? '+' : '−'}${pct((Math.abs(diferenca) / de) * 100)}).`,
      url: '/assinaturas',
    })
  }
  return avisos
}

/** Mesmo local cobrando um valor parecido uma vez por mês, 3 meses seguidos, sem estar em Assinaturas */
function possiveisAssinaturas(c: Contexto): Aviso[] {
  const porLocal = new Map<string, Transacao[]>()
  for (const t of c.p.transacoes) {
    if (!ehGasto(t) || t.assinatura_id || !t.local?.trim()) continue
    const k = t.local.toLowerCase().trim()
    if (c.p.assinaturasConhecidas.has(k)) continue
    porLocal.set(k, [...(porLocal.get(k) ?? []), t])
  }
  const avisadas = jaAvisados(c, 'nova_assinatura')
  const achadas: { chave: string; local: string; valor: number }[] = []
  for (const [k, ts] of porLocal) {
    if (avisadas.has(k)) continue
    const porMes = new Map<string, Transacao[]>()
    for (const t of ts) porMes.set(t.data.slice(0, 7), [...(porMes.get(t.data.slice(0, 7)) ?? []), t])
    // Três meses seguidos terminando neste mês ou no anterior (a deste mês pode ainda não ter caído)
    const seguidos = [0, -1].some((fim) =>
      [0, 1, 2].every((n) => porMes.get(inicioDoMes(c.hoje, fim - n).slice(0, 7))?.length === 1),
    )
    if (!seguidos) continue
    const valores = [...porMes.values()].flat().map((t) => Number(t.valor))
    const media = valores.reduce((s, v) => s + v, 0) / valores.length
    if (valores.some((v) => Math.abs(v - media) > media * 0.1)) continue
    const ultima = [...ts].sort((a, b) => b.data.localeCompare(a.data))[0]
    achadas.push({ chave: k, local: ultima.local!, valor: Number(ultima.valor) })
  }
  if (achadas.length === 0) return []
  return [
    {
      tipo: 'nova_assinatura',
      chave: `nova-assinatura:${achadas.map((a) => a.chave).join('|')}`.slice(0, 300),
      titulo:
        achadas.length === 1 ? `${achadas[0].local} parece uma assinatura` : `${achadas.length} cobranças parecem assinaturas`,
      corpo:
        achadas.length === 1
          ? `${reais(achadas[0].valor)} por mês nos últimos 3 meses. Cadastre em Assinaturas para entrar no teto e nos avisos.`
          : [
              ...achadas.slice(0, 5).map((a) => `• ${a.local} (${reais(a.valor)}/mês)`),
              ...(achadas.length > 5 ? [`e mais ${achadas.length - 5}`] : []),
            ].join('\n'),
      url: '/assinaturas',
      dados: { ids: achadas.map((a) => a.chave) },
    },
  ]
}

/** Alguém que te devia acabou de pagar */
function acertosRecebidos(c: Contexto): Aviso[] {
  const recebidos = c.p.deTerceiros.filter(
    (t) => t.terceiro && t.tipo === 'receita' && t.forma !== 'credito' && chegou(t, c.hoje),
  )
  if (recebidos.length === 0) return []
  const saldos = acertosPorPessoa(c.p.deTerceiros, c.hoje.slice(0, 7))
  return recebidos.map((t) => {
    const falta = (saldos.get(t.terceiro!)?.saldo ?? 0) / 100
    return {
      tipo: 'acerto_recebido' as const,
      chave: `acerto-recebido:${t.id}`,
      titulo: `${t.terceiro} te pagou ${reais(Number(t.valor))}`,
      corpo: falta < 0.01 ? 'Acerto zerado ✅' : `Ainda falta ${reais(falta)}.`,
      url: '/acertos',
    }
  })
}

/** Sábado de manhã: lançamentos dos últimos 30 dias ainda sem categoria */
function semCategoria(c: Contexto): Aviso[] {
  if (!c.sabado || c.hora < 10) return []
  const desde = somarDias(c.hoje, -30)
  const n = c.p.transacoes.filter((t) => t.data >= desde && !t.categoria_id && (ehGasto(t) || receitaEmCentavos(t) > 0)).length
  if (n < 5) return []
  return [
    {
      tipo: 'sem_categoria',
      chave: `sem-categoria:${c.hoje}`,
      titulo: `${n} lançamentos sem categoria`,
      corpo: 'Categorizar deixa o resumo da semana e o teto do dia mais certos.',
      url: '/lancamentos',
    },
  ]
}

/** Próximo horário da sync automática: "18:00" ou "amanhã, 07:00" */
function proximaSync(c: Contexto) {
  const agoraMin = c.hora * 60 + c.minuto
  const proximo = HORARIOS_DA_SYNC.find(([h, m]) => h * 60 + m > agoraMin)
  const fmt = ([h, m]: [number, number]) => horaMin(h, m)
  return proximo ? fmt(proximo) : `amanhã, ${fmt(HORARIOS_DA_SYNC[0])}`
}

/** Sincronização automática que trouxe lançamentos novos */
function sincronizacao(c: Contexto): Aviso[] {
  return c.p.syncs.map((s) => ({
    tipo: 'sincronizacao' as const,
    chave: `sync:${s.id}`,
    titulo: c.p.primeiroNome ? `Olá, ${c.p.primeiroNome}!` : 'Olá!',
    corpo: [
      'As transferências foram sincronizadas ✅',
      `• ${s.importadas} ${s.importadas === 1 ? 'novo registro adicionado' : 'novos registros adicionados'}`,
      '',
      `Próxima sinc: ${proximaSync(c)}`,
    ].join('\n'),
    url: '/lancamentos',
  }))
}

/**
 * Bom dia: saldo das contas pessoais e quanto dá para gastar hoje sem faltar até o fim do mês.
 * Teto = (saldo + receitas previstas que ainda não entraram − fixos no débito que ainda vão cair
 *         − minha parte das faturas pessoais que vencem até o fim do mês) ÷ dias que faltam, contando hoje.
 */
async function bomDia(c: Contexto): Promise<Aviso[]> {
  if (c.p.saldo === null) return []
  const mes = inicioDoMes(c.hoje)
  const fimDoMes = somarDias(inicioDoMes(c.hoje, 1), -1)
  const dias = diasEntre(c.hoje, fimDoMes) + 1

  const aReceber = c.p.receitas
    .map((r) => ({ valor: Number(r.valor), dia: diaNoMes(mes, r.dia) }))
    .filter((r) => r.dia >= c.hoje && !receitaEntrou(c, r.valor, r.dia))
    .reduce((s, r) => s + r.valor, 0)
  // No cartão, o fixo entra na fatura; aqui só os que saem direto da conta
  const fixos = c.p.assinaturas
    .filter((a) => !a.cartao_id && !(a.ultimo_lancamento && a.ultimo_lancamento >= mes))
    .filter((a) => diaNoMes(mes, a.dia_cobranca) >= c.hoje)
    .reduce((s, a) => s + Number(a.valor), 0)
  let faturas = 0
  for (const cartao of c.p.cartoes) {
    if (cartao.empresarial || diaNoMes(mes, cartao.dia_vencimento) < c.hoje) continue
    faturas += Math.max(await faltaPagar(c, cartao.id, mes), 0)
  }

  const livre = c.p.saldo + aReceber - fixos - faturas
  const teto = Math.max(livre / dias, 0)
  return [
    {
      tipo: 'bom_dia',
      chave: `bomdia:${c.hoje}`,
      titulo: 'Bom dia, Chefe! ☕️',
      corpo: [
        `O saldo de hoje é de ${reais(c.p.saldo)}`,
        `Sugestão de teto hoje: ${reais(teto)}`,
        ...(livre <= 0 ? ['As contas até o fim do mês já passam do saldo.'] : []),
      ].join('\n'),
      url: '/dashboard',
      dados: { teto: Math.round(teto * 100) / 100 },
    },
  ]
}

type Modo = 'hora' | 'bom_dia' | 'apos_sync' | 'apos_coleta' | 'noite' | 'previa'

/** O que acabou de chegar do banco */
const doQueEntrou = (c: Contexto) => [
  ...gastosAltos(c),
  ...cobrancasDuplicadas(c),
  ...precosDeAssinatura(c),
  ...acertosRecebidos(c),
]

async function avisosDe(c: Contexto, modo: Modo, fonte?: Fonte): Promise<Aviso[]> {
  if (modo === 'bom_dia') return bomDia(c)
  if (modo === 'apos_sync') return [...sincronizacao(c), ...doQueEntrou(c)]
  if (modo === 'noite') return tetoEstourado(c)
  if (modo === 'apos_coleta' && fonte) {
    const ligadas = fonte === 'noticias' ? noticiasImportantes(c) : fonte === 'mercado' ? [...dolar(c), ...selic(c)] : radar(c)
    return [...coleta(c, fonte), ...ligadas]
  }
  const listas = await Promise.all([
    faturas(c),
    assinaturas(c),
    receitasPrevistas(c),
    gastosAltos(c),
    resumoSemanal(c),
    fechamento(c),
    acertos(c),
    marcosDaReserva(c),
    radar(c),
    teses(c),
    dolar(c),
    conexoes(c),
    ia(c),
    sincronizacao(c),
    faturasFechadas(c),
    doQueEntrou(c).filter((a) => a.tipo !== 'gasto_alto'),
    possiveisAssinaturas(c),
    semCategoria(c),
    selic(c),
    noticiasImportantes(c),
    modo === 'previa' ? bomDia(c) : [],
    modo === 'previa' ? tetoEstourado(c) : [],
  ])
  return listas.flat()
}

// ---------- envio ----------

type Inscricao = { id: string; endpoint: string; p256dh: string; auth: string }

async function servidorDePush() {
  const chaves = Deno.env.get('VAPID_KEYS')
  if (!chaves) throw new Error('Falta o secret VAPID_KEYS.')
  const vapidKeys = await webpush.importVapidKeys(JSON.parse(chaves))
  return webpush.ApplicationServer.new({ contactInformation: CONTATO, vapidKeys })
}

/** Manda para todos os aparelhos da pessoa; aparelho que não existe mais (410) sai da lista */
async function enviar(
  db: SupabaseClient,
  servidor: webpush.ApplicationServer,
  inscricoes: Inscricao[],
  aviso: Pick<Aviso, 'titulo' | 'corpo' | 'url'> & { tag: string },
) {
  let enviados = 0
  for (const i of inscricoes) {
    try {
      await servidor
        .subscribe({ endpoint: i.endpoint, keys: { p256dh: i.p256dh, auth: i.auth } })
        .pushTextMessage(JSON.stringify(aviso), { ttl: 12 * 3600 })
      enviados++
    } catch (e) {
      if (e instanceof webpush.PushMessageError && e.isGone()) await db.from('push_inscricoes').delete().eq('id', i.id)
      else console.error('notificar: envio', e)
    }
  }
  return enviados
}

async function rodarPara(
  db: SupabaseClient,
  servidor: webpush.ApplicationServer,
  uid: string,
  inscricoes: Inscricao[],
  g: Global,
  modo: Modo,
  fonte?: Fonte,
) {
  const t = agora()
  const [pessoa, prefs] = await Promise.all([
    carregarPessoa(db, uid, t.hoje),
    db.from('notificacoes_preferencias').select('desligadas').eq('user_id', uid).maybeSingle(),
  ])
  const desligadas = new Set<string>(prefs.data?.desligadas ?? [])
  const avisos = (await avisosDe({ db, uid, ...t, g, p: pessoa }, modo, fonte)).filter((a) => !desligadas.has(a.tipo))
  if (avisos.length === 0) return 0

  // Grava antes de enviar: só sai o que ainda não estava no histórico
  const { data: novos, error } = await db
    .from('notificacoes_enviadas')
    .upsert(
      avisos.map((a) => ({ user_id: uid, ...a, dados: a.dados ?? null })),
      { onConflict: 'user_id,chave', ignoreDuplicates: true },
    )
    .select('chave')
  if (error) throw error
  const chaves = new Set((novos ?? []).map((n) => n.chave))
  let enviados = 0
  for (const a of avisos.filter((a) => chaves.has(a.chave))) {
    enviados += await enviar(db, servidor, inscricoes, { titulo: a.titulo, corpo: a.corpo, url: a.url, tag: a.chave })
  }
  return enviados
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ erro: 'Use POST.' }, 405)

  const corpo = await req.json().catch(() => ({}))
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false },
  })

  try {
    // Teste e prévia agem só sobre quem chamou, identificado pelo JWT
    if (corpo?.teste === true || corpo?.previa === true) {
      const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
      const { data: quem } = await db.auth.getUser(token)
      if (!quem.user) return json({ erro: 'Entre na sua conta para testar.' }, 401)
      const uid = quem.user.id

      if (corpo.previa === true) {
        const t = agora()
        const g = await carregarGlobal(db, t.hoje)
        // Prévia ignora o horário de cada regra, para mostrar tudo o que está valendo hoje
        const avisos = await avisosDe({ db, uid, ...t, hora: 21, g, p: await carregarPessoa(db, uid, t.hoje) }, 'previa')
        return json({ avisos })
      }

      const { data: inscricoes } = await db.from('push_inscricoes').select('id, endpoint, p256dh, auth').eq('user_id', uid)
      if (!inscricoes?.length) return json({ erro: 'Nenhum aparelho inscrito.' }, 400)
      const enviados = await enviar(db, await servidorDePush(), inscricoes, {
        titulo: 'Notificações ligadas ✅',
        corpo: 'É assim que os avisos do Profit vão chegar.',
        url: '/dashboard',
        tag: 'teste',
      })
      return json({ enviados })
    }

    const t = agora()
    const fonte = (['noticias', 'mercado', 'radar'] as const).find((f) => f === corpo?.apos_coleta)
    const modo: Modo =
      corpo?.bom_dia === true
        ? 'bom_dia'
        : corpo?.apos_sync === true
          ? 'apos_sync'
          : fonte
            ? 'apos_coleta'
            : corpo?.noite === true
              ? 'noite'
              : 'hora'
    if (modo === 'hora' && (t.hora < 8 || t.hora >= 22)) return json({ status: 'silencio', hora: t.hora })

    const { data: inscricoes, error } = await db.from('push_inscricoes').select('id, user_id, endpoint, p256dh, auth')
    if (error) throw error
    const porPessoa = new Map<string, Inscricao[]>()
    for (const i of inscricoes ?? []) porPessoa.set(i.user_id, [...(porPessoa.get(i.user_id) ?? []), i])
    if (porPessoa.size === 0) return json({ status: 'sem inscritos' })

    const [servidor, g] = await Promise.all([servidorDePush(), carregarGlobal(db, t.hoje)])
    let enviados = 0
    const erros: string[] = []
    for (const [uid, lista] of porPessoa) {
      try {
        enviados += await rodarPara(db, servidor, uid, lista, g, modo, fonte)
      } catch (e) {
        console.error('notificar', uid, e)
        erros.push((e as { message?: string })?.message ?? 'erro')
      }
    }
    return json({ status: erros.length ? 'parcial' : 'sucesso', pessoas: porPessoa.size, enviados, erros })
  } catch (e) {
    const mensagem = (e as { message?: string })?.message || 'Erro inesperado.'
    console.error('notificar', e)
    return json({ erro: mensagem }, 502)
  }
})
