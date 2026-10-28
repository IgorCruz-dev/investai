import { useState, type InputHTMLAttributes, type ReactNode } from 'react'
import { IconeOlho, IconeOlhoFechado } from './icones'

type Props = InputHTMLAttributes<HTMLInputElement> & {
  label: string
  icone?: ReactNode
  /** Mensagem de erro mostrada embaixo do campo (deixa a borda vermelha) */
  erro?: string
}

export default function Campo({ label, id, icone, type, erro, ...props }: Props) {
  const [mostrarSenha, setMostrarSenha] = useState(false)
  const ehSenha = type === 'password'

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium text-texto">
        {label}
        {props.required && <span className="ml-0.5 text-despesa">*</span>}
      </label>
      <div className="group relative">
        {icone && (
          <span
            className={`pointer-events-none absolute inset-y-0 left-3.5 flex items-center transition ${erro ? 'text-despesa' : 'text-texto-suave group-focus-within:text-destaque'}`}
          >
            {icone}
          </span>
        )}
        <input
          id={id}
          type={ehSenha && mostrarSenha ? 'text' : type}
          aria-invalid={erro ? true : undefined}
          aria-describedby={erro ? `${id}-erro` : undefined}
          className={`h-12 w-full rounded-2xl border bg-texto/[0.04] text-base text-texto outline-none transition placeholder:text-texto-suave/60 focus:bg-texto/[0.06] focus:ring-4 disabled:cursor-not-allowed disabled:bg-texto/[0.02] disabled:text-texto-suave ${erro ? 'border-despesa focus:ring-despesa/15' : 'border-borda hover:border-texto/20 focus:border-primaria/60 focus:ring-primaria/10'} ${icone ? 'pl-11' : 'pl-4'} ${ehSenha ? 'pr-12' : 'pr-4'}`}
          {...props}
        />
        {ehSenha && (
          <button
            type="button"
            onClick={() => setMostrarSenha(!mostrarSenha)}
            aria-label={mostrarSenha ? 'Esconder senha' : 'Mostrar senha'}
            className="absolute inset-y-0 right-0 flex w-12 items-center justify-center text-texto-suave transition hover:text-texto"
          >
            {mostrarSenha ? <IconeOlhoFechado /> : <IconeOlho />}
          </button>
        )}
      </div>
      {erro && (
        <p id={`${id}-erro`} className="text-sm text-despesa">
          {erro}
        </p>
      )}
    </div>
  )
}
