import { useState, type SubmitEvent } from 'react'
import { hojeISO } from '../lib/datas'
import { formatarMoeda } from '../lib/formatar'
import { guardar, retirar } from '../services/caixinha'
import Alerta from './Alerta'
import Botao from './Botao'
import Campo from './Campo'
import CampoValor from './CampoValor'
import Modal from './Modal'

type Props = {
  modo: 'guardar' | 'retirar'
  /** Total guardado agora (limite da retirada) */
  disponivel: number
  aoFechar: () => void
  aoSalvar: () => void
}

export default function ModalCaixinha({ modo, disponivel, aoFechar, aoSalvar }: Props) {
  const retirando = modo === 'retirar'
  const [centavos, setCentavos] = useState(0)
  const [data, setData] = useState(hojeISO())
  const [motivo, setMotivo] = useState('')
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState('')

  const disponivelCentavos = Math.round(disponivel * 100)
  const passouDoDisponivel = retirando && centavos > disponivelCentavos
  const dataInvalida = !retirando && (!data || data > hojeISO())
  // O botão só libera com tudo certo (na retirada, o motivo é obrigatório)
  const podeConfirmar = centavos > 0 && !passouDoDisponivel && !dataInvalida && (!retirando || motivo.trim().length > 0)

  async function aoEnviar(e: SubmitEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!podeConfirmar) return
    setErro('')
    setSalvando(true)
    try {
      if (retirando) await retirar(centavos, motivo, hojeISO())
      else await guardar(centavos, data)
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
      titulo={retirando ? 'Retirar da caixinha' : 'Guardar na caixinha'}
      rodape={
        <Botao type="submit" form="form-caixinha" carregando={salvando} disabled={!podeConfirmar} variante={retirando ? 'perigo' : 'primaria'}>
          {salvando ? 'Salvando...' : retirando ? 'Confirmar retirada' : 'Guardar'}
        </Botao>
      }
    >
      <form id="form-caixinha" onSubmit={aoEnviar} noValidate className="flex flex-col gap-5">
        <CampoValor
          centavos={centavos}
          aoMudar={setCentavos}
          tipo={retirando ? 'despesa' : 'receita'}
          erro={passouDoDisponivel ? `Você só tem ${formatarMoeda(disponivel)} guardado.` : undefined}
        />

        <p className="-mt-2 text-center text-sm text-texto-suave">
          {retirando
            ? `Disponível na caixinha: ${formatarMoeda(disponivel)}. O valor volta para o saldo da conta.`
            : 'O valor sai do saldo da conta e fica guardado na caixinha.'}
        </p>

        {retirando ? (
          <Campo
            id="motivo"
            label="Motivo"
            placeholder="Ex.: conserto do carro, viagem..."
            required
            maxLength={140}
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            erro={centavos > 0 && !motivo.trim() ? 'Conte para que vai usar o dinheiro.' : undefined}
          />
        ) : (
          <Campo
            id="data-caixinha"
            label="Data"
            type="date"
            required
            max={hojeISO()}
            value={data}
            onChange={(e) => setData(e.target.value)}
            erro={dataInvalida ? 'Escolha hoje ou uma data passada.' : undefined}
          />
        )}

        {erro && <Alerta>{erro}</Alerta>}
      </form>
    </Modal>
  )
}
