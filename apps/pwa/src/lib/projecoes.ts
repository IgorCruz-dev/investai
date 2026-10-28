// Projeção de quanto um dinheiro guardado rende, já descontando IR e custódia. Só conta, sem IA.
//
// As taxas futuras vêm do Focus (Selic esperada para o fim de cada ano); depois do último ano informado, repete o último.

export type Produto = 'cdb' | 'tesouro_selic' | 'lci' | 'poupanca'

export const PRODUTOS: { id: Produto; nome: string; detalhe: string }[] = [
  { id: 'cdb', nome: 'CDB 100% do CDI', detalhe: 'IR regressivo, liquidez diária' },
  { id: 'tesouro_selic', nome: 'Tesouro Selic', detalhe: 'IR regressivo + custódia B3 acima de R$ 10 mil' },
  { id: 'lci', nome: 'LCI/LCA 90% do CDI', detalhe: 'Isenta de IR, costuma ter carência' },
  { id: 'poupanca', nome: 'Poupança', detalhe: 'Isenta de IR, 0,5% ao mês com Selic acima de 8,5%' },
]

/** Selic (% ao ano) esperada para cada ano: { 2026: 13.75, 2027: 12, ... } */
export type SelicPorAno = Record<number, number>

// CDI anda colado na Selic, uns 0,10 p.p. abaixo
const CDI_MENOS_SELIC = 0.1
// Custódia do Tesouro Direto: 0,20% ao ano sobre o que passa de R$ 10 mil no Tesouro Selic
const CUSTODIA_ANUAL = 0.002
const ISENCAO_CUSTODIA = 10_000

/** Alíquota de IR pelo tempo aplicado (tabela regressiva da renda fixa) */
export function aliquotaIR(dias: number) {
  if (dias <= 180) return 0.225
  if (dias <= 360) return 0.2
  if (dias <= 720) return 0.175
  return 0.15
}

const mensal = (anualPct: number) => Math.pow(1 + anualPct / 100, 1 / 12) - 1

function selicNoAno(selic: SelicPorAno, ano: number) {
  const anos = Object.keys(selic)
    .map(Number)
    .sort((a, b) => a - b)
  if (anos.length === 0) return 0
  const ate = anos.filter((a) => a <= ano)
  return selic[ate.length ? ate[ate.length - 1] : anos[0]]
}

/** Rendimento bruto do produto no mês (fração), dado o ano */
function taxaDoMes(produto: Produto, selic: SelicPorAno, ano: number) {
  const s = selicNoAno(selic, ano)
  const cdi = s - CDI_MENOS_SELIC
  switch (produto) {
    case 'cdb':
      return mensal(cdi)
    case 'tesouro_selic':
      return mensal(s)
    case 'lci':
      return mensal(cdi * 0.9)
    case 'poupanca':
      // Regra da poupança: 0,5% ao mês se a Selic passa de 8,5%; senão 70% da Selic (TR ignorada)
      return s > 8.5 ? 0.005 : mensal(s * 0.7)
  }
}

export type PontoProjecao = { mes: number; aportado: number; bruto: number; liquido: number }

/**
 * Mês a mês: aplica o inicial no mês 0 e o aporte no fim de cada mês. Cada aporte é um lote com a própria idade,
 * porque o IR depende de há quanto tempo cada parte está aplicada. "liquido" = se resgatar tudo naquele mês.
 */
export function projetar(p: {
  produto: Produto
  inicial: number
  aporteMensal: number
  meses: number
  selic: SelicPorAno
  inicio?: Date
}): PontoProjecao[] {
  const inicio = p.inicio ?? new Date()
  const lotes: { aplicado: number; saldo: number; mesAplicado: number }[] = []
  if (p.inicial > 0) lotes.push({ aplicado: p.inicial, saldo: p.inicial, mesAplicado: 0 })
  const pontos: PontoProjecao[] = []
  let custodiaAcumulada = 0

  for (let m = 1; m <= p.meses; m++) {
    const ano = new Date(inicio.getFullYear(), inicio.getMonth() + m, 1).getFullYear()
    const taxa = taxaDoMes(p.produto, p.selic, ano)
    for (const l of lotes) l.saldo *= 1 + taxa
    if (p.aporteMensal > 0) lotes.push({ aplicado: p.aporteMensal, saldo: p.aporteMensal, mesAplicado: m })

    const bruto = lotes.reduce((s, l) => s + l.saldo, 0)
    if (p.produto === 'tesouro_selic') custodiaAcumulada += (Math.max(bruto - ISENCAO_CUSTODIA, 0) * CUSTODIA_ANUAL) / 12
    const isento = p.produto === 'lci' || p.produto === 'poupanca'
    const ir = isento
      ? 0
      : lotes.reduce((s, l) => s + Math.max(l.saldo - l.aplicado, 0) * aliquotaIR((m - l.mesAplicado) * 30), 0)
    pontos.push({
      mes: m,
      aportado: lotes.reduce((s, l) => s + l.aplicado, 0),
      bruto,
      liquido: bruto - ir - custodiaAcumulada,
    })
  }
  return pontos
}

/** Reserva de emergência: tantos meses do gasto médio */
export const MESES_DE_RESERVA = 6
export const metaDaReserva = (gastoMedioMensal: number, meses = MESES_DE_RESERVA) => gastoMedioMensal * meses

/** Quantos meses até juntar `meta` guardando `aporte` por mês (com rendimento); null se nunca chega */
export function mesesAte(meta: number, p: Omit<Parameters<typeof projetar>[0], 'meses'>, limite = 600) {
  if (meta <= p.inicial) return 0
  if (p.aporteMensal <= 0) return null
  const pontos = projetar({ ...p, meses: limite })
  const i = pontos.findIndex((x) => x.liquido >= meta)
  return i === -1 ? null : pontos[i].mes
}

/** Quanto guardar por mês para chegar na meta em tantos meses (busca binária em centavos sobre a projeção) */
export function aportePara(meta: number, meses: number, p: Omit<Parameters<typeof projetar>[0], 'meses' | 'aporteMensal'>) {
  if (meta <= p.inicial) return 0
  const chega = (centavos: number) => {
    const pontos = projetar({ ...p, aporteMensal: centavos / 100, meses })
    return (pontos[pontos.length - 1]?.liquido ?? 0) >= meta
  }
  let baixo = 0
  let alto = Math.ceil(((meta - p.inicial) / meses) * 100) + 100
  while (!chega(alto)) alto *= 2
  while (alto - baixo > 1) {
    const meio = Math.floor((baixo + alto) / 2)
    if (chega(meio)) alto = meio
    else baixo = meio
  }
  return alto / 100
}
