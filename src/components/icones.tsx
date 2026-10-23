type Props = { className?: string }

function Icone({ d, className = 'h-5 w-5' }: Props & { d: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={d} />
    </svg>
  )
}

export const IconeEmail = (p: Props) => (
  <Icone {...p} d="M4 6h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1zm-1 1 9 6 9-6" />
)
export const IconeCadeado = (p: Props) => (
  <Icone {...p} d="M6 11h12a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1zm2 0V8a4 4 0 0 1 8 0v3" />
)
export const IconeUsuario = (p: Props) => (
  <Icone {...p} d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm-7 9a7 7 0 0 1 14 0" />
)
export const IconeOlho = (p: Props) => (
  <Icone {...p} d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12zm10 3a3 3 0 1 0 0-6 3 3 0 0 0 0 6z" />
)
export const IconeOlhoFechado = (p: Props) => (
  <Icone
    {...p}
    d="M3 3l18 18M10.6 5.1A10 10 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3.2 4.1M6.6 6.6C3.8 8.4 2 12 2 12s3.5 7 10 7a9.6 9.6 0 0 0 5.4-1.6M9.9 9.9a3 3 0 0 0 4.2 4.2"
  />
)
export const IconeCarrinho = (p: Props) => (
  <Icone
    {...p}
    d="M3 4h2l2.4 11.2a1 1 0 0 0 1 .8h8.9a1 1 0 0 0 1-.8L20 8H6.2M9 20.5a.5.5 0 1 0 0-1 .5.5 0 0 0 0 1zm8 0a.5.5 0 1 0 0-1 .5.5 0 0 0 0 1z"
  />
)
export const IconeCheck = (p: Props) => <Icone {...p} d="M5 12.5l4.5 4.5L19 7.5" />
export const IconeAlerta = (p: Props) => (
  <Icone {...p} d="M12 8v5m0 3.5v.01M10.3 3.9 2.4 18a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
)
export const IconeSetaCima = (p: Props) => <Icone {...p} d="M7 17 17 7M9 7h8v8" />
export const IconeSetaBaixo = (p: Props) => <Icone {...p} d="M7 7l10 10M17 9v8H9" />
export const IconeSair = (p: Props) => (
  <Icone {...p} d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 16l-4-4 4-4M6 12h10" />
)
export const IconeLista = (p: Props) => (
  <Icone {...p} d="M6 3h12a1 1 0 0 1 1 1v17l-3-2-2 2-2-2-2 2-2-2-3 2V4a1 1 0 0 1 1-1zM9 8h6M9 12h6M9 16h3" />
)
export const IconeCasa = (p: Props) => (
  <Icone {...p} d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z" />
)
export const IconeCartao = (p: Props) => (
  <Icone {...p} d="M3 5h18a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zM2 10h20M6 15h4" />
)
export const IconeRepetir = (p: Props) => (
  <Icone {...p} d="M17 2l3 3-3 3M4 11V9a4 4 0 0 1 4-4h12M7 22l-3-3 3-3M20 13v2a4 4 0 0 1-4 4H4" />
)
export const IconeGrafico = (p: Props) => <Icone {...p} d="M4 20V10M10 20V4M16 20v-7M22 20H2" />
export const IconeCaixa = (p: Props) => (
  <Icone {...p} d="M3 7.5 12 3l9 4.5v9L12 21l-9-4.5zM3 7.5 12 12l9-4.5M12 12v9" />
)
export const IconeChevronEsquerda = (p: Props) => <Icone {...p} d="M15 18l-6-6 6-6" />
export const IconeChevronDireita = (p: Props) => <Icone {...p} d="M9 18l6-6-6-6" />
export const IconeFechar = (p: Props) => <Icone {...p} d="M6 6l12 12M18 6 6 18" />
export const IconeMais = (p: Props) => <Icone {...p} d="M12 5v14M5 12h14" />
