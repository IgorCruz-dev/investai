import { useMemo } from 'react'
import { formatarDia, formatarMoeda } from '../lib/formatar'
import { ehDeTerceiro, ehPagamentoDeFatura, ehTransferencia } from '../lib/resumos'
import IconeCategoria, { COR_SEM_CATEGORIA } from './IconeCategoria'
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
    <div className="pb-1">
      {porDia.map(([dia, doDia]) => (
        <div key={dia}>
          <p className="px-5 pt-4 pb-1.5 text-[11px] font-medium tracking-wider text-texto-suave/70 uppercase">
            {formatarDia(dia)}
          </p>
          <ul className="px-2">
            {doDia.map((t) => {
              const categoria = t.categoria_id ? categoriaPorId.get(t.categoria_id) : undefined
              const cartao = t.cartao_id ? cartaoPorId.get(t.cartao_id) : undefined
              const pagamento = ehPagamentoDeFatura(t)
              const transferencia = ehTransferencia(t)
              const deTerceiro = ehDeTerceiro(t)
              const titulo = t.local || t.descricao || categoria?.nome || (t.tipo === 'receita' ? 'Receita' : 'Despesa')
              const detalhes = [
                pagamento
                  ? 'Pagamento de fatura'
                  : transferencia
                    ? 'Entre minhas contas'
                    : deTerceiro
                      ? `De ${t.terceiro}`
                      : categoria?.nome,
                t.forma === 'credito' && cartao ? `Crédito · ${cartao.nome}` : nomesDasFormas[t.forma],
                t.total_parcelas ? `${t.parcela_atual}/${t.total_parcelas}` : null,
                t.dividida_de ? 'Parte' : null,
                t.origem === 'pluggy' ? 'Banco' : null,
              ].filter(Boolean)

              return (
                <li key={t.id}>
                  <button
                    onClick={() => aoEscolher(t)}
                    className="flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left transition hover:bg-texto/[0.05]"
                  >
                    {pagamento ? (
                      <IconeCategoria icone="cartao" cor={COR_SEM_CATEGORIA} />
                    ) : (
                      <IconeCategoria icone={categoria?.icone} cor={categoria?.cor} />
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{titulo}</span>
                      <span className="block truncate text-xs text-texto-suave">{detalhes.join(' · ')}</span>
                    </span>
                    <span
                      className={`numero shrink-0 text-sm font-medium ${transferencia || deTerceiro ? 'text-texto-suave' : t.tipo === 'receita' ? 'text-receita' : 'text-texto'}`}
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
