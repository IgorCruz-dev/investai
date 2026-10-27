import { formatarMesAno } from '../lib/formatar'
import { IconeChevronDireita, IconeChevronEsquerda } from './icones'

type Props = {
  /** Qualquer data dentro do mês selecionado */
  mes: Date
  aoMudar: (mes: Date) => void
}

const estiloBotao =
  'flex h-9 w-9 items-center justify-center rounded-lg text-texto-suave transition hover:bg-superficie-3 hover:text-texto'

export default function SeletorMes({ mes, aoMudar }: Props) {
  function mudar(meses: number) {
    aoMudar(new Date(mes.getFullYear(), mes.getMonth() + meses, 1))
  }

  return (
    <div className="inline-flex items-center gap-1 rounded-xl border border-borda bg-superficie p-1">
      <button type="button" onClick={() => mudar(-1)} aria-label="Mês anterior" className={estiloBotao}>
        <IconeChevronEsquerda className="h-5 w-5" />
      </button>
      <span className="min-w-36 text-center text-sm font-semibold" aria-live="polite">
        {formatarMesAno(mes)}
      </span>
      <button type="button" onClick={() => mudar(1)} aria-label="Próximo mês" className={estiloBotao}>
        <IconeChevronDireita className="h-5 w-5" />
      </button>
    </div>
  )
}
