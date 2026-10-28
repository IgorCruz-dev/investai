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
export const IconeUsuario = (p: Props) => <Icone {...p} d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm-7 9a7 7 0 0 1 14 0" />
export const IconeOlho = (p: Props) => (
  <Icone {...p} d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12zm10 3a3 3 0 1 0 0-6 3 3 0 0 0 0 6z" />
)
export const IconeOlhoFechado = (p: Props) => (
  <Icone
    {...p}
    d="M3 3l18 18M10.6 5.1A10 10 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3.2 4.1M6.6 6.6C3.8 8.4 2 12 2 12s3.5 7 10 7a9.6 9.6 0 0 0 5.4-1.6M9.9 9.9a3 3 0 0 0 4.2 4.2"
  />
)
export const IconeCheck = (p: Props) => <Icone {...p} d="M5 12.5l4.5 4.5L19 7.5" />
export const IconeAlerta = (p: Props) => (
  <Icone {...p} d="M12 8v5m0 3.5v.01M10.3 3.9 2.4 18a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
)
export const IconeSetaCima = (p: Props) => <Icone {...p} d="M7 17 17 7M9 7h8v8" />
export const IconeSetaDireita = (p: Props) => <Icone {...p} d="M5 12h14M13 6l6 6-6 6" />
export const IconeSetaBaixo = (p: Props) => <Icone {...p} d="M7 7l10 10M17 9v8H9" />
export const IconeSair = (p: Props) => <Icone {...p} d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 16l-4-4 4-4M6 12h10" />
export const IconeLista = (p: Props) => (
  <Icone {...p} d="M6 3h12a1 1 0 0 1 1 1v17l-3-2-2 2-2-2-2 2-2-2-3 2V4a1 1 0 0 1 1-1zM9 8h6M9 12h6M9 16h3" />
)
export const IconeCasa = (p: Props) => <Icone {...p} d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z" />
export const IconeCartao = (p: Props) => (
  <Icone {...p} d="M3 5h18a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zM2 10h20M6 15h4" />
)
export const IconeRepetir = (p: Props) => (
  <Icone {...p} d="M17 2l3 3-3 3M4 11V9a4 4 0 0 1 4-4h12M7 22l-3-3 3-3M20 13v2a4 4 0 0 1-4 4H4" />
)
export const IconeGrafico = (p: Props) => <Icone {...p} d="M4 20V10M10 20V4M16 20v-7M22 20H2" />
export const IconeCaixa = (p: Props) => <Icone {...p} d="M3 7.5 12 3l9 4.5v9L12 21l-9-4.5zM3 7.5 12 12l9-4.5M12 12v9" />
export const IconeRendimento = (p: Props) => <Icone {...p} d="M3 17l6-6 4 4 8-8M15 7h6v6" />
export const IconeChevronEsquerda = (p: Props) => <Icone {...p} d="M15 18l-6-6 6-6" />
export const IconeChevronDireita = (p: Props) => <Icone {...p} d="M9 18l6-6-6-6" />
export const IconeChevronBaixo = (p: Props) => <Icone {...p} d="M6 9l6 6 6-6" />
export const IconeInfo = (p: Props) => <Icone {...p} d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 11v5M12 7.5v.01" />
export const IconeFechar = (p: Props) => <Icone {...p} d="M6 6l12 12M18 6 6 18" />
export const IconeMais = (p: Props) => <Icone {...p} d="M12 5v14M5 12h14" />
export const IconeLapis = (p: Props) => <Icone {...p} d="M4 20h4L19 9l-4-4L4 16zM14 6l4 4" />
export const IconeBusca = (p: Props) => <Icone {...p} d="M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-4-4" />
export const IconeBanco = (p: Props) => <Icone {...p} d="M3 10h18M12 3l9 5H3l9-5zM5 10v8m4.7-8v8m4.6-8v8M19 10v8M3 21h18" />
export const IconeSincronizar = (p: Props) => (
  <Icone {...p} d="M20 11a8 8 0 0 0-14.9-3.5M4 4v3.5h3.5M4 13a8 8 0 0 0 14.9 3.5M20 20v-3.5h-3.5" />
)
export const IconeEmpresa = (p: Props) => (
  <Icone {...p} d="M4 21V5a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1v16M15 9h4a1 1 0 0 1 1 1v11M2 21h20M8 8h3M8 12h3M8 16h3" />
)
export const IconeCarteira = (p: Props) => (
  <Icone {...p} d="M4 7a2 2 0 0 1 2-2h11v4M4 7v11a2 2 0 0 0 2 2h14V9H6a2 2 0 0 1-2-2zM16 14.5h.01" />
)
export const IconeAlvo = (p: Props) => (
  <Icone {...p} d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM12 12h.01" />
)
export const IconeEscudo = (p: Props) => <Icone {...p} d="M12 3l8 3v6c0 4.5-3.4 8.2-8 9-4.6-.8-8-4.5-8-9V6z" />
export const IconeJornal = (p: Props) => (
  <Icone {...p} d="M4 5h13v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2zM17 9h3v10a2 2 0 0 1-2 2M8 9h5M8 13h5M8 17h3" />
)
export const IconeCaderno = (p: Props) => (
  <Icone {...p} d="M6 3h12a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zM8 3v18M11 8h5M11 12h5" />
)
export const IconeDolar = (p: Props) => (
  <Icone
    {...p}
    d="M12 3v18M16.5 7.5c-.7-1.2-2.4-2-4.5-2-2.5 0-4 1.2-4 3 0 4 9 2 9 6.5 0 1.8-1.8 3.2-4.5 3.2-2.2 0-4-.9-4.8-2.4"
  />
)
export const IconeSino = (p: Props) => <Icone {...p} d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15zM10 20.5a2.2 2.2 0 0 0 4 0" />
