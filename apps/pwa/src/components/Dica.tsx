import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { IconeInfo } from './icones'

type Props = {
  /** Nome lido pelo leitor de tela no botão (ex.: "Como a meta é calculada") */
  rotulo: string
  children: ReactNode
  /** Para que lado o balão cresce a partir do ícone; perto da borda direita, use "esquerda" */
  lado?: 'direita' | 'esquerda'
}

/** Ícone de informação: abre um balão ao passar o mouse, focar ou tocar (no celular não há hover) */
export default function Dica({ rotulo, children, lado = 'direita' }: Props) {
  const [aberta, setAberta] = useState(false)
  const id = useId()
  const raiz = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    if (!aberta) return
    const fora = (e: PointerEvent) => !raiz.current?.contains(e.target as Node) && setAberta(false)
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setAberta(false)
    document.addEventListener('pointerdown', fora)
    document.addEventListener('keydown', esc)
    return () => {
      document.removeEventListener('pointerdown', fora)
      document.removeEventListener('keydown', esc)
    }
  }, [aberta])

  return (
    <span
      ref={raiz}
      className="relative inline-flex align-middle"
      onMouseEnter={() => setAberta(true)}
      onMouseLeave={() => setAberta(false)}
    >
      <button
        type="button"
        aria-label={rotulo}
        aria-describedby={aberta ? id : undefined}
        aria-expanded={aberta}
        onClick={() => setAberta((a) => !a)}
        onFocus={() => setAberta(true)}
        onBlur={() => setAberta(false)}
        className="flex h-5 w-5 items-center justify-center rounded-full text-texto-suave transition hover:text-texto focus-visible:ring-2 focus-visible:ring-primaria focus-visible:outline-none"
      >
        <IconeInfo className="h-4 w-4" />
      </button>
      {aberta && (
        <span
          id={id}
          role="tooltip"
          className={`animate-surgir absolute top-full z-30 mt-2 w-64 max-w-[calc(100vw-2rem)] rounded-2xl bg-texto px-3.5 py-3 text-left text-xs leading-relaxed font-normal text-fundo shadow-[0_16px_40px_-12px_rgb(0_0_0/0.45)] ${
            lado === 'direita' ? '-left-2' : '-right-2'
          }`}
        >
          {children}
        </span>
      )}
    </span>
  )
}
