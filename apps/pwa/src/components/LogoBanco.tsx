// Logos oficiais em public/bancos (favicon do Mercado Pago; Itaú 2023 do Wikimedia Commons). Sem logo, mostra a inicial.
const LOGOS: { busca: RegExp; arquivo: string; nome: string; fundo: string }[] = [
  { busca: /mercado ?pago/, arquivo: '/bancos/mercado-pago.svg', nome: 'Mercado Pago', fundo: 'bg-superficie p-1' },
  { busca: /itau/, arquivo: '/bancos/itau.svg', nome: 'Itaú', fundo: 'bg-superficie' },
]

type Props = { banco: string; className?: string }

export default function LogoBanco({ banco, className = 'h-8 w-8' }: Props) {
  const nome = banco
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
  const logo = LOGOS.find((l) => l.busca.test(nome))
  const base = `${className} shrink-0 overflow-hidden rounded-full ring-2 ring-[#141519]`

  if (logo) {
    return (
      <span className={`${base} ${logo.fundo} flex items-center justify-center`}>
        <img src={logo.arquivo} alt={logo.nome} className="h-full w-full object-contain" />
      </span>
    )
  }
  return (
    <span className={`${base} flex items-center justify-center bg-black/15 text-xs font-semibold`} aria-hidden="true">
      {banco.trim().charAt(0).toUpperCase()}
    </span>
  )
}
