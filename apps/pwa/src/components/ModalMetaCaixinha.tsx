import { useState } from 'react'
import { formatarMoeda } from '../lib/formatar'
import { definirMeta } from '../services/caixinha'
import Alerta from './Alerta'
import Botao from './Botao'
import Campo from './Campo'
import Modal from './Modal'

type Props = {
  usuarioId: string
  metaAtual: number | null
  aoFechar: () => void
  aoSalvar: () => void
}

export default function ModalMetaCaixinha({ usuarioId, metaAtual, aoFechar, aoSalvar }: Props) {
  const [centavos, setCentavos] = useState(metaAtual ? Math.round(metaAtual * 100) : 0)
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState('')
  const [confirmandoRemocao, setConfirmandoRemocao] = useState(false)

  async function salvar(valor: number | null) {
    setErro('')
    setSalvando(true)
    try {
      await definirMeta(usuarioId, valor)
      aoSalvar()
      aoFechar()
    } catch (err) {
      setErro((err as Error).message)
      setSalvando(false)
    }
  }

  if (confirmandoRemocao && metaAtual !== null) {
    return (
      <Modal aberto aoFechar={aoFechar} titulo="Remover meta">
        <div className="flex flex-col gap-4">
          <p className="text-texto-suave">
            Remover a meta de <strong className="text-texto">{formatarMoeda(metaAtual)}</strong>? O dinheiro guardado não muda, só
            some a barra de progresso.
          </p>
          {erro && <Alerta>{erro}</Alerta>}
          <Botao variante="perigo" carregando={salvando} onClick={() => salvar(null)}>
            Remover meta
          </Botao>
          <button
            type="button"
            onClick={() => setConfirmandoRemocao(false)}
            disabled={salvando}
            className="h-11 rounded-xl text-sm font-medium text-texto-suave transition hover:bg-texto/[0.05] hover:text-texto"
          >
            Cancelar
          </button>
        </div>
      </Modal>
    )
  }

  return (
    <Modal
      aberto
      aoFechar={aoFechar}
      titulo="Meta da caixinha"
      rodape={
        <div className="flex flex-col gap-2">
          <Botao onClick={() => salvar(centavos / 100)} carregando={salvando} disabled={centavos <= 0}>
            Salvar meta
          </Botao>
          {metaAtual !== null && (
            <button
              type="button"
              onClick={() => setConfirmandoRemocao(true)}
              disabled={salvando}
              className="h-10 rounded-xl text-sm font-semibold text-despesa transition hover:bg-despesa/12"
            >
              Remover meta
            </button>
          )}
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        <Campo
          id="meta"
          label="Quanto você quer juntar?"
          inputMode="numeric"
          autoComplete="off"
          value={formatarMoeda(centavos / 100)}
          onChange={(e) => setCentavos(Number(e.target.value.replace(/\D/g, '').slice(-11) || 0))}
        />
        <p className="text-sm text-texto-suave">A barra de progresso no topo da Caixinha mostra quanto falta.</p>
        {erro && <Alerta>{erro}</Alerta>}
      </div>
    </Modal>
  )
}
