import type { ReactNode } from 'react'
import { deISO } from '../lib/datas'
import { formatarDiaMes, formatarMesAno, formatarMoeda } from '../lib/formatar'
import type { Cartao, Categoria, FormaPagamento, Transacao } from '../types/financas'
import Botao from './Botao'
import IconeCategoria from './IconeCategoria'
import Modal from './Modal'

type Props = {
  transacao: Transacao
  categoria?: Categoria
  cartao?: Cartao | null
  aoFechar: () => void
  aoEditar: () => void
  aoExcluir: () => void
}

const nomesDasFormas: Record<FormaPagamento, string> = {
  pix: 'Pix',
  debito: 'Débito',
  dinheiro: 'Dinheiro',
  credito: 'Crédito',
}

function Linha({ rotulo, children }: { rotulo: string; children: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-3">
      <dt className="text-sm text-texto-suave">{rotulo}</dt>
      <dd className="text-right text-sm font-medium break-words">{children}</dd>
    </div>
  )
}

/** Detalhes de uma transação, com os botões de editar e excluir */
export default function ModalDetalheTransacao({ transacao: t, categoria, cartao, aoFechar, aoEditar, aoExcluir }: Props) {
  const titulo = t.local || t.descricao || categoria?.nome || 'Lançamento'

  return (
    <Modal
      aberto
      aoFechar={aoFechar}
      titulo="Detalhes"
      rodape={
        <div className="grid grid-cols-2 gap-2">
          <Botao variante="secundaria" onClick={aoExcluir}>
            <span className="text-despesa">Excluir</span>
          </Botao>
          <Botao onClick={aoEditar}>Editar</Botao>
        </div>
      }
    >
      <div className="flex items-center gap-3">
        <IconeCategoria icone={t.pagamento_cartao_id ? 'cartao' : categoria?.icone} cor={categoria?.cor} />
        <div className="min-w-0">
          <p className="truncate text-lg font-semibold">{titulo}</p>
          <p className={`text-2xl font-bold tracking-tight ${t.tipo === 'receita' ? 'text-receita' : 'text-texto'}`}>
            {t.tipo === 'receita' ? '+' : '−'}
            {formatarMoeda(t.valor)}
          </p>
        </div>
      </div>

      <dl className="mt-4 divide-y divide-borda border-t border-borda">
        <Linha rotulo="Local">{t.local || '—'}</Linha>
        <Linha rotulo="Categoria">{t.pagamento_cartao_id ? 'Pagamento de fatura' : (categoria?.nome ?? 'Sem categoria')}</Linha>
        <Linha rotulo="Data">{formatarDiaMes(t.data)} de {deISO(t.data).getFullYear()}</Linha>
        <Linha rotulo="Forma">
          {nomesDasFormas[t.forma]}
          {t.forma === 'credito' && cartao ? ` · ${cartao.nome}` : ''}
        </Linha>
        {t.total_parcelas && (
          <Linha rotulo="Parcelas">
            {t.parcela_atual} de {t.total_parcelas}
          </Linha>
        )}
        {t.fatura && <Linha rotulo="Fatura">{formatarMesAno(deISO(t.fatura))}</Linha>}
        {t.descricao && <Linha rotulo="Descrição">{t.descricao}</Linha>}
        <Linha rotulo="Observação">{t.observacao || '—'}</Linha>
      </dl>
    </Modal>
  )
}
