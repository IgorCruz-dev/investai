import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { formatarMesAno, formatarMoeda, formatarMoedaCompacta, formatarNomeDoMes } from '../lib/formatar'
import { variacaoPercentual } from '../lib/resumos'
import { IconeSetaBaixo, IconeSetaCima } from './icones'

export type BarraFatura = {
  /** Dia 1 do mês de vencimento */
  mes: Date
  centavos: number
  selecionada: boolean
}

type Props = {
  barras: BarraFatura[]
  aoEscolher: (mes: Date) => void
}

// Fatura escolhida em destaque (verde do app); as outras recuam em cinza.
// O cinza tem contraste baixo, por isso a tabela abaixo traz os mesmos valores.
const COR_DESTAQUE = '#059669'
const COR_OUTRAS = '#cbd5e1'
const COR_GRADE = '#e2e8f0'
const COR_TEXTO_EIXO = '#64748b'

const mesCurto = new Intl.DateTimeFormat('pt-BR', { month: 'short' })
const rotulo = (mes: Date) => {
  const texto = mesCurto.format(mes).replace('.', '')
  return texto.charAt(0).toUpperCase() + texto.slice(1)
}

/** Barras com o total das últimas faturas do cartão, comparando a escolhida com a anterior */
export default function GraficoFaturas({ barras, aoEscolher }: Props) {
  const dados = barras.map((b) => ({ ...b, rotulo: rotulo(b.mes), valor: b.centavos / 100 }))
  const indice = dados.findIndex((d) => d.selecionada)
  const atual = dados[indice]
  const anterior = indice > 0 ? dados[indice - 1] : undefined
  const variacao = atual && anterior ? variacaoPercentual(atual.valor, anterior.valor) : null

  return (
    <div>
      {atual && anterior && (
        <p className="flex flex-wrap items-center gap-x-1.5 text-sm text-texto-suave">
          {variacao === null ? (
            <span>Sem fatura em {formatarNomeDoMes(anterior.mes)} para comparar</span>
          ) : variacao === 0 ? (
            <span>Igual a {formatarNomeDoMes(anterior.mes)}</span>
          ) : (
            <>
              <span className={`flex items-center gap-0.5 font-semibold ${variacao > 0 ? 'text-despesa' : 'text-receita'}`}>
                {variacao > 0 ? <IconeSetaCima className="h-4 w-4" /> : <IconeSetaBaixo className="h-4 w-4" />}
                {variacao > 0 ? '+' : '−'}
                {Math.abs(variacao)}%
              </span>
              <span>
                vs {formatarNomeDoMes(anterior.mes)} ({formatarMoeda(anterior.valor)})
              </span>
            </>
          )}
        </p>
      )}

      <div className="mt-3 h-52" role="img" aria-label="Gráfico com o total das últimas faturas. Os valores estão na tabela abaixo.">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={dados} margin={{ top: 8, right: 4, bottom: 0, left: 0 }}>
            <CartesianGrid vertical={false} stroke={COR_GRADE} />
            <XAxis
              dataKey="rotulo"
              tickLine={false}
              axisLine={{ stroke: COR_GRADE }}
              tick={{ fontSize: 12, fill: COR_TEXTO_EIXO }}
              tickMargin={6}
            />
            <YAxis
              width={60}
              tickLine={false}
              axisLine={false}
              tick={{ fontSize: 12, fill: COR_TEXTO_EIXO }}
              tickFormatter={(v: number) => formatarMoedaCompacta(v)}
            />
            <Tooltip
              cursor={{ fill: '#f1f5f9' }}
              content={({ active, label }) => {
                const d = active ? dados.find((x) => x.rotulo === label) : undefined
                if (!d) return null
                return (
                  <div className="rounded-xl border border-borda bg-white px-3 py-2 text-sm shadow-lg">
                    <p className="font-semibold">{formatarMoeda(d.valor)}</p>
                    <p className="text-xs text-texto-suave">Fatura de {formatarMesAno(d.mes).toLowerCase()}</p>
                  </div>
                )
              }}
            />
            <Bar
              dataKey="valor"
              maxBarSize={36}
              radius={[4, 4, 0, 0]}
              isAnimationActive={false}
              cursor="pointer"
              onClick={(_, i) => aoEscolher(dados[i].mes)}
            >
              {dados.map((d) => (
                <Cell key={d.rotulo + d.mes.getFullYear()} fill={d.selecionada ? COR_DESTAQUE : COR_OUTRAS} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      <details className="mt-3 text-sm">
        <summary className="cursor-pointer text-texto-suave hover:text-texto">Ver em tabela</summary>
        <table className="mt-2 w-full text-left tabular-nums">
          <tbody className="divide-y divide-borda">
            {dados.map((d) => (
              <tr key={d.rotulo + d.mes.getFullYear()} className={d.selecionada ? 'font-semibold' : ''}>
                <td className="py-1.5">{formatarMesAno(d.mes)}</td>
                <td className="py-1.5 text-right">{formatarMoeda(d.valor)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  )
}
