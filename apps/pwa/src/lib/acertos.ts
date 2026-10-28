import { deISO, hojeISO, paraISO } from './datas'
import { mesDaFatura } from './fatura'
import type { AcertoPago, Cartao, Transacao } from '../types/financas'

export type AcertoPessoa = {
  pessoa: string
  /** O que paguei por ela (compras no meu cartão, Pix, parcelas...), menos estornos dessas compras */
  pagueiCentavos: number
  /** O que ela me mandou */
  recebiCentavos: number
  /** Positivo: ela me deve. Negativo: estou com dinheiro dela (mandou mais do que gastei por ela) */
  saldoCentavos: number
  /** Parcelas dela nas próximas faturas (depois da fatura aberta): ainda não entram no saldo */
  aVencerCentavos: number
  quantidade: number
}

const centavos = (valor: number) => Math.round(valor * 100)

/**
 * Lançamento que ainda não chegou: no crédito, o que cai numa fatura depois da que está aberta
 * hoje; fora dele, o que tem data depois de hoje.
 */
export function ehAVencer(t: Transacao, cartaoPorId: Map<string, Cartao>, hoje = new Date()) {
  const cartao = t.cartao_id ? cartaoPorId.get(t.cartao_id) : undefined
  if (t.forma === 'credito' && cartao && t.fatura) {
    return t.fatura > paraISO(mesDaFatura(hoje, cartao.dia_fechamento, cartao.dia_vencimento))
  }
  return t.data > hojeISO()
}

/**
 * Mês em que o lançamento entra no acerto: o mês que o pagamento acerta, a fatura em que a compra
 * cai (crédito) ou, no resto, a data. "2026-11"
 */
export function chaveDoMes(t: Transacao) {
  return (t.acerto_mes ?? (t.forma === 'credito' && t.fatura ? t.fatura : t.data)).slice(0, 7)
}

export type MesDoAcerto = {
  /** "2026-11" */
  chave: string
  /** Dia 1 do mês */
  mes: Date
  /** O que ela deve no mês: compras dela nas faturas que vencem no mês e outras contas pagas por ela */
  deveCentavos: number
  /** A parte do que ela deve que já chegou (fora as parcelas das próximas faturas) */
  chegouCentavos: number
  /** O que ela me mandou para acertar o mês */
  pagouCentavos: number
  /** O que ainda falta; zero no mês acertado à mão */
  faltaCentavos: number
  /** Acertado à mão (ela pagou por fora): o que faltava deixa de ser cobrado */
  pago: boolean
  /** Só tem parcelas de faturas que ainda não chegaram */
  aVencer: boolean
}

/**
 * Mês a mês de uma pessoa, do mais antigo para o mais recente. Compra no cartão conta no mês em que a
 * fatura vence; o que ela mandou, no mês que o pagamento acerta; o resto, no mês da data.
 */
export function acertoMesAMes(
  transacoes: Transacao[],
  pessoa: string,
  cartoes: Cartao[],
  pagos: AcertoPago[] = [],
): MesDoAcerto[] {
  const cartaoPorId = new Map(cartoes.map((c) => [c.id, c]))
  const mesesPagos = new Set(pagos.filter((p) => p.pessoa === pessoa).map((p) => p.mes.slice(0, 7)))
  const porMes = new Map<string, MesDoAcerto>()
  const doMes = (chave: string) =>
    porMes.get(chave) ?? {
      chave,
      mes: deISO(`${chave}-01`),
      deveCentavos: 0,
      chegouCentavos: 0,
      pagouCentavos: 0,
      faltaCentavos: 0,
      pago: mesesPagos.has(chave),
      aVencer: false,
    }

  for (const t of transacoes) {
    if (t.terceiro !== pessoa) continue
    const mes = doMes(chaveDoMes(t))
    // Despesa dela e estorno de uma compra dela mexem no que ela deve; o resto é dinheiro que ela mandou
    if (t.tipo === 'despesa' || t.forma === 'credito') {
      const valor = t.tipo === 'despesa' ? centavos(t.valor) : -centavos(t.valor)
      mes.deveCentavos += valor
      if (!ehAVencer(t, cartaoPorId)) mes.chegouCentavos += valor
    } else {
      mes.pagouCentavos += centavos(t.valor)
    }
    porMes.set(mes.chave, mes)
  }
  // Mês acertado à mão aparece mesmo sem lançamento nenhum
  for (const chave of mesesPagos) porMes.set(chave, doMes(chave))

  return [...porMes.values()]
    .map((mes) => ({
      ...mes,
      aVencer: mes.deveCentavos > 0 && mes.chegouCentavos <= 0,
      faltaCentavos: mes.pago ? 0 : Math.max(mes.deveCentavos - mes.pagouCentavos, 0),
    }))
    .sort((a, b) => a.chave.localeCompare(b.chave))
}

/** Junta os lançamentos de outras pessoas por pessoa; quem tem maior saldo (me deve mais) vem primeiro */
export function acertosPorPessoa(transacoes: Transacao[], cartoes: Cartao[], pagos: AcertoPago[] = []): AcertoPessoa[] {
  const pessoas = [...new Set(transacoes.map((t) => t.terceiro).filter((p): p is string => p !== null))]
  return pessoas
    .map((pessoa) => {
      const acerto: AcertoPessoa = {
        pessoa,
        pagueiCentavos: 0,
        recebiCentavos: 0,
        saldoCentavos: 0,
        aVencerCentavos: 0,
        quantidade: transacoes.filter((t) => t.terceiro === pessoa).length,
      }
      for (const mes of acertoMesAMes(transacoes, pessoa, cartoes, pagos)) {
        acerto.pagueiCentavos += mes.chegouCentavos
        acerto.recebiCentavos += mes.pagouCentavos
        acerto.aVencerCentavos += mes.deveCentavos - mes.chegouCentavos
        // No mês acertado à mão o que sobrava não é mais cobrado, mas o que ela pagou a mais continua dela
        const resto = mes.chegouCentavos - mes.pagouCentavos
        acerto.saldoCentavos += mes.pago ? Math.min(resto, 0) : resto
      }
      return acerto
    })
    .sort((a, b) => b.saldoCentavos - a.saldoCentavos)
}

/** "Mãe te deve R$ 50,00" / "Você está com R$ 30,00 da Mãe" / "Tudo acertado" */
export function frasesDoSaldo(a: AcertoPessoa) {
  if (a.saldoCentavos > 0) return { titulo: `${a.pessoa} te deve`, cor: 'text-receita' }
  if (a.saldoCentavos < 0) return { titulo: `Você está com dinheiro de ${a.pessoa}`, cor: 'text-despesa' }
  return { titulo: 'Tudo acertado', cor: 'text-texto-suave' }
}
