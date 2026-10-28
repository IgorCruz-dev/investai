import { formatarMoeda } from '../lib/formatar'

type Props = {
  nome: string
  bandeira: string | null
  cor: string
  className?: string
}

/** Cartão desenhado na cor escolhida (lista de cartões e prévia do formulário) */
export default function CartaoVisual({ nome, bandeira, cor, className = '' }: Props) {
  return (
    <div
      className={`relative flex aspect-[1.75] w-full flex-col justify-between overflow-hidden rounded-2xl p-5 text-white ${className}`}
      style={{ background: `linear-gradient(135deg, ${cor} 0%, ${cor} 45%, color-mix(in srgb, ${cor} 70%, black) 100%)` }}
    >
      <div className="absolute inset-0 bg-linear-to-tr from-transparent via-white/10 to-transparent" />
      <div className="absolute -top-16 -right-12 h-44 w-44 rounded-full bg-white/10" />

      <p className="relative truncate pr-10 text-lg font-semibold">{nome || 'Nome do cartão'}</p>
      <div className="relative grid h-8 w-11 grid-cols-3 gap-px overflow-hidden rounded-md bg-amber-300/90 p-1">
        {Array.from({ length: 6 }, (_, i) => (
          <span key={i} className="rounded-[2px] bg-amber-200/80" />
        ))}
      </div>
      <div className="relative flex items-end justify-between gap-3">
        <span className="font-mono text-sm tracking-[0.2em] text-white/80">•••• ••••</span>
        <span className="text-sm font-semibold tracking-wide uppercase">{bandeira || 'Cartão'}</span>
      </div>
    </div>
  )
}

/** Verde até 50% do limite, amarelo até 80%, vermelho acima */
export function corDoUso(percentual: number) {
  if (percentual <= 50) return '#00c896'
  if (percentual <= 80) return '#f5c842'
  return '#ff4757'
}

/** Limite usado, disponível e barra de uso */
export function UsoDoLimite({ limite, usado }: { limite: number; usado: number }) {
  const percentual = limite > 0 ? (usado / limite) * 100 : usado > 0 ? 100 : 0
  const disponivel = limite - usado
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className="text-texto-suave">Limite usado</span>
        <span className="font-semibold">{formatarMoeda(usado)}</span>
      </div>
      <div
        className="mt-2 h-2 overflow-hidden rounded-full bg-texto/[0.07]"
        role="meter"
        aria-label="Uso do limite"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(percentual)}
      >
        <div
          className="h-full rounded-full transition-all"
          style={{ width: `${Math.min(percentual, 100)}%`, backgroundColor: corDoUso(percentual) }}
        />
      </div>
      <div className="mt-2 flex items-baseline justify-between gap-3 text-xs text-texto-suave">
        <span>
          Disponível <strong className={disponivel < 0 ? 'text-despesa' : 'text-texto'}>{formatarMoeda(disponivel)}</strong>
        </span>
        <span>
          {Math.round(percentual)}% de {formatarMoeda(limite)}
        </span>
      </div>
    </div>
  )
}
