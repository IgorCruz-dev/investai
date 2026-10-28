import { deISO, inicioDoMes, paraISO, somarMeses } from './datas'
import { mesDaFatura } from './fatura'
import { formatarNomeDoMes } from './formatar'
import type { Assinatura, Cartao } from '../types/financas'

const mesesEntre = (de: Date, ate: Date) => (ate.getFullYear() - de.getFullYear()) * 12 + ate.getMonth() - de.getMonth()

export type CobrancaPrevista = { assinatura: Assinatura; data: Date }

/**
 * O que estava previsto sair no mês com assinaturas (já cobradas ou não), no dia da cobrança: a linha "previsto" do gráfico.
 * Entra a que foi cobrada no mês e a ativa que já existia nele (desde a primeira cobrança) e, se parcelada, ainda tinha parcela.
 * As de cartão da empresa ficam de fora.
 */
export function cobrancasPlanejadasDoMes(
  assinaturas: Assinatura[],
  datas: Map<string, string[]>,
  cartoes: Cartao[],
  mes: Date,
): CobrancaPrevista[] {
  const cartaoPorId = new Map(cartoes.map((c) => [c.id, c]))
  const chaveDoMes = paraISO(mes).slice(0, 7)
  const planejadas: CobrancaPrevista[] = []
  for (const a of assinaturas) {
    const cartao = a.cartao_id ? cartaoPorId.get(a.cartao_id) : undefined
    if ((a.cartao_id && !cartao) || cartao?.empresarial) continue
    const cobradas = datas.get(a.id) ?? []
    const cobradaNoMes = cobradas.some((d) => d.startsWith(chaveDoMes))
    const inicio = cobradas.length ? inicioDoMes(deISO(cobradas[0])) : inicioDoMes(new Date(a.criado_em))
    const existia = a.ativa && mes >= inicio && (!a.total_parcelas || mesesEntre(inicio, mes) + 1 <= a.total_parcelas)
    if (!cobradaNoMes && !existia) continue
    planejadas.push({ assinatura: a, data: dataDeCobranca(mes, a.dia_cobranca) })
  }
  return planejadas.sort((x, y) => x.data.getTime() - y.data.getTime())
}

/**
 * Cobranças de assinaturas que ainda vão pesar no caixa do mês: as de conta no próprio mês e as de cartão que caem na
 * fatura que vence nele. Só do mês atual em diante, só o que ainda não foi cobrado e só parcela que ainda existe.
 * As de cartão da empresa ficam de fora.
 * porData: em vez de onde pesa no caixa, as que são cobradas dentro do mês (cartão incluso), para o calendário.
 */
export function cobrancasPrevistasDoMes(
  assinaturas: Assinatura[],
  cobrancas: Map<string, number>,
  cartoes: Cartao[],
  mes: Date,
  { hoje = new Date(), porData = false }: { hoje?: Date; porData?: boolean } = {},
): CobrancaPrevista[] {
  const cartaoPorId = new Map(cartoes.map((c) => [c.id, c]))
  const mesDeHoje = inicioDoMes(hoje)
  const previstas: CobrancaPrevista[] = []
  for (const a of assinaturas) {
    if (!a.ativa) continue
    const cartao = a.cartao_id ? cartaoPorId.get(a.cartao_id) : undefined
    if ((a.cartao_id && !cartao) || cartao?.empresarial) continue
    const ultimo = a.ultimo_lancamento ? inicioDoMes(deISO(a.ultimo_lancamento)) : null
    const pagas = cobrancas.get(a.id) ?? 0
    // No cartão, a cobrança do mês anterior pode cair na fatura que vence neste mês
    for (const deslocamento of cartao && !porData ? [-1, 0] : [0]) {
      const doMes = somarMeses(mes, deslocamento)
      if (doMes < mesDeHoje) continue
      if (ultimo && ultimo >= doMes) continue // já cobrada
      if (a.total_parcelas && pagas + (ultimo ? mesesEntre(ultimo, doMes) : 1) > a.total_parcelas) continue
      const data = dataDeCobranca(doMes, a.dia_cobranca)
      if (cartao && !porData && mesDaFatura(data, cartao.dia_fechamento, cartao.dia_vencimento).getTime() !== mes.getTime())
        continue
      previstas.push({ assinatura: a, data })
    }
  }
  return previstas.sort((x, y) => x.data.getTime() - y.data.getTime())
}

/** Em que parcela está e quando termina; null para as que não têm fim */
export function andamentoDasParcelas(assinatura: Assinatura, pagas: number) {
  if (!assinatura.total_parcelas) return null
  const total = assinatura.total_parcelas
  const quitada = pagas >= total
  // Última cobrança: a partir da mais recente, soma os meses que faltam
  const base = assinatura.ultimo_lancamento ? inicioDoMes(deISO(assinatura.ultimo_lancamento)) : inicioDoMes()
  const fim = somarMeses(base, Math.max(total - pagas, 0))
  const fimTexto = `${formatarNomeDoMes(fim).slice(0, 3)}/${fim.getFullYear()}`
  return { pagas: Math.min(pagas, total), total, quitada, fimTexto }
}

/** Dia da cobrança num mês; se o mês for mais curto (ex.: dia 31 em abril), usa o último dia */
export function dataDeCobranca(mes: Date, diaCobranca: number) {
  const ultimoDia = new Date(mes.getFullYear(), mes.getMonth() + 1, 0).getDate()
  return new Date(mes.getFullYear(), mes.getMonth(), Math.min(diaCobranca, ultimoDia))
}

function semHora(data: Date) {
  return new Date(data.getFullYear(), data.getMonth(), data.getDate())
}

/** A cobrança deste mês já foi lançada? (mesma regra da função lancar_assinaturas_pendentes) */
export function jaLancadaNoMes(assinatura: Pick<Assinatura, 'ultimo_lancamento'>, hoje = new Date()) {
  return assinatura.ultimo_lancamento !== null && deISO(assinatura.ultimo_lancamento) >= inicioDoMes(hoje)
}

/** Próxima cobrança ainda não lançada: a deste mês, se ainda não passou; senão a do mês que vem */
export function proximaCobranca(assinatura: Assinatura, hoje = new Date()) {
  const deste = dataDeCobranca(hoje, assinatura.dia_cobranca)
  if (!jaLancadaNoMes(assinatura, hoje) && deste >= semHora(hoje)) return deste
  return dataDeCobranca(new Date(hoje.getFullYear(), hoje.getMonth() + 1, 1), assinatura.dia_cobranca)
}

/** Dias inteiros de hoje até a data (0 = hoje) */
export function diasAte(data: Date, hoje = new Date()) {
  return Math.round((semHora(data).getTime() - semHora(hoje).getTime()) / 86_400_000)
}

export function textoDiasAte(dias: number) {
  if (dias <= 0) return 'Cobra hoje'
  if (dias === 1) return 'Cobra amanhã'
  return `Cobra em ${dias} dias`
}
