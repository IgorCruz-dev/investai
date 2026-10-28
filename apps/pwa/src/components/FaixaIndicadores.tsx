import Esqueleto from './Esqueleto'
import { formatarMoeda } from '../lib/formatar'
import type { Expectativa, Indicador, Mercado } from '../services/mercado'

const percentual = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const pct = (v: number) => `${percentual.format(v)}%`
const dolar = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
  minimumFractionDigits: 2,
  maximumFractionDigits: 3,
})

/** Taxa ao ano → equivalente ao mês (juros compostos) */
const aoMes = (anual: number) => (Math.pow(1 + anual / 100, 1 / 12) - 1) * 100

type Cartao = { titulo: string; valor: string; detalhe: string | null; variacao: string | null }

/** Selic, CDI, IPCA e dólar com o que o mercado espera para o fim do ano (Focus) */
export default function FaixaIndicadores({ mercado, carregando }: { mercado: Mercado | null; carregando: boolean }) {
  if (carregando || !mercado) {
    return (
      <div className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Esqueleto key={i} className="h-24 rounded-[22px]" />
        ))}
      </div>
    )
  }

  const { indicadores: ind, expectativas } = mercado
  const ano = new Date().getFullYear()
  const focus = (indicador: string): Expectativa | undefined =>
    expectativas.find((e) => e.indicador === indicador && e.ano === ano)

  // Pontos percentuais para taxas; % para o dólar
  const deltaPP = (i: Indicador | undefined) => (i?.antes ? i.atual.valor - i.antes.valor : null)
  const textoPP = (d: number | null) =>
    d === null || Math.abs(d) < 0.005 ? null : `${d > 0 ? '+' : '−'}${percentual.format(Math.abs(d))} p.p. em 30 dias`

  const cartoes: Cartao[] = []
  if (ind.selic_meta) {
    const d = deltaPP(ind.selic_meta)
    const f = focus('Selic')
    cartoes.push({
      titulo: 'Selic',
      valor: `${pct(ind.selic_meta.atual.valor)} a.a.`,
      detalhe: f ? `Focus fim de ${ano}: ${pct(f.mediana)}` : null,
      variacao: textoPP(d),
    })
  }
  if (ind.cdi_anual) {
    cartoes.push({
      titulo: 'CDI',
      valor: `${pct(ind.cdi_anual.atual.valor)} a.a.`,
      detalhe: `≈ ${pct(aoMes(ind.cdi_anual.atual.valor))} ao mês`,
      variacao: null,
    })
  }
  if (ind.ipca_12m) {
    const d = deltaPP(ind.ipca_12m)
    const f = focus('IPCA')
    cartoes.push({
      titulo: 'IPCA 12 meses',
      valor: pct(ind.ipca_12m.atual.valor),
      detalhe: f ? `Focus ${ano}: ${pct(f.mediana)}` : null,
      variacao: d === null ? null : `${d > 0 ? '+' : '−'}${percentual.format(Math.abs(d))} p.p. no mês`,
    })
  }
  if (ind.dolar) {
    const { atual, antes } = ind.dolar
    const v = antes ? ((atual.valor - antes.valor) / antes.valor) * 100 : null
    const f = focus('Câmbio')
    cartoes.push({
      titulo: 'Dólar',
      valor: dolar.format(atual.valor),
      detalhe: f ? `Focus fim de ${ano}: ${formatarMoeda(f.mediana)}` : null,
      variacao: v === null ? null : `${v > 0 ? '+' : '−'}${percentual.format(Math.abs(v))}% em 30 dias`,
    })
  }

  return (
    <dl className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
      {cartoes.map((c) => (
        <div key={c.titulo} className="animate-surgir solido min-w-0 rounded-[22px] p-4">
          <dt className="text-xs text-texto-suave">{c.titulo}</dt>
          <dd className="numero mt-1 text-lg font-semibold">{c.valor}</dd>
          {c.variacao && <dd className="text-xs font-medium text-texto">{c.variacao}</dd>}
          {c.detalhe && <dd className="mt-0.5 text-xs text-texto-suave">{c.detalhe}</dd>}
        </div>
      ))}
    </dl>
  )
}
