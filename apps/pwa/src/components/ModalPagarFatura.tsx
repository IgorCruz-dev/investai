import { useEffect, useState } from 'react'
import { hojeISO } from '../lib/datas'
import { formatarMesAno, formatarMoeda } from '../lib/formatar'
import { listarContas } from '../services/contas'
import { pagarFatura } from '../services/transacoes'
import type { Cartao, Conta } from '../types/financas'
import Alerta from './Alerta'
import Botao from './Botao'
import Campo from './Campo'
import Escolha from './Escolha'
import Modal from './Modal'

type Props = {
  cartao: Cartao
  /** Dia 1 do mês de vencimento */
  fatura: Date
  totalCentavos: number
  aoFechar: () => void
  aoPagar: () => void
}

/** Confirma o pagamento: vira uma despesa no débito com o valor da fatura */
export default function ModalPagarFatura({ cartao, fatura, totalCentavos, aoFechar, aoPagar }: Props) {
  const [contas, setContas] = useState<Conta[]>([])
  const [contaId, setContaId] = useState<string | null>(null)
  const [data, setData] = useState(hojeISO())
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState('')

  useEffect(() => {
    listarContas()
      .then((cts) => {
        setContas(cts)
        if (cts.length >= 1) setContaId(cts[0].id)
      })
      .catch(() => setErro('Não foi possível carregar suas contas.'))
  }, [])

  async function confirmar() {
    if (!data) return setErro('Informe a data do pagamento.')
    setErro('')
    setSalvando(true)
    try {
      await pagarFatura({
        cartao,
        fatura,
        valorCentavos: totalCentavos,
        contaId,
        data,
        descricao: `Pagamento da fatura de ${formatarMesAno(fatura).toLowerCase()}`,
      })
      aoPagar()
      aoFechar()
    } catch (err) {
      setErro((err as Error).message)
      setSalvando(false)
    }
  }

  return (
    <Modal
      aberto
      aoFechar={aoFechar}
      titulo="Pagar fatura"
      rodape={
        <Botao onClick={confirmar} carregando={salvando}>
          {salvando ? 'Registrando...' : `Confirmar pagamento de ${formatarMoeda(totalCentavos / 100)}`}
        </Botao>
      }
    >
      <div className="flex flex-col gap-5">
        <div className="rounded-xl bg-superficie-2 p-4 text-center">
          <p className="text-sm text-texto-suave">
            {cartao.nome} · fatura de {formatarMesAno(fatura).toLowerCase()}
          </p>
          <p className="mt-1 text-3xl font-bold tracking-tight">{formatarMoeda(totalCentavos / 100)}</p>
        </div>

        <p className="text-sm text-texto-suave">
          O pagamento entra como despesa no débito e desconta do seu saldo. Ele não conta de novo nas despesas do mês,
          porque as compras já contaram quando foram feitas.
        </p>

        {contas.length > 1 && (
          <Escolha
            label="Conta de onde sai o dinheiro"
            opcoes={contas.map((c) => ({ valor: c.id, label: c.nome }))}
            valor={contaId}
            aoMudar={setContaId}
          />
        )}

        <Campo id="data-pagamento" label="Data do pagamento" type="date" required value={data} onChange={(e) => setData(e.target.value)} />

        {erro && <Alerta>{erro}</Alerta>}
      </div>
    </Modal>
  )
}
