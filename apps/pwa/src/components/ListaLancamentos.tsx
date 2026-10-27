import { useMemo } from 'react'
import { formatarDia, formatarMoeda } from '../lib/formatar'
import { ehPagamentoDeFatura, ehTransferencia } from '../lib/resumos'
import IconeCategoria from './IconeCategoria'
import type { Cartao, Categoria, FormaPagamento, Transacao } from '../types/financas'

type Props = {
  transacoes: Transacao[]
  categorias: Categoria[]
  cartoes: Cartao[]
  /** Toque num lançamento (abre a edição) */
  aoEscolher: (transacao: Transacao) => void
}

const nomesDasFormas: Record<FormaPagamento, string> = {
  pix: 'Pix',
  debito: 'Débito',
  dinheiro: 'Dinheiro',
  credito: 'Crédito',
}

/** Lançamentos agrupados por dia ("Hoje", "Ontem", "Qui., 22 de out."), na ordem recebida */
export default function ListaLancamentos({ transacoes, categorias, cartoes, aoEscolher }: Props) {
  const porDia = useMemo(() => {
    const grupos = new Map<string, Transacao[]>()
    for (const t of transacoes) grupos.set(t.data, [...(grupos.get(t.data) ?? []), t])
    return [...grupos.entries()]
  }, [transacoes])

  const categoriaPorId = useMemo(() => new Map(categorias.map((c) => [c.id, c])), [categorias])
  const cartaoPorId = useMemo(() => new Map(cartoes.map((c) => [c.id, c])), [cartoes])

  return (
    <div>
      {porDia.map(([dia, doDia]) => (
        <div key={dia}>
          <p className="bg-slate-50 px-5 py-2 text-xs font-semibold tracking-wide text-texto-suave uppercase">
            {formatarDia(dia)}
          </p>
          <ul className="divide-y divide-borda">
            {doDia.map((t) => {
              const categoria = t.categoria_id ? categoriaPorId.get(t.categoria_id) : undefined
              const cartao = t.cartao_id ? cartaoPorId.get(t.cartao_id) : undefined
              const pagamento = ehPagamentoDeFatura(t)
              const transferencia = ehTransferencia(t)
              const titulo = t.local || t.descricao || categoria?.nome || (t.tipo === 'receita' ? 'Receita' : 'Despesa')
              const detalhes = [
                pagamento ? 'Pagamento de fatura' : transferencia ? 'Entre minhas contas' : categoria?.nome,
                t.forma === 'credito' && cartao ? `Crédito · ${cartao.nome}` : nomesDasFormas[t.forma],
                t.total_parcelas ? `${t.parcela_atual}/${t.total_parcelas}` : null,
                t.origem === 'pluggy' ? 'Banco' : null,
              ].filter(Boolean)

              return (
                <li key={t.id}>
                  <button
                    onClick={() => aoEscolher(t)}
                    className="flex w-full items-center gap-3 px-5 py-3.5 text-left transition hover:bg-slate-50"
                  >
                    {pagamento ? (
                      <IconeCategoria icone="cartao" cor="#475569" />
                    ) : (
                      <IconeCategoria icone={categoria?.icone} cor={categoria?.cor} />
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{titulo}</span>
                      <span className="block truncate text-xs text-texto-suave">{detalhes.join(' · ')}</span>
                    </span>
                    <span
                      className={`shrink-0 font-semibold ${transferencia ? 'text-texto-suave' : t.tipo === 'receita' ? 'text-receita' : 'text-texto'}`}
                    >
                      {t.tipo === 'receita' ? '+' : '−'}
                      {formatarMoeda(t.valor)}
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        </div>
      ))}
    </div>
  )
}
