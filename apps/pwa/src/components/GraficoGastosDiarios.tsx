import { Area, CartesianGrid, ComposedChart, Line, ReferenceDot, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { formatarMoeda, formatarMoedaCompacta } from '../lib/formatar'
import { variacaoPercentual } from '../lib/resumos'
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
const COR_ATUAL = '#a8871f'
const COR_ANTERIOR = '#5c7ce8'
// Previsto (o que as assinaturas previam sair no mês): coral pontilhado, para comparar com o que saiu de verdade
const COR_PREVISTO = 'var(--color-despesa)'
const COR_GRADE = 'rgba(255, 255, 255, 0.07)'
const COR_TEXTO_EIXO = '#8a8a9a'

function ChaveLinha({ cor, tracejada }: { cor: string; tracejada?: boolean }) {
  return (
    <span
      className="inline-block h-0.5 w-4 shrink-0 rounded-full"
      style={
        tracejada
          ? { backgroundImage: `linear-gradient(90deg, ${cor} 60%, transparent 60%)`, backgroundSize: '6px 2px' }
          : { backgroundColor: cor }
      }
    />
  )
}

/** Gastos acumulados dia a dia no mês, com o previsto até o fim do mês e o mês anterior para comparar o ritmo */
export default function GraficoGastosDiarios({ pontos, nomeMes, nomeMesAnterior }: Props) {
  const ultimoComLinha = [...pontos].reverse().find((p) => p.atual !== null)
  const ultimoPrevisto = [...pontos].reverse().find((p) => p.previsto != null)
  const anteriorNoFim = [...pontos].reverse().find((p) => p.anterior !== null)?.anterior ?? null
  const temPrevisto = ultimoPrevisto !== undefined
  const ultimoDia = pontos.length
  const ticks = [1, 5, 10, 15, 20, 25].filter((d) => d < ultimoDia - 2).concat(ultimoDia)

  return (
    <div>
      {/* Mês que ainda não começou: o número é o previsto para o mês inteiro */}
      {!ultimoComLinha && ultimoPrevisto && (
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="cifra text-3xl font-semibold text-texto">{formatarMoeda(ultimoPrevisto.previsto ?? 0)}</span>
          <span className="text-sm text-texto-suave">previsto no mês</span>
          {anteriorNoFim !== null && (
            <Comparacao atual={ultimoPrevisto.previsto ?? 0} anterior={anteriorNoFim} nomeMesAnterior={nomeMesAnterior} />
          )}
        </div>
      )}
      {ultimoComLinha && (
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="cifra text-3xl font-semibold text-texto">{formatarMoeda(ultimoComLinha.atual ?? 0)}</span>
          <span className="text-sm text-texto-suave">até o dia {ultimoComLinha.dia}</span>
          {ultimoPrevisto && (
            <span className="text-sm text-texto-suave">
              · <span className="numero">{formatarMoeda(ultimoPrevisto.previsto ?? 0)}</span> previsto no mês
            </span>
          )}
          {ultimoComLinha.anterior !== null && (
            <Comparacao atual={ultimoComLinha.atual ?? 0} anterior={ultimoComLinha.anterior} nomeMesAnterior={nomeMesAnterior} />
          )}
        </div>
      )}

      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-texto-suave" aria-hidden="true">
        {ultimoComLinha && (
          <span className="flex items-center gap-1.5">
            <ChaveLinha cor={COR_ATUAL} />
            <span className="capitalize">{nomeMes}</span>
          </span>
        )}
        {temPrevisto && (
          <span className="flex items-center gap-1.5">
            <ChaveLinha cor={COR_PREVISTO} tracejada />
            Previsto
          </span>
        )}
        <span className="flex items-center gap-1.5">
          <ChaveLinha cor={COR_ANTERIOR} tracejada />
          <span className="capitalize">{nomeMesAnterior}</span>
        </span>
      </div>

      <div
        className="mt-3 h-60"
        role="img"
        aria-label={`Gráfico de gastos acumulados em ${nomeMes} comparado com ${nomeMesAnterior}. Os valores estão na tabela abaixo.`}
      >
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={pontos} margin={{ top: 12, right: 12, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id="gastos-preenchimento" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={COR_ATUAL} stopOpacity={0.32} />
                <stop offset="100%" stopColor={COR_ATUAL} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid vertical={false} stroke={COR_GRADE} strokeDasharray="2 6" />
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
              cursor={{ stroke: 'var(--grafico-cursor)', strokeWidth: 1 }}
              content={({ active, label }) => {
                const ponto = active ? pontos.find((p) => p.dia === Number(label)) : undefined
                if (!ponto) return null
                // Mesma ordem das linhas no gráfico naquele dia: a mais alta primeiro
                const linhas = [
                  { chave: 'atual', valor: ponto.atual, cor: COR_ATUAL, nome: nomeMes, maiuscula: true },
                  { chave: 'previsto', valor: ponto.previsto ?? null, cor: COR_PREVISTO, nome: 'previsto', maiuscula: false },
                  { chave: 'anterior', valor: ponto.anterior, cor: COR_ANTERIOR, nome: nomeMesAnterior, maiuscula: true },
                ]
                  .filter((l): l is typeof l & { valor: number } => l.valor !== null)
                  .sort((a, b) => b.valor - a.valor)
                return (
                  <div className="rounded-2xl vidro-forte px-3 py-2 text-sm">
                    <p className="text-xs text-texto-suave">Dia {ponto.dia}</p>
                    {linhas.map((l) => (
                      <p key={l.chave} className="mt-1 flex items-center gap-2">
                        <ChaveLinha cor={l.cor} />
                        <span className="font-semibold">{formatarMoeda(l.valor)}</span>
                        <span className={`text-xs text-texto-suave ${l.maiuscula ? 'capitalize' : ''}`}>{l.nome}</span>
                      </p>
                    ))}
                  </div>
                )
              }}
            />
            <Line
              dataKey="anterior"
              type="monotone"
              stroke={COR_ANTERIOR}
              strokeWidth={1.75}
              strokeDasharray="4 5"
              strokeLinecap="round"
              strokeLinejoin="round"
              dot={false}
              activeDot={{ r: 4, stroke: 'var(--grafico-contorno)', strokeWidth: 2 }}
              isAnimationActive={false}
            />
            {temPrevisto && (
              <Line
                dataKey="previsto"
                type="stepAfter"
                stroke={COR_PREVISTO}
                strokeWidth={2}
                strokeDasharray="2 4"
                strokeLinecap="round"
                dot={false}
                activeDot={{ r: 4, stroke: 'var(--grafico-contorno)', strokeWidth: 2 }}
                connectNulls={false}
                isAnimationActive={false}
              />
            )}
            <Area
              dataKey="atual"
              type="monotone"
              stroke={COR_ATUAL}
              strokeWidth={2.5}
              strokeLinecap="round"
              strokeLinejoin="round"
              fill="url(#gastos-preenchimento)"
              connectNulls={false}
              dot={false}
              activeDot={{ r: 4, stroke: 'var(--grafico-contorno)', strokeWidth: 2 }}
              isAnimationActive={false}
            />
            {/* Ponto de "hoje" no fim da linha do mês */}
            {ultimoComLinha && ultimoComLinha.dia < ultimoDia && (
              <ReferenceDot
                x={ultimoComLinha.dia}
                y={ultimoComLinha.atual ?? 0}
                r={5}
                fill={COR_ATUAL}
                stroke="var(--grafico-contorno)"
                strokeWidth={3}
              />
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      <details className="mt-3 text-sm">
        <summary className="cursor-pointer text-texto-suave hover:text-texto">Ver em tabela</summary>
        <div className="mt-2 max-h-64 overflow-y-auto rounded-2xl border border-borda">
          <table className="w-full text-left tabular-nums">
            <thead className="sticky top-0 bg-texto/[0.03] text-xs text-texto-suave">
              <tr>
                <th className="px-3 py-2 font-medium">Dia</th>
                <th className="px-3 py-2 text-right font-medium capitalize">{nomeMes}</th>
                {temPrevisto && <th className="px-3 py-2 text-right font-medium">Previsto</th>}
                <th className="px-3 py-2 text-right font-medium capitalize">{nomeMesAnterior}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-borda">
              {pontos.map((p) => (
                <tr key={p.dia}>
                  <td className="px-3 py-1.5">{p.dia}</td>
                  <td className="px-3 py-1.5 text-right">{p.atual === null ? '—' : formatarMoeda(p.atual)}</td>
                  {temPrevisto && (
                    <td className="px-3 py-1.5 text-right">{p.previsto == null ? '—' : formatarMoeda(p.previsto)}</td>
                  )}
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

/** "+12% que setembro" em pílula: coral se gastou mais, limão se gastou menos */
function Comparacao({ atual, anterior, nomeMesAnterior }: { atual: number; anterior: number; nomeMesAnterior: string }) {
  const variacao = variacaoPercentual(atual, anterior)
  if (variacao === null) return null
  const texto =
    variacao === 0 ? `igual a ${nomeMesAnterior}` : `${variacao > 0 ? '+' : '−'}${Math.abs(variacao)}% que ${nomeMesAnterior}`
  const cor = variacao > 0 ? 'bg-despesa/15 text-despesa' : 'bg-primaria/15 text-destaque'
  return (
    <span
      className={`rounded-full px-2.5 py-1 text-xs font-medium ${variacao === 0 ? 'bg-texto/[0.07] text-texto-suave' : cor}`}
      title={`${formatarMoeda(anterior)} no mesmo dia de ${nomeMesAnterior}`}
    >
      {texto}
    </span>
  )
}
