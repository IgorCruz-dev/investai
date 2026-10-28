// Resumo para o widget do iPhone (Scriptable): saldo, teto e gasto de hoje, gasto do mês, próxima fatura e as 3
// últimas notícias. Autentica pelo header x-chave (a chave fica em widget_chaves só como hash SHA-256) e devolve só
// esses números; não dá acesso a mais nada da conta.
//
// Mesmas regras da Edge Function notificar: gasto pessoal (sem empresa, terceiros, transferências e pagamentos de
// fatura) e teto = o do bom dia de hoje.
import { createClient } from 'npm:@supabase/supabase-js@2'

const FUSO = 'America/Sao_Paulo'

const json = (corpo: unknown, status = 200) =>
  new Response(JSON.stringify(corpo), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })

const hojeEmBrasilia = () => new Intl.DateTimeFormat('en-CA', { timeZone: FUSO }).format(new Date())
const utc = (iso: string) => new Date(`${iso.slice(0, 10)}T12:00:00Z`)
const iso = (d: Date) => d.toISOString().slice(0, 10)
const ultimoDia = (ano: number, mes0: number) => new Date(Date.UTC(ano, mes0 + 1, 0)).getUTCDate()
const inicioDoMes = (dia: string, desloc = 0) => {
  const d = utc(dia)
  return iso(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + desloc, 1, 12)))
}
const diaNoMes = (inicio: string, dia: number) => {
  const d = utc(inicio)
  return iso(
    new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), Math.min(dia, ultimoDia(d.getUTCFullYear(), d.getUTCMonth())), 12)),
  )
}
const centavos = (x: number) => Math.round(Number(x) * 100)

async function sha256(texto: string) {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(texto)))
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
}

type Transacao = {
  data: string
  tipo: string
  forma: string
  valor: number
  conta_id: string | null
  cartao_id: string | null
  terceiro: string | null
  transferencia_interna: boolean
  pagamento_cartao_id: string | null
}

Deno.serve(async (req) => {
  const chave = req.headers.get('x-chave') ?? ''
  if (chave.length < 32) return json({ erro: 'Chave do widget faltando.' }, 401)

  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false },
  })
  try {
    const hash = await sha256(chave)
    const { data: dono } = await db.from('widget_chaves').select('user_id').eq('chave_hash', hash).maybeSingle()
    if (!dono) return json({ erro: 'Chave do widget inválida.' }, 401)
    const uid = dono.user_id
    const hoje = hojeEmBrasilia()
    const mes = inicioDoMes(hoje)

    const [contas, cartoes, transacoes, saldo, bomDia, noticias] = await Promise.all([
      db.from('contas').select('id, empresarial').eq('user_id', uid),
      db.from('cartoes').select('id, nome, dia_vencimento, empresarial').eq('user_id', uid),
      db
        .from('transacoes')
        .select('data, tipo, forma, valor, conta_id, cartao_id, terceiro, transferencia_interna, pagamento_cartao_id')
        .eq('user_id', uid)
        .gte('data', mes)
        .lte('data', hoje)
        .limit(5000),
      db.rpc('saldo_do_usuario', { p_user: uid, p_dia: hoje }),
      db.from('notificacoes_enviadas').select('dados').eq('user_id', uid).eq('chave', `bomdia:${hoje}`).maybeSingle(),
      db
        .from('noticias')
        .select('titulo, fonte, link')
        .order('criada_em', { ascending: false })
        .order('publicada_em', { ascending: false })
        .limit(3),
    ])

    const contasDaEmpresa = new Set((contas.data ?? []).filter((c) => c.empresarial).map((c) => c.id))
    const cartoesDaEmpresa = new Set((cartoes.data ?? []).filter((c) => c.empresarial).map((c) => c.id))
    const gastoEmCentavos = (t: Transacao) => {
      if ((t.conta_id && contasDaEmpresa.has(t.conta_id)) || (t.cartao_id && cartoesDaEmpresa.has(t.cartao_id))) return 0
      if (t.terceiro !== null) return 0
      if (t.tipo === 'despesa' && t.pagamento_cartao_id === null && !t.transferencia_interna) return centavos(t.valor)
      if (t.tipo === 'receita' && t.forma === 'credito') return -centavos(t.valor) // estorno no cartão
      return 0
    }
    const ts = (transacoes.data ?? []) as Transacao[]
    const gastoHoje = ts.filter((t) => t.data === hoje).reduce((s, t) => s + gastoEmCentavos(t), 0) / 100
    const gastoMes = ts.reduce((s, t) => s + gastoEmCentavos(t), 0) / 100

    // Próxima fatura pessoal a vencer, com o que falta pagar da minha parte (sem as compras de outras pessoas)
    let fatura: { cartao: string; valor: number; vencimento: string } | null = null
    for (const c of cartoes.data ?? []) {
      if (c.empresarial) continue
      let mesDaFatura = mes
      let vencimento = diaNoMes(mesDaFatura, c.dia_vencimento)
      if (vencimento < hoje) {
        mesDaFatura = inicioDoMes(hoje, 1)
        vencimento = diaNoMes(mesDaFatura, c.dia_vencimento)
      }
      const [compras, pagamentos] = await Promise.all([
        db.from('transacoes').select('valor, tipo, terceiro').eq('user_id', uid).eq('cartao_id', c.id).eq('fatura', mesDaFatura),
        db
          .from('transacoes')
          .select('valor')
          .eq('user_id', uid)
          .eq('pagamento_cartao_id', c.id)
          .eq('pagamento_fatura', mesDaFatura),
      ])
      const somar = (ts: { valor: number; tipo: string }[]) =>
        ts.reduce((s, t) => s + centavos(t.valor) * (t.tipo === 'despesa' ? 1 : -1), 0)
      const total = somar(compras.data ?? [])
      const minhaParte = somar((compras.data ?? []).filter((t) => !t.terceiro))
      const pago = (pagamentos.data ?? []).reduce((s, t) => s + centavos(t.valor), 0)
      // Só a minha parte, como no app: o pagamento abate primeiro a parte de outras pessoas
      const resta = Math.min(total - pago, minhaParte) / 100
      if (resta < 1) continue
      if (!fatura || vencimento < fatura.vencimento) fatura = { cartao: c.nome, valor: resta, vencimento }
    }

    await db.from('widget_chaves').update({ usada_em: new Date().toISOString() }).eq('chave_hash', hash)
    const teto = Number(bomDia.data?.dados?.teto)
    return json({
      atualizado_em: new Date().toISOString(),
      saldo: saldo.data === null || saldo.data === undefined ? null : Number(saldo.data),
      teto: Number.isFinite(teto) ? teto : null,
      gasto_hoje: gastoHoje,
      gasto_mes: gastoMes,
      fatura,
      noticias: noticias.data ?? [],
    })
  } catch (e) {
    console.error('widget', e)
    return json({ erro: (e as { message?: string })?.message || 'Erro inesperado.' }, 502)
  }
})
