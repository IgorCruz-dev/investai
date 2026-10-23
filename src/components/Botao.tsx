import type { ButtonHTMLAttributes } from 'react'

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  carregando?: boolean
  variante?: 'primaria' | 'secundaria' | 'perigo'
}

const estilos = {
  primaria: 'bg-primaria text-white shadow-lg shadow-primaria/25 hover:bg-primaria-escura',
  secundaria: 'border border-borda bg-white text-texto hover:bg-slate-50',
  perigo: 'bg-despesa text-white hover:bg-red-700',
}

const estilosCarregando = {
  primaria: 'border-white/40 border-t-white',
  secundaria: 'border-slate-300 border-t-texto',
  perigo: 'border-white/40 border-t-white',
}

export default function Botao({ carregando, disabled, children, variante = 'primaria', ...props }: Props) {
  return (
    <button
      disabled={disabled || carregando}
      className={`flex h-12 w-full items-center justify-center gap-2 rounded-xl font-semibold transition active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-70 ${estilos[variante]}`}
      {...props}
    >
      {carregando && <span className={`h-4 w-4 animate-spin rounded-full border-2 ${estilosCarregando[variante]}`} />}
      {children}
    </button>
  )
}
