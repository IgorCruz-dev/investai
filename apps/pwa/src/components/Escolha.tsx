import type { ReactNode } from 'react'

export type Opcao<T extends string> = { valor: T; label: ReactNode }

type Props<T extends string> = {
  label: string
  opcoes: Opcao<T>[]
  valor: T | null
  aoMudar: (valor: T) => void
  erro?: string
  obrigatorio?: boolean
  desabilitado?: boolean
}

/** Grupo de botões para escolher uma opção (forma de pagamento, cartão, conta...) */
export default function Escolha<T extends string>({ label, opcoes, valor, aoMudar, erro, obrigatorio, desabilitado }: Props<T>) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-sm font-medium text-texto">
        {label}
        {obrigatorio && <span className="ml-0.5 text-despesa">*</span>}
      </span>
      <div role="group" aria-label={label} className="flex flex-wrap gap-2">
        {opcoes.map((opcao) => {
          const escolhida = opcao.valor === valor
          return (
            <button
              key={opcao.valor}
              type="button"
              aria-pressed={escolhida}
              disabled={desabilitado}
              onClick={() => aoMudar(opcao.valor)}
              className={`flex h-10 items-center gap-2 rounded-full border px-4 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-60 ${escolhida ? 'border-transparent bg-texto text-fundo shadow-[0_6px_20px_-8px_rgb(243_243_238/0.6)]' : 'border-borda bg-texto/[0.04] text-texto hover:border-texto/20 hover:bg-texto/[0.07]'}`}
            >
              {opcao.label}
            </button>
          )
        })}
      </div>
      {erro && <p className="text-sm text-despesa">{erro}</p>}
    </div>
  )
}
