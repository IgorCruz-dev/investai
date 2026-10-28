import { useEffect, useState } from 'react'
import { hojeISO } from '../lib/datas'
import { formatarMesAno, formatarMoeda } from '../lib/formatar'
import { listarContas } from '../services/contas'
import { registrarPagamentoDeTerceiro } from '../services/transacoes'
import type { Conta, FormaPagamento } from '../types/financas'
import Alerta from './Alerta'
import Botao from './Botao'
import Campo from './Campo'
import CampoValor from './CampoValor'
import Escolha from './Escolha'
import Modal from './Modal'

type FormaDoAcerto = Exclude<FormaPagamento, 'credito'>

const FORMAS: { valor: FormaDoAcerto; label: string }[] = [
  { valor: 'pix', label: 'Pix' },
  { valor: 'dinheiro', label: 'Dinheiro' },
  { valor: 'debito', label: 'Depósito' },
]

type Props = {
  pessoa: string
  /** Dia 1 do mês que está sendo acertado */
  mes: Date
  /** O que falta no mês; vem preenchido, mas dá para registrar só uma parte */
  faltaCentavos: number
  aoFechar: () => void
  aoSalvar: () => void
}

/** Registra o que a pessoa mandou para acertar um mês: tudo o que falta ou só uma parte */
export default function ModalPagamentoDoAcerto({ pessoa, mes, faltaCentavos, aoFechar, aoSalvar }: Props) {
  const [centavos, setCentavos] = useState(faltaCentavos)
  const [forma, setForma] = useState<FormaDoAcerto>('pix')
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

  const nomeDoMes = formatarMesAno(mes).toLowerCase()
  const falta = faltaCentavos - centavos

  async function confirmar() {
    if (centavos <= 0) return setErro('Informe quanto ela pagou.')
    if (!data) return setErro('Informe a data do pagamento.')
    setErro('')
    setSalvando(true)
    try {
      await registrarPagamentoDeTerceiro({
        pessoa,
        mes,
        valorCentavos: centavos,
        forma,
        contaId: forma === 'dinheiro' ? null : contaId,
        data,
        descricao: `Acerto de ${nomeDoMes}`,
      })
      aoSalvar()
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
      titulo={`${pessoa} pagou`}
      rodape={
        <Botao onClick={confirmar} carregando={salvando}>
          {salvando ? 'Registrando...' : `Confirmar ${formatarMoeda(centavos / 100)}`}
        </Botao>
      }
    >
      <div className="flex flex-col gap-5">
        <div className="rounded-xl bg-texto/[0.05] p-4 text-center">
          <p className="text-sm text-texto-suave">Acerto de {nomeDoMes}</p>
          <p className="mt-1 text-sm text-texto-suave">Falta {formatarMoeda(faltaCentavos / 100)}</p>
        </div>

        <CampoValor centavos={centavos} aoMudar={setCentavos} tipo="receita" />
        {centavos > 0 && falta > 0 ? (
          <div className="-mt-3 flex flex-col items-center gap-2">
            <p className="text-center text-sm text-texto-suave">
              Pagou uma parte: ainda faltam {formatarMoeda(falta / 100)} em {nomeDoMes}.
            </p>
            <button
              type="button"
              onClick={() => setCentavos(faltaCentavos)}
              className="text-sm font-semibold text-primaria hover:underline"
            >
              Pagou tudo ({formatarMoeda(faltaCentavos / 100)})
            </button>
          </div>
        ) : falta < 0 ? (
          <p className="-mt-3 text-center text-sm text-texto-suave">
            {formatarMoeda(-falta / 100)} a mais do que falta em {nomeDoMes}: a sobra fica como dinheiro dela.
          </p>
        ) : (
          <p className="-mt-3 text-center text-sm text-texto-suave">Acerta {nomeDoMes} por inteiro.</p>
        )}

        <Escolha label="Como ela pagou" opcoes={FORMAS} valor={forma} aoMudar={setForma} />

        <p className="text-sm text-texto-suave">
          O dinheiro entra como receita dela: soma no seu saldo, mas fica fora das suas receitas do mês.
        </p>

        {forma !== 'dinheiro' && contas.length > 1 && (
          <Escolha
            label="Conta onde o dinheiro caiu"
            opcoes={contas.map((c) => ({ valor: c.id, label: c.nome }))}
            valor={contaId}
            aoMudar={setContaId}
          />
        )}

        <Campo
          id="data-acerto"
          label="Data do pagamento"
          type="date"
          required
          value={data}
          onChange={(e) => setData(e.target.value)}
        />

        {erro && <Alerta>{erro}</Alerta>}
      </div>
    </Modal>
  )
}
