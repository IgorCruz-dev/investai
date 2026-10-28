import type { ButtonHTMLAttributes } from 'react'

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  carregando?: boolean
  variante?: 'primaria' | 'secundaria' | 'perigo'
}

const estilos = {
  primaria:
    'bg-primaria text-sobre-primaria shadow-[0_10px_30px_-10px_rgb(212_175_55/0.6),inset_0_1px_0_rgb(255_255_255/0.5)] hover:bg-primaria-escura',
  secundaria: 'vidro text-texto hover:bg-texto/[0.08]',
  perigo: 'bg-despesa text-sobre-primaria shadow-[0_10px_30px_-12px_rgb(255_122_107/0.6)] hover:brightness-110',
}

const estilosCarregando = {
  primaria: 'border-black/20 border-t-sobre-primaria',
  secundaria: 'border-texto/20 border-t-texto',
  perigo: 'border-black/20 border-t-sobre-primaria',
}

export default function Botao({ carregando, disabled, children, variante = 'primaria', ...props }: Props) {
  return (
    <button
      disabled={disabled || carregando}
      className={`flex h-12 w-full items-center justify-center gap-2 rounded-full font-semibold transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 ${estilos[variante]}`}
      {...props}
    >
      {carregando && <span className={`h-4 w-4 animate-spin rounded-full border-2 ${estilosCarregando[variante]}`} />}
      {children}
    </button>
  )
}
