import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { formatarMesAno, formatarMoeda, formatarMoedaCompacta } from '../lib/formatar'
import type { PontoCaixinha } from '../lib/caixinha'

// Uma série só: o título do card já diz o que é, então não tem legenda
/*
 * Cores das marcas, validadas (não escolhidas a olho) com o validador de paleta
 * para o modo escuro: faixa de luminosidade, piso de croma, separação para
 * daltonismo e contraste contra a superfície.
 *
 * As marcas são um passo mais fundas que o ouro da interface (#d4af37): marca de
 * gráfico tem exigência de luminosidade que acento de interface não tem.
 *
 * Grade e eixo são recessivos de propósito, e o texto do eixo usa o token de
 * texto — rótulo é texto, não série.
 */
const COR_FOCO = '#a8871f'
const COR_GRADE = 'rgba(255, 255, 255, 0.07)'
const COR_TEXTO_EIXO = '#8a8a9a'
const COR = COR_FOCO

const mesCurto = new Intl.DateTimeFormat('pt-BR', { month: 'short' })
const rotulo = (mes: Date) => {
  const texto = mesCurto.format(mes).replace('.', '')
  return texto.charAt(0).toUpperCase() + texto.slice(1)
}

/** Total guardado no fim de cada mês */
export default function GraficoCaixinha({ pontos }: { pontos: PontoCaixinha[] }) {
  const dados = pontos.map((p) => ({ ...p, rotulo: rotulo(p.mes), chave: `${p.mes.getFullYear()}-${p.mes.getMonth()}` }))

  return (
    <div>
      <div className="h-52" role="img" aria-label="Evolução do total guardado mês a mês. Os valores estão na tabela abaixo.">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={dados} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid vertical={false} stroke={COR_GRADE} />
            <XAxis
              dataKey="chave"
              tickFormatter={(_, i) => dados[i]?.rotulo ?? ''}
              tickLine={false}
              axisLine={{ stroke: COR_GRADE }}
              tick={{ fontSize: 12, fill: COR_TEXTO_EIXO }}
              tickMargin={6}
              interval="preserveStartEnd"
            />
            <YAxis
              width={60}
              tickLine={false}
              axisLine={false}
              tick={{ fontSize: 12, fill: COR_TEXTO_EIXO }}
              tickFormatter={(v: number) => formatarMoedaCompacta(v)}
            />
            <Tooltip
              cursor={{ stroke: 'rgba(212, 175, 55, 0.35)', strokeWidth: 1 }}
              content={({ active, label }) => {
                const ponto = active ? dados.find((d) => d.chave === label) : undefined
                if (!ponto) return null
                return (
                  <div className="rounded-xl border border-borda bg-superficie px-3 py-2 text-sm shadow-lg">
                    <p className="font-semibold">{formatarMoeda(ponto.total)}</p>
                    <p className="text-xs text-texto-suave">Fim de {formatarMesAno(ponto.mes).toLowerCase()}</p>
                  </div>
                )
              }}
            />
            <Area
              dataKey="total"
              type="linear"
              stroke={COR}
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              fill={COR}
              fillOpacity={0.1}
              dot={false}
              activeDot={{ r: 4, stroke: '#fff', strokeWidth: 2 }}
              isAnimationActive={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      <details className="mt-3 text-sm">
        <summary className="cursor-pointer text-texto-suave hover:text-texto">Ver em tabela</summary>
        <table className="mt-2 w-full text-left tabular-nums">
          <tbody className="divide-y divide-borda">
            {dados.map((d) => (
              <tr key={d.chave}>
                <td className="py-1.5">{formatarMesAno(d.mes)}</td>
                <td className="py-1.5 text-right">{formatarMoeda(d.total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  )
}
