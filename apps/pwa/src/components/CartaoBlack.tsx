import { useId, useRef, useState, type CSSProperties, type PointerEvent } from 'react'
import { formatarMoeda } from '../lib/formatar'

const META = 1_000_000
const PRATA_TEXTO = 'Inter, system-ui, sans-serif'
const MONO = "'JetBrains Mono', ui-monospace, monospace"

type Props = {
  nome?: string
  /** Saldo pessoal + empresa (aparece no verso) */
  patrimonio?: number | null
  /** completo: cartão inteiro, inclina e vira; logo: só moldura, chip e medalhão, para tamanhos pequenos */
  variante?: 'completo' | 'logo'
  className?: string
}

/**
 * O cartão Black é a marca do app: preto, moldura de filigrana prateada, letras em relevo e o lobo no medalhão.
 * No tamanho completo inclina com o ponteiro e um clique vira para o verso, com a meta do primeiro milhão.
 */
export default function CartaoBlack({ nome = '', patrimonio = null, variante = 'completo', className = '' }: Props) {
  const id = useId().replace(/:/g, '')
  const palco = useRef<HTMLDivElement>(null)
  const [virado, setVirado] = useState(false)

  if (variante === 'logo') {
    return (
      <svg viewBox="0 0 428 270" className={`h-auto drop-shadow-[0_3px_6px_rgb(0_0_0/0.35)] ${className}`} aria-hidden="true">
        <Definicoes id={id} />
        <Frente id={id} simples />
      </svg>
    )
  }

  function inclinar(x: number, y: number) {
    const el = palco.current
    if (!el) return
    el.style.setProperty('--rx', `${(0.5 - y) * 14}deg`)
    el.style.setProperty('--ry', `${(x - 0.5) * 18}deg`)
  }

  function aoMover(e: PointerEvent<HTMLDivElement>) {
    if (e.pointerType !== 'mouse') return
    const r = e.currentTarget.getBoundingClientRect()
    inclinar((e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height)
  }

  const progresso = patrimonio === null ? 0 : Math.min(Math.max(patrimonio / META, 0), 1)

  return (
    <div
      ref={palco}
      onPointerMove={aoMover}
      onPointerLeave={() => inclinar(0.5, 0.5)}
      className={`relative w-full [perspective:900px] select-none ${className}`}
      style={{ '--rx': '0deg', '--ry': '0deg' } as CSSProperties}
    >
      <button
        type="button"
        onClick={() => setVirado((v) => !v)}
        aria-label={virado ? 'Mostrar a frente do cartão' : 'Ver a meta do primeiro milhão'}
        className="relative block aspect-[428/270] w-full cursor-pointer rounded-[10px] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primaria"
      >
        <div
          className="absolute inset-0 transition-transform duration-[600ms] ease-[cubic-bezier(.2,.8,.2,1)] [transform-style:preserve-3d]"
          style={{ transform: `rotateX(var(--rx)) rotateY(calc(var(--ry) + ${virado ? 180 : 0}deg))` }}
        >
          <svg
            viewBox="0 0 428 270"
            className="absolute inset-0 h-full w-full drop-shadow-[0_10px_18px_rgb(0_0_0/0.45)] [backface-visibility:hidden]"
          >
            <Definicoes id={id} />
            <Frente id={id} nome={nome} />
          </svg>
          <svg
            viewBox="0 0 428 270"
            className="absolute inset-0 h-full w-full drop-shadow-[0_10px_18px_rgb(0_0_0/0.45)] [backface-visibility:hidden] [transform:rotateY(180deg)]"
          >
            <Definicoes id={`${id}v`} />
            <Verso id={`${id}v`} patrimonio={patrimonio} progresso={progresso} />
          </svg>
        </div>
      </button>
    </div>
  )
}

/** Degradês, filigrana e relevo usados pelas duas faces (ids únicos por cartão na tela) */
function Definicoes({ id }: { id: string }) {
  return (
    <defs>
      <linearGradient id={`${id}-fundo`} x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stopColor="#1d1d1f" />
        <stop offset="0.55" stopColor="#0c0c0d" />
        <stop offset="1" stopColor="#151516" />
      </linearGradient>
      <linearGradient id={`${id}-prata`} x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stopColor="#f7f7f3" />
        <stop offset="0.42" stopColor="#b4b4af" />
        <stop offset="0.58" stopColor="#eeeee9" />
        <stop offset="1" stopColor="#8a8a86" />
      </linearGradient>
      <linearGradient id={`${id}-cobre`} x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stopColor="#f0b87e" />
        <stop offset="0.5" stopColor="#c27a3e" />
        <stop offset="1" stopColor="#8f5428" />
      </linearGradient>
      {/* Filigrana: ondas e volutas repetidas ao longo da moldura */}
      <pattern id={`${id}-filigrana`} width="16" height="16" patternUnits="userSpaceOnUse">
        <path d="M0 8c2.5-5 5.5-5 8 0s5.5 5 8 0" fill="none" stroke={`url(#${id}-prata)`} strokeWidth="0.9" />
        <path d="M0 8c2.5 5 5.5 5 8 0s5.5-5 8 0" fill="none" stroke={`url(#${id}-prata)`} strokeWidth="0.5" opacity="0.7" />
        <circle cx="4" cy="8" r="0.9" fill="#d9d9d4" />
        <circle cx="12" cy="8" r="0.9" fill="#d9d9d4" />
      </pattern>
      {/* Linhas finas diagonais: textura do cartão */}
      <pattern id={`${id}-textura`} width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(35)">
        <path d="M0 0v4" stroke="#fff" strokeWidth="0.5" opacity="0.035" />
      </pattern>
      <filter id={`${id}-relevo`} x="-5%" y="-20%" width="110%" height="140%">
        <feDropShadow dx="0" dy="1.2" stdDeviation="0.4" floodColor="#000" floodOpacity="0.9" />
      </filter>
      <clipPath id={`${id}-medalhao`}>
        <circle cx="214" cy="142" r="40" />
      </clipPath>
    </defs>
  )
}

function Fundo({ id }: { id: string }) {
  return (
    <>
      <rect width="428" height="270" rx="18" fill={`url(#${id}-fundo)`} />
      <rect width="428" height="270" rx="18" fill={`url(#${id}-textura)`} />
    </>
  )
}

function Frente({ id, nome = '', simples }: { id: string; nome?: string; simples?: boolean }) {
  const prata = `url(#${id}-prata)`
  return (
    <g>
      <Fundo id={id} />
      {/* Moldura: faixa de filigrana entre dois filetes */}
      <path
        d="M22 10h384a12 12 0 0 1 12 12v226a12 12 0 0 1-12 12H22a12 12 0 0 1-12-12V22a12 12 0 0 1 12-12zM32 26a6 6 0 0 0-6 6v206a6 6 0 0 0 6 6h364a6 6 0 0 0 6-6V32a6 6 0 0 0-6-6z"
        fillRule="evenodd"
        fill={simples ? prata : `url(#${id}-filigrana)`}
        opacity={simples ? 0.85 : 0.9}
      />
      {!simples && (
        <>
          <rect x="10" y="10" width="408" height="250" rx="12" fill="none" stroke={prata} strokeWidth="1.4" />
          <rect x="26" y="26" width="376" height="218" rx="6" fill="none" stroke={prata} strokeWidth="1.1" />
        </>
      )}

      {!simples && (
        <text
          x="214"
          y="66"
          textAnchor="middle"
          fontFamily={PRATA_TEXTO}
          fontWeight="800"
          fontSize="27"
          letterSpacing="5"
          fill={prata}
          filter={`url(#${id}-relevo)`}
        >
          PROFIT
        </text>
      )}

      <Chip id={id} x={simples ? 56 : 54} y={simples ? 112 : 92} escala={simples ? 1.25 : 1} />
      <Medalhao id={id} escala={simples ? 1.55 : 1} />

      {!simples && (
        <g fontFamily={MONO} fill={prata} filter={`url(#${id}-relevo)`}>
          <text x="54" y="162" fontSize="23" fontWeight="600" letterSpacing="2">
            2026
          </text>
          <text x="270" y="162" fontSize="23" fontWeight="600" letterSpacing="2">
            00001
          </text>
          <text x="292" y="186" fontSize="11" fontWeight="600" letterSpacing="1">
            26
          </text>
          <text x="54" y="224" fontSize="17" fontWeight="600" letterSpacing="2.5">
            {(nome || 'MEMBRO').toLocaleUpperCase('pt-BR').slice(0, 22)}
          </text>
          {/* "MEMBRO DESDE" acompanhando a borda de baixo do medalhão */}
          <path id={`${id}-arco`} d="M166 142a48 48 0 0 0 96 0" fill="none" />
          <text fontFamily={PRATA_TEXTO} fontSize="6.5" fontWeight="600" letterSpacing="2.2">
            <textPath href={`#${id}-arco`} startOffset="50%" textAnchor="middle">
              MEMBRO DESDE
            </textPath>
          </text>
        </g>
      )}
    </g>
  )
}

function Chip({ id, x, y, escala }: { id: string; x: number; y: number; escala: number }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${escala})`}>
      <rect width="46" height="35" rx="7" fill={`url(#${id}-cobre)`} />
      <path
        d="M0 12h14M0 23h14M32 12h14M32 23h14M14 0v35M32 0v35M14 17.5h18"
        stroke="#6d3f1d"
        strokeOpacity="0.65"
        strokeWidth="1.3"
        fill="none"
      />
    </g>
  )
}

/** Medalhão com o lobo de perfil, como o retrato no centro dos cartões clássicos */
function Medalhao({ id, escala }: { id: string; escala: number }) {
  const prata = `url(#${id}-prata)`
  return (
    <g transform={`translate(214 142) scale(${escala}) translate(-214 -142)`}>
      <circle cx="214" cy="142" r="44" fill="#0a0a0b" stroke={prata} strokeWidth="1.6" />
      <circle cx="214" cy="142" r="40" fill="none" stroke={prata} strokeWidth="0.6" opacity="0.7" />
      <g clipPath={`url(#${id}-medalhao)`}>
        <g transform="translate(208 147) scale(0.55)">
          <path
            d="M-44 64L-48 40L-40 44L-46 22L-37 26L-40 4L-31 8C-30-10-28-20-26-28L-30-62L-12-36L-6-66L6-34C14-32 22-26 30-20L62-10C68-9 69-2 64 0L46 6L40 8L52 12C46 18 36 20 28 20L30 28L20 26L24 36L12 32L14 44L4 40L6 54L-4 48L-2 64Z"
            fill={prata}
          />
          <path d="M-4-58L2-38L-6-40ZM-27-54L-16-38L-24-36Z" fill="#2a2a2b" opacity="0.85" />
          <path d="M14-16L26-18L20-12Z" fill="#0b0b0b" />
          <path d="M60-8C66-8 67-3 63-1L58-3Z" fill="#1a1a1a" />
          <path
            d="M10-22L28-21M-20 10L-6 2M-24 24L-8 18M-16 40L-2 34M34-8L48-9M36 8L44 7"
            stroke="#3a3a3a"
            strokeWidth="1.8"
            strokeLinecap="round"
            opacity="0.75"
            fill="none"
          />
        </g>
      </g>
    </g>
  )
}

function Verso({ id, patrimonio, progresso }: { id: string; patrimonio: number | null; progresso: number }) {
  const prata = `url(#${id}-prata)`
  return (
    <g>
      <Fundo id={id} />
      <rect y="26" width="428" height="46" fill="#030303" />
      <text x="372" y="18" fontFamily={MONO} fontSize="10" fill="#bdbdb8">
        026
      </text>

      <text x="26" y="104" fontFamily={PRATA_TEXTO} fontSize="9" letterSpacing="0.5" fill="#bdbdb8">
        Rumo ao primeiro milhão
      </text>
      <rect x="24" y="112" width="300" height="70" rx="3" fill="#161617" stroke={prata} strokeWidth="1.4" />
      <text x="40" y="146" fontFamily={MONO} fontSize="22" fontWeight="600" fill="#d4af37">
        {(progresso * 100).toLocaleString('pt-BR', { maximumFractionDigits: 3 })}%
      </text>
      <rect x="40" y="158" width="268" height="6" rx="3" fill="#2a2a2b" />
      <rect x="40" y="158" width={Math.max(268 * progresso, 6)} height="6" rx="3" fill="#d4af37" />

      <text x="26" y="214" fontFamily={PRATA_TEXTO} fontSize="9" fill="#9a9a96">
        PATRIMÔNIO
      </text>
      <text x="26" y="236" fontFamily={MONO} fontSize="18" fontWeight="600" fill={prata}>
        {patrimonio === null ? '—' : formatarMoeda(patrimonio)}
      </text>
      <text x="402" y="236" textAnchor="end" fontFamily={MONO} fontSize="10" fill="#9a9a96">
        {patrimonio === null ? '' : `faltam ${formatarMoeda(Math.max(META - patrimonio, 0))}`}
      </text>

      {/* Selinho com o lobo, no lugar do logo do verso */}
      <rect x="348" y="112" width="56" height="56" rx="4" fill="none" stroke={prata} strokeWidth="1" />
      <g transform="translate(376 140) scale(0.3) translate(-214 -142)">
        <Medalhao id={id} escala={1} />
      </g>
    </g>
  )
}
