import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { formatarMoeda, formatarMoedaCompacta } from '../lib/formatar'

export type BarraCategoria = { nome: string; a: number; b: number }

type Props = {
  barras: BarraCategoria[]
  /** ex.: "outubro" */
  nomeA: string
  /** ex.: "setembro" */
  nomeB: string
}

// Mês escolhido em destaque (verde do app); mês de comparação recua em cinza — mesmo par do gráfico do Início.
// A tabela "Por categoria" logo abaixo traz todos os valores (o cinza tem contraste baixo).
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
const COR_A = COR_FOCO
const COR_B = COR_REFERENCIA
const ALTURA_POR_CATEGORIA = 48

const encurtar = (nome: string) => (nome.length > 13 ? `${nome.slice(0, 12)}…` : nome)

function Chave({ cor }: { cor: string }) {
  return <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-sm" style={{ backgroundColor: cor }} />
}

/** Barras deitadas agrupadas por categoria: mês A x mês B */
export default function GraficoComparativoCategorias({ barras, nomeA, nomeB }: Props) {
  return (
    <div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-texto-suave" aria-hidden="true">
        <span className="flex items-center gap-1.5">
          <Chave cor={COR_A} />
          <span className="capitalize">{nomeA}</span>
        </span>
        <span className="flex items-center gap-1.5">
          <Chave cor={COR_B} />
          <span className="capitalize">{nomeB}</span>
        </span>
      </div>

      <div
        className="mt-3"
        style={{ height: barras.length * ALTURA_POR_CATEGORIA + 32 }}
        role="img"
        aria-label={`Gastos por categoria em ${nomeA} comparados com ${nomeB}. Os valores estão na tabela abaixo.`}
      >
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={barras} layout="vertical" margin={{ top: 0, right: 8, bottom: 0, left: 0 }} barGap={2}>
            <CartesianGrid horizontal={false} stroke={COR_GRADE} />
            <XAxis
              type="number"
              tickLine={false}
              axisLine={false}
              tick={{ fontSize: 12, fill: COR_TEXTO_EIXO }}
              tickFormatter={(v: number) => formatarMoedaCompacta(v)}
            />
            <YAxis
              type="category"
              dataKey="nome"
              width={96}
              tickLine={false}
              axisLine={{ stroke: COR_GRADE }}
              tick={{ fontSize: 12, fill: COR_TEXTO_EIXO }}
              tickFormatter={encurtar}
            />
            <Tooltip
              cursor={{ fill: 'rgba(255, 255, 255, 0.05)' }}
              content={({ active, label }) => {
                const barra = active ? barras.find((b) => b.nome === label) : undefined
                if (!barra) return null
                return (
                  <div className="rounded-xl border border-borda bg-superficie px-3 py-2 text-sm shadow-lg">
                    <p className="text-xs text-texto-suave">{barra.nome}</p>
                    <p className="mt-1 flex items-center gap-2">
                      <Chave cor={COR_A} />
                      <span className="font-semibold">{formatarMoeda(barra.a)}</span>
                      <span className="text-xs text-texto-suave capitalize">{nomeA}</span>
                    </p>
                    <p className="mt-1 flex items-center gap-2">
                      <Chave cor={COR_B} />
                      <span className="font-semibold">{formatarMoeda(barra.b)}</span>
                      <span className="text-xs text-texto-suave capitalize">{nomeB}</span>
                    </p>
                  </div>
                )
              }}
            />
            <Bar dataKey="a" fill={COR_A} barSize={12} radius={[0, 4, 4, 0]} isAnimationActive={false} />
            <Bar dataKey="b" fill={COR_B} barSize={12} radius={[0, 4, 4, 0]} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
