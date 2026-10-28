import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { deISO } from '../lib/datas'
import { formatarDiaMes } from '../lib/formatar'
import { mediaMovel, type Ponto } from '../services/mercado'

const COR = '#a8871f'
const COR_MEDIA = '#5c7ce8'
const COR_GRADE = 'rgba(255, 255, 255, 0.07)'
const COR_TEXTO_EIXO = '#8a8a9a'
const JANELA = 200
const real = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
  minimumFractionDigits: 2,
  maximumFractionDigits: 3,
})
const mesCurto = new Intl.DateTimeFormat('pt-BR', { month: 'short' })

/** Dólar dos últimos 12 meses com a média dos últimos 200 dias úteis (tracejada) */
export default function GraficoDolar({ pontos }: { pontos: Ponto[] }) {
  const medias = mediaMovel(pontos, JANELA)
  const umAno = new Date()
  umAno.setFullYear(umAno.getFullYear() - 1)
  const desde = umAno.toISOString().slice(0, 10)
  const dados = pontos.map((p, i) => ({ ...p, media: medias[i] })).filter((p) => p.dia >= desde)
  // Um tick por mês, no primeiro dia com cotação (sem isso, gráfico largo repete o mês)
  const ticks = dados.filter((p, i) => i > 0 && p.dia.slice(0, 7) !== dados[i - 1].dia.slice(0, 7)).map((p) => p.dia)
  const ultimo = dados[dados.length - 1]
  const acima = ultimo?.media ? ((ultimo.valor - ultimo.media) / ultimo.media) * 100 : null

  return (
    <div>
      {acima !== null && (
        <p className="mb-3 text-sm text-texto-suave">
          Hoje {acima >= 0 ? 'acima' : 'abaixo'} da média de 200 dias em{' '}
          <span className="font-semibold text-texto">
            {Math.abs(acima).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%
          </span>
        </p>
      )}
      <div className="h-52 lg:h-64" role="img" aria-label="Cotação do dólar nos últimos 12 meses, com a média de 200 dias.">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={dados} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid vertical={false} stroke={COR_GRADE} strokeDasharray="2 6" />
            <XAxis
              dataKey="dia"
              ticks={ticks}
              tickFormatter={(dia: string) => {
                const t = mesCurto.format(deISO(dia)).replace('.', '')
                return t.charAt(0).toUpperCase() + t.slice(1)
              }}
              tickLine={false}
              axisLine={{ stroke: COR_GRADE }}
              tick={{ fontSize: 12, fill: COR_TEXTO_EIXO }}
              tickMargin={6}
              minTickGap={28}
            />
            <YAxis
              width={56}
              domain={['auto', 'auto']}
              tickLine={false}
              axisLine={false}
              tick={{ fontSize: 12, fill: COR_TEXTO_EIXO }}
              tickFormatter={(v: number) => real.format(v)}
            />
            <Tooltip
              cursor={{ stroke: 'var(--grafico-cursor)', strokeWidth: 1 }}
              content={({ active, payload }) => {
                const p = active ? (payload?.[0]?.payload as (typeof dados)[number] | undefined) : undefined
                if (!p) return null
                return (
                  <div className="rounded-2xl vidro-forte px-3 py-2 text-sm">
                    <p className="font-semibold">{real.format(p.valor)}</p>
                    {p.media && <p className="text-xs text-texto-suave">Média 200 dias: {real.format(p.media)}</p>}
                    <p className="text-xs text-texto-suave">{formatarDiaMes(p.dia)}</p>
                  </div>
                )
              }}
            />
            <Line
              dataKey="media"
              stroke={COR_MEDIA}
              strokeWidth={1.5}
              strokeDasharray="4 4"
              dot={false}
              isAnimationActive={false}
            />
            <Line
              dataKey="valor"
              stroke={COR}
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4, stroke: 'var(--grafico-contorno)', strokeWidth: 2 }}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <div className="mt-3 flex items-center gap-4 text-xs text-texto-suave">
        <span className="flex items-center gap-1.5">
          <span className="h-0.5 w-4 rounded-full" style={{ background: COR }} /> Dólar
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-0 w-4 border-t-2 border-dashed" style={{ borderColor: COR_MEDIA }} /> Média de 200 dias
        </span>
      </div>
    </div>
  )
}
