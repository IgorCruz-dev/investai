import { gastoEmCentavos, receitaEmCentavos } from './resumos'
import type { Categoria, Transacao } from '../types/financas'

export type TotaisDoMes = {
  receitas: number
  despesas: number
  /** receitas − despesas */
  resultado: number
  assinaturas: number
}

export type LinhaCategoria = {
  /** id da categoria ou 'sem' */
  chave: string
  a: number
  b: number
  /** a − b */
  diferenca: number
  /** % de b para a; null quando b é zero */
  variacao: number | null
}

/** Variação percentual de b para a (usa |b| para o resultado, que pode ser negativo); null se b = 0 */
export function variacao(a: number, b: number) {
  if (b === 0) return null
  return Math.round(((a - b) / Math.abs(b)) * 100)
}

/**
 * Totais do mês com os mesmos critérios do Início: despesas incluem o crédito e não incluem
 * pagamento de fatura. Assinaturas = cobranças automáticas + gastos na categoria Assinaturas.
 */
export function totaisDoMes(transacoes: Transacao[], categoriaPorId: Map<string, Categoria>): TotaisDoMes {
  let receitas = 0
  let despesas = 0
  let assinaturas = 0
  for (const t of transacoes) {
    receitas += receitaEmCentavos(t)
    const gasto = gastoEmCentavos(t)
    if (!gasto) continue
    despesas += gasto
    const categoria = t.categoria_id ? categoriaPorId.get(t.categoria_id) : undefined
    if (t.assinatura_id !== null || categoria?.icone === 'assinaturas') assinaturas += gasto
  }
  return {
    receitas: receitas / 100,
    despesas: despesas / 100,
    resultado: (receitas - despesas) / 100,
    assinaturas: assinaturas / 100,
  }
}

/** Gasto por categoria nos dois meses, ordenado pelas que mais aumentaram */
export function compararCategorias(mesA: Transacao[], mesB: Transacao[]): LinhaCategoria[] {
  const somas = new Map<string, { a: number; b: number }>()
  const somar = (lista: Transacao[], lado: 'a' | 'b') => {
    for (const t of lista) {
      const gasto = gastoEmCentavos(t)
      if (!gasto) continue
      const chave = t.categoria_id ?? 'sem'
      const soma = somas.get(chave) ?? { a: 0, b: 0 }
      soma[lado] += gasto
      somas.set(chave, soma)
    }
  }
  somar(mesA, 'a')
  somar(mesB, 'b')

  return [...somas.entries()]
    .map(([chave, s]) => ({
      chave,
      a: s.a / 100,
      b: s.b / 100,
      diferenca: (s.a - s.b) / 100,
      variacao: variacao(s.a, s.b),
    }))
    .sort((x, y) => y.diferenca - x.diferenca || y.a - x.a)
}
