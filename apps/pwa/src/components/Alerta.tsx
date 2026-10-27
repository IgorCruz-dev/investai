import type { ReactNode } from 'react'
import { IconeAlerta } from './icones'

export default function Alerta({ children }: { children: ReactNode }) {
  return (
    <div role="alert" className="flex items-start gap-2.5 rounded-xl border border-erro-borda bg-erro-fundo px-3.5 py-3 text-sm text-despesa">
      <IconeAlerta className="mt-px h-4 w-4 shrink-0" />
      <span>{children}</span>
    </div>
  )
}
