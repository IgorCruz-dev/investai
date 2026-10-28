import type { ReactNode } from 'react'

type Props = {
  icone: ReactNode
  titulo: string
  descricao?: string
  primeira?: boolean
  /** Botão no fim da linha, depois do separador */
  acao?: ReactNode
}

/** Abre uma seção da página: ícone, título e um fio que separa da seção anterior */
export default function TituloSecao({ icone, titulo, descricao, primeira, acao }: Props) {
  return (
    <div className={primeira ? 'mt-8' : 'mt-12'}>
      <div className="flex items-center gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primaria/20 text-destaque">{icone}</span>
        <div className="min-w-0">
          <h2 className="font-display text-lg leading-tight font-semibold tracking-tight">{titulo}</h2>
          {descricao && <p className="text-xs text-texto-suave">{descricao}</p>}
        </div>
        <span aria-hidden="true" className="ml-2 h-px flex-1 bg-gradient-to-r from-borda via-borda to-transparent" />
        {acao}
      </div>
    </div>
  )
}
