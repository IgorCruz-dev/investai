import { useEffect, useId, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { IconeFechar } from './icones'

type Props = {
  aberto: boolean
  aoFechar: () => void
  titulo: string
  children: ReactNode
  /** Área fixa embaixo, normalmente com os botões de ação */
  rodape?: ReactNode
}

/** Janela sobreposta: sobe de baixo no celular (bottom sheet) e fica centralizada no computador. */
export default function Modal({ aberto, aoFechar, titulo, children, rodape }: Props) {
  const idTitulo = useId()
  const painel = useRef<HTMLDivElement>(null)
  // Guarda a função mais recente sem reexecutar o efeito (senão o foco pularia a cada renderização)
  const aoFecharAtual = useRef(aoFechar)
  useEffect(() => {
    aoFecharAtual.current = aoFechar
  })

  useEffect(() => {
    if (!aberto) return
    const focoAnterior = document.activeElement as HTMLElement | null
    const overflowAnterior = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    painel.current?.focus()

    function aoTeclar(e: KeyboardEvent) {
      if (e.key === 'Escape') aoFecharAtual.current()
    }
    document.addEventListener('keydown', aoTeclar)
    return () => {
      document.body.style.overflow = overflowAnterior
      document.removeEventListener('keydown', aoTeclar)
      focoAnterior?.focus()
    }
  }, [aberto])

  if (!aberto) return null

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4">
      <div className="absolute inset-0 animate-aparecer bg-slate-900/40" onClick={aoFechar} aria-hidden="true" />

      <div
        ref={painel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={idTitulo}
        tabIndex={-1}
        className="relative flex max-h-[90dvh] w-full animate-subir flex-col rounded-t-3xl bg-white shadow-2xl outline-none sm:max-w-md sm:animate-aparecer sm:rounded-2xl"
      >
        <div className="mx-auto mt-2.5 h-1 w-10 rounded-full bg-slate-200 sm:hidden" />
        <div className="flex items-center justify-between gap-3 px-5 pt-3 pb-3 sm:pt-5">
          <h2 id={idTitulo} className="text-lg font-semibold">
            {titulo}
          </h2>
          <button
            type="button"
            onClick={aoFechar}
            aria-label="Fechar"
            className="-mr-2 flex h-9 w-9 items-center justify-center rounded-lg text-texto-suave transition hover:bg-slate-100 hover:text-texto"
          >
            <IconeFechar className="h-5 w-5" />
          </button>
        </div>

        <div
          className={`flex-1 overflow-y-auto px-5 ${rodape ? 'pb-5' : 'pb-[calc(env(safe-area-inset-bottom)+1.25rem)] sm:pb-5'}`}
        >
          {children}
        </div>

        {rodape && (
          <div className="border-t border-borda px-5 pt-4 pb-[calc(env(safe-area-inset-bottom)+1rem)] sm:pb-4">{rodape}</div>
        )}
      </div>
    </div>,
    document.body,
  )
}
