import { supabase } from '../lib/supabase'
import { inicioDoMes, paraISO, somarMeses } from '../lib/datas'
import type { Transacao } from '../types/financas'

/** Conta onde o dinheiro rende sozinho (ex.: Mercado Pago rende CDI na própria conta) */
export type ContaQueRende = { id: string; nome: string; banco: string | null; saldo: number | null; empresarial: boolean }

/**
 * Rendimentos dos últimos meses (lançamentos na categoria de ícone "rendimentos") e as contas onde eles caem,
 * com o saldo que o banco informa.
 */
export async function buscarInvestimentos(meses = 12) {
  const { data: categorias, error: e1 } = await supabase.from('categorias').select('id').eq('icone', 'rendimentos')
  if (e1) throw e1
  const categoriaId = categorias[0]?.id ?? null
  if (!categoriaId) return { categoriaId, rendimentos: [] as Transacao[], contas: [] as ContaQueRende[] }

  const desde = paraISO(somarMeses(inicioDoMes(), -(meses - 1)))
  const { data: rendimentos, error: e2 } = await supabase
    .from('transacoes')
    .select('*')
    .in(
      'categoria_id',
      categorias.map((c) => c.id),
    )
    .eq('tipo', 'receita')
    .gte('data', desde)
    .order('data', { ascending: false })
    .order('criado_em', { ascending: false })
  if (e2) throw e2

  const idsContas = [...new Set(rendimentos.map((t) => t.conta_id).filter((id): id is string => Boolean(id)))]
  if (idsContas.length === 0) return { categoriaId, rendimentos: rendimentos as Transacao[], contas: [] as ContaQueRende[] }
  const { data: contas, error: e3 } = await supabase
    .from('contas')
    .select('id, nome, pluggy_account_id, empresarial')
    .in('id', idsContas)
  if (e3) throw e3
  const idsPluggy = contas.map((c) => c.pluggy_account_id).filter((id): id is string => Boolean(id))
  const { data: doBanco, error: e4 } = idsPluggy.length
    ? await supabase.from('pluggy_contas').select('id, saldo, banco').in('id', idsPluggy)
    : { data: [], error: null }
  if (e4) throw e4
  const porPluggy = new Map(doBanco.map((p) => [p.id, p]))

  return {
    categoriaId,
    rendimentos: rendimentos as Transacao[],
    contas: contas.map((c) => {
      const p = c.pluggy_account_id ? porPluggy.get(c.pluggy_account_id) : undefined
      return {
        id: c.id,
        nome: c.nome,
        banco: p?.banco ?? null,
        saldo: p?.saldo != null ? Number(p.saldo) : null,
        empresarial: c.empresarial,
      }
    }),
  }
}
