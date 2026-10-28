import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { IconeSetaDireita } from './icones'

/** "Ver tudo" dos cards: pílula com área de toque confortável e seta em ícone */
export default function LinkAcao({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link
      to={to}
      className="group inline-flex h-10 shrink-0 items-center gap-1.5 rounded-full bg-texto/[0.07] pr-3 pl-4 text-sm font-medium text-texto transition hover:bg-texto/[0.13] active:scale-[0.97]"
    >
      {children}
      <IconeSetaDireita className="h-4 w-4 transition group-hover:translate-x-0.5" />
    </Link>
  )
}
