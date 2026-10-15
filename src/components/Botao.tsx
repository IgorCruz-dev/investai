import type { ButtonHTMLAttributes } from 'react'

type Props = ButtonHTMLAttributes<HTMLButtonElement> & { carregando?: boolean }

export default function Botao({ carregando, disabled, children, ...props }: Props) {
  return (
    <button
      disabled={disabled || carregando}
      className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-primaria font-semibold text-white shadow-lg shadow-primaria/25 transition hover:bg-primaria-escura active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-70"
      {...props}
    >
      {carregando && <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />}
      {children}
    </button>
  )
}
