import type { ReactNode } from 'react'

type Props = {
  titulo?: ReactNode
  /** Ícone pequeno antes do título */
  icone?: ReactNode
  /** Botão ou link no canto direito do cabeçalho */
  acao?: ReactNode
  children: ReactNode
  className?: string
  /** Tira o espaçamento interno (útil para listas que vão de borda a borda) */
  semEspaco?: boolean
  /** solido (padrão): superfície lisa; vidro: translúcido sobre a aurora */
  tom?: 'solido' | 'vidro'
}

/** Bloco de conteúdo com título legível e a ação do lado direito */
export default function Card({ titulo, icone, acao, children, className = '', semEspaco, tom = 'solido' }: Props) {
  return (
    <section className={`${tom} animate-surgir rounded-[28px] ${className}`}>
      {(titulo || acao) && (
        <header className="flex min-h-14 items-center justify-between gap-3 px-5 pt-4 pb-1">
          {titulo && (
            <h2 className="flex min-w-0 items-center gap-2.5 font-display text-lg font-semibold tracking-tight text-texto">
              {icone && (
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-texto/[0.06] text-texto-suave">
                  {icone}
                </span>
              )}
              {titulo}
            </h2>
          )}
          {acao}
        </header>
      )}
      <div className={semEspaco ? 'pb-2' : 'p-5'}>{children}</div>
    </section>
  )
}
