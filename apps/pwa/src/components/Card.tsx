import type { ReactNode } from 'react'

type Props = {
  titulo?: ReactNode
  /** Botão ou link no canto direito do cabeçalho */
  acao?: ReactNode
  children: ReactNode
  className?: string
  /** Tira o espaçamento interno (útil para listas que vão de borda a borda) */
  semEspaco?: boolean
}

export default function Card({ titulo, acao, children, className = '', semEspaco }: Props) {
  return (
    <section className={`rounded-2xl border border-borda bg-superficie ${className}`}>
      {(titulo || acao) && (
        <header className="flex items-center justify-between gap-3 border-b border-borda px-5 py-4">
          {titulo && <h2 className="font-semibold">{titulo}</h2>}
          {acao}
        </header>
      )}
      <div className={semEspaco ? '' : 'p-5'}>{children}</div>
    </section>
  )
}
