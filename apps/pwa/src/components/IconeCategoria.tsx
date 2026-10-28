// Desenho de cada valor da coluna categorias.icone; categorias novas usam 'outros' (etiqueta)
const desenhos: Record<string, string> = {
  comida: 'M6 3v7a2 2 0 0 0 4 0V3M8 10v11M17 3c-1.7 1-2.7 3.2-2.7 6.2 0 2.3 1.1 3.8 2.7 3.8M17 3v18',
  eletronicos: 'M3 5h18v11H3zM8 20h8M12 16v4',
  faculdade: 'M2 9l10-5 10 5-10 5zM6 11v5c0 1.5 2.7 3 6 3s6-1.5 6-3v-5M22 9v6',
  transporte: 'M4 17V12l2-5h12l2 5v5zM4 17v2M20 17v2M4 12h16M7.5 14.5h.01M16.5 14.5h.01',
  saude: 'M12 20s-7-4.5-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.5-7 10-7 10z',
  lazer: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM8.5 14a4 4 0 0 0 7 0M9 9.5h.01M15 9.5h.01',
  casa: 'M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z',
  roupas: 'M8 3 3 6l2 4 2-1v12h10V9l2 1 2-4-5-3a4 4 0 0 1-8 0z',
  assinaturas: 'M17 2l3 3-3 3M4 11V9a4 4 0 0 1 4-4h12M7 22l-3-3 3-3M20 13v2a4 4 0 0 1-4 4H4',
  salario: 'M2 6h20v12H2zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM6 12h.01M18 12h.01',
  outros: 'M3 12V4h8l10 10-8 8zM7.5 7.5h.01',
  bar: 'M5 9h10v10a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2zM15 11.5h2a2 2 0 0 1 2 2v2a2 2 0 0 1-2 2h-2M5 9a3 3 0 0 1 2.5-4.5 3.5 3.5 0 0 1 6 0A2.5 2.5 0 0 1 15 9M8.5 13v4.5M11.5 13v4.5',
  delivery: 'M6 7h12l1 13H5zM9 7a3 3 0 0 1 6 0M9.5 13.5l2 2 3.5-3.5',
  supermercado: 'M2.5 4h2.2l2.4 11h10.6l2-8H5.6M10 20a1 1 0 1 1-2 0 1 1 0 0 1 2 0zM18 20a1 1 0 1 1-2 0 1 1 0 0 1 2 0z',
  celular: 'M8 2h8a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2zM11 18h2',
  presentes: 'M3 8h18v4H3zM5 12v9h14v-9M12 8v13M12 8C10.5 4.5 6.5 5 7.5 8M12 8c1.5-3.5 5.5-3 4.5 0',
  reembolsos: 'M9 14 4 9l5-5M4 9h11a5 5 0 0 1 0 10h-3',
  rendimentos: 'M3 17l6-6 4 4 8-8M15 7h6v6',
  empresa: 'M3 7h18v13H3zM8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M3 13h18M11 13v2h2v-2',
  // usado no pagamento de fatura (não é uma categoria)
  cartao: 'M3 5h18a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zM2 10h20M6 15h4',
}

export const COR_SEM_CATEGORIA = '#8a8a9a'
const CINZA = COR_SEM_CATEGORIA

type Props = {
  /** Valor de categorias.icone; sem categoria mostra a etiqueta em cinza */
  icone?: string | null
  cor?: string | null
  tamanho?: 'pequeno' | 'medio'
}

/** Ícone da categoria num círculo com a cor dela bem clarinha ao fundo */
export default function IconeCategoria({ icone, cor, tamanho = 'medio' }: Props) {
  const corFinal = cor ?? CINZA
  const caixa = tamanho === 'medio' ? 'h-9 w-9' : 'h-7 w-7'
  const desenho = tamanho === 'medio' ? 'h-[18px] w-[18px]' : 'h-4 w-4'
  return (
    <span
      className={`flex shrink-0 items-center justify-center rounded-[14px] ${caixa}`}
      style={{ backgroundColor: `${corFinal}24`, color: corFinal, boxShadow: `inset 0 0 0 1px ${corFinal}30` }}
      aria-hidden="true"
    >
      <svg
        viewBox="0 0 24 24"
        className={desenho}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.9}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d={desenhos[icone ?? 'outros'] ?? desenhos.outros} />
      </svg>
    </span>
  )
}
