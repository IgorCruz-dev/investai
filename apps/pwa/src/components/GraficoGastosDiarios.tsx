import { Area, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { formatarMoeda, formatarMoedaCompacta } from '../lib/formatar'
import type { PontoGasto } from '../lib/resumos'

type Props = {
  pontos: PontoGasto[]
  /** ex.: "outubro" */
  nomeMes: string
  /** ex.: "setembro" */
  nomeMesAnterior: string
}

// Mês selecionado em destaque (verde do app); mês anterior recua em cinza.
// O cinza tem contraste baixo com o fundo, por isso a legenda e a tabela abaixo sempre trazem os valores.
/*
 * Cores das marcas, validadas (não escolhidas a olho) com o validador de paleta
 * para o modo escuro: faixa de luminosidade, piso de croma, separação para
 * daltonismo (ΔE 28,6 no pior par em protanopia) e contraste contra a
 * superfície. Ouro e azul é o par mais seguro que existe para todos os tipos de
 * daltonismo.
 *
 * As marcas são um passo mais fundas que o ouro da interface (#d4af37): marca de
 * gráfico tem exigência de luminosidade que acento de interface não tem.
 *
 * Grade e eixo são recessivos de propósito, e o texto do eixo usa o token de
 * texto — rótulo é texto, não série.
 */
const COR_FOCO = '#a8871f'
const COR_REFERENCIA = '#5c7ce8'
const COR_GRADE = 'rgba(255, 255, 255, 0.07)'
const COR_TEXTO_EIXO = '#8a8a9a'
const COR_ATUAL = COR_FOCO
const COR_ANTERIOR = COR_REFERENCIA

function ChaveLinha({ cor }: { cor: string }) {
  return <span className="inline-block h-0.5 w-4 shrink-0 rounded-full" style={{ backgroundColor: cor }} />
}

/** Gastos acumulados dia a dia no mês, com o mês anterior para comparar o ritmo */
export default function GraficoGastosDiarios({ pontos, nomeMes, nomeMesAnterior }: Props) {
  const ultimoComLinha = [...pontos].reverse().find((p) => p.atual !== null)
  const ultimoDia = pontos.length
  const ticks = [1, 5, 10, 15, 20, 25].filter((d) => d < ultimoDia - 2).concat(ultimoDia)

  return (
    <div>
      {ultimoComLinha && (
        <p className="text-sm text-texto-suave">
          <span className="text-xl font-bold tracking-tight text-texto">{formatarMoeda(ultimoComLinha.atual ?? 0)}</span>{' '}
          até o dia {ultimoComLinha.dia}
          {ultimoComLinha.anterior !== null && (
            <>
              {' '}
              · {formatarMoeda(ultimoComLinha.anterior)} no mesmo dia de {nomeMesAnterior}
            </>
          )}
        </p>
      )}

      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-texto-suave" aria-hidden="true">
        <span className="flex items-center gap-1.5">
          <ChaveLinha cor={COR_ATUAL} />
          <span className="capitalize">{nomeMes}</span>
        </span>
        <span className="flex items-center gap-1.5">
          <ChaveLinha cor={COR_ANTERIOR} />
          <span className="capitalize">{nomeMesAnterior}</span>
        </span>
      </div>

      <div className="mt-2 h-56" role="img" aria-label={`Gráfico de gastos acumulados em ${nomeMes} comparado com ${nomeMesAnterior}. Os valores estão na tabela abaixo.`}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={pontos} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid vertical={false} stroke={COR_GRADE} />
            <XAxis
              dataKey="dia"
              ticks={ticks}
              tickLine={false}
              axisLine={{ stroke: COR_GRADE }}
              tick={{ fontSize: 12, fill: COR_TEXTO_EIXO }}
              tickMargin={6}
            />
            <YAxis
              width={64}
              tickLine={false}
              axisLine={false}
              tick={{ fontSize: 12, fill: COR_TEXTO_EIXO }}
              tickFormatter={(v: number) => formatarMoedaCompacta(v)}
            />
            <Tooltip
              cursor={{ stroke: 'rgba(212, 175, 55, 0.35)', strokeWidth: 1 }}
              content={({ active, label }) => {
                const ponto = active ? pontos.find((p) => p.dia === Number(label)) : undefined
                if (!ponto) return null
                return (
                  <div className="rounded-xl border border-borda bg-superficie px-3 py-2 text-sm shadow-lg">
                    <p className="text-xs text-texto-suave">Dia {ponto.dia}</p>
                    {ponto.atual !== null && (
                      <p className="mt-1 flex items-center gap-2">
                        <ChaveLinha cor={COR_ATUAL} />
                        <span className="font-semibold">{formatarMoeda(ponto.atual)}</span>
                        <span className="text-xs text-texto-suave capitalize">{nomeMes}</span>
                      </p>
                    )}
                    {ponto.anterior !== null && (
                      <p className="mt-1 flex items-center gap-2">
                        <ChaveLinha cor={COR_ANTERIOR} />
                        <span className="font-semibold">{formatarMoeda(ponto.anterior)}</span>
                        <span className="text-xs text-texto-suave capitalize">{nomeMesAnterior}</span>
                      </p>
                    )}
                  </div>
                )
              }}
            />
            <Line
              dataKey="anterior"
              type="linear"
              stroke={COR_ANTERIOR}
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              dot={false}
              activeDot={{ r: 4, stroke: '#fff', strokeWidth: 2 }}
              isAnimationActive={false}
            />
            <Area
              dataKey="atual"
              type="linear"
              stroke={COR_ATUAL}
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              fill={COR_ATUAL}
              fillOpacity={0.1}
              dot={false}
              activeDot={{ r: 4, stroke: '#fff', strokeWidth: 2 }}
              isAnimationActive={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      <details className="mt-3 text-sm">
        <summary className="cursor-pointer text-texto-suave hover:text-texto">Ver em tabela</summary>
        <div className="mt-2 max-h-64 overflow-y-auto rounded-lg border border-borda">
          <table className="w-full text-left tabular-nums">
            <thead className="sticky top-0 bg-superficie-2 text-xs text-texto-suave">
              <tr>
                <th className="px-3 py-2 font-medium">Dia</th>
                <th className="px-3 py-2 text-right font-medium capitalize">{nomeMes}</th>
                <th className="px-3 py-2 text-right font-medium capitalize">{nomeMesAnterior}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-borda">
              {pontos.map((p) => (
                <tr key={p.dia}>
                  <td className="px-3 py-1.5">{p.dia}</td>
                  <td className="px-3 py-1.5 text-right">{p.atual === null ? '—' : formatarMoeda(p.atual)}</td>
                  <td className="px-3 py-1.5 text-right">{p.anterior === null ? '—' : formatarMoeda(p.anterior)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  )
}
