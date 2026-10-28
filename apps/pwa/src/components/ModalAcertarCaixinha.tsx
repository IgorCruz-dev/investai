import { useState } from 'react'
import { saldoInicialPara, type PartidaCaixinha } from '../lib/caixinha'
import { formatarDiaMes, formatarMoeda } from '../lib/formatar'
import { definirPartida } from '../services/caixinha'
import type { MovimentoCaixinha } from '../types/financas'
import Alerta from './Alerta'
import Botao from './Botao'
import CampoValor from './CampoValor'
import Modal from './Modal'

type Props = {
  usuarioId: string
  movimentos: MovimentoCaixinha[]
  partida: PartidaCaixinha
  totalAtual: number
  aoFechar: () => void
  aoSalvar: () => void
}

/** Faz o total guardado bater com o que o banco mostra, sem mexer no saldo da conta */
export default function ModalAcertarCaixinha({ usuarioId, movimentos, partida, totalAtual, aoFechar, aoSalvar }: Props) {
  const [centavos, setCentavos] = useState(Math.round(totalAtual * 100))
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState('')

  async function salvar() {
    setErro('')
    setSalvando(true)
    try {
      await definirPartida(usuarioId, saldoInicialPara(centavos / 100, movimentos, partida), partida.desde)
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
      titulo="Acertar total guardado"
      rodape={
        <Botao onClick={salvar} carregando={salvando}>
          Acertar total
        </Botao>
      }
    >
      <div className="flex flex-col gap-4">
        <CampoValor centavos={centavos} aoMudar={setCentavos} tipo="receita" />
        <p className="text-center text-sm text-texto-suave">
          Quanto você tem guardado hoje, somando as caixinhas do banco. Hoje o app mostra {formatarMoeda(totalAtual)}.
          {partida.desde && <> Os movimentos a partir de {formatarDiaMes(partida.desde)} continuam somando.</>} O saldo da conta
          não muda.
        </p>
        {erro && <Alerta>{erro}</Alerta>}
      </div>
    </Modal>
  )
}
