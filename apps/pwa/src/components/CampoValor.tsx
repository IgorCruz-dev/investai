import { formatarMoeda } from '../lib/formatar'

type Props = {
  centavos: number
  aoMudar: (centavos: number) => void
  /** Cor do número: vermelho para despesa, verde para receita */
  tipo: 'receita' | 'despesa'
  erro?: string
  desabilitado?: boolean
}

const MAXIMO_DIGITOS = 11 // até R$ 999.999.999,99

/** Valor grande em R$ que se preenche da direita: digitar 1, 2, 3, 4 resulta em R$ 12,34 */
export default function CampoValor({ centavos, aoMudar, tipo, erro, desabilitado }: Props) {
  return (
    <div className="flex flex-col items-center gap-1">
      <label htmlFor="valor" className="text-sm text-texto-suave">
        Valor<span className="ml-0.5 text-despesa">*</span>
      </label>
      <input
        id="valor"
        inputMode="numeric"
        autoComplete="off"
        disabled={desabilitado}
        aria-invalid={erro ? true : undefined}
        aria-describedby={erro ? 'valor-erro' : undefined}
        value={formatarMoeda(centavos / 100)}
        onChange={(e) => {
          const digitos = e.target.value.replace(/\D/g, '').slice(-MAXIMO_DIGITOS)
          aoMudar(Number(digitos || 0))
        }}
        className={`numero w-full bg-transparent text-center text-4xl font-semibold outline-none disabled:opacity-70 ${tipo === 'despesa' ? 'text-despesa' : 'text-receita'}`}
      />
      {erro && (
        <p id="valor-erro" className="text-sm text-despesa">
          {erro}
        </p>
      )}
    </div>
  )
}
