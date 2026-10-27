import { useState, type SubmitEvent } from 'react'
import { formatarMoeda } from '../lib/formatar'
import { salvarCartao } from '../services/cartoes'
import type { Cartao } from '../types/financas'
import Alerta from './Alerta'
import Botao from './Botao'
import Campo from './Campo'
import CartaoVisual from './CartaoVisual'
import Escolha from './Escolha'
import Modal from './Modal'

type Props = {
  /** null = cartão novo */
  cartao: Cartao | null
  aoFechar: () => void
  aoSalvar: (cartao: Cartao) => void
}

type Erros = Partial<Record<'nome' | 'limite' | 'fechamento' | 'vencimento', string>>

const bandeiras = ['Visa', 'Mastercard', 'Elo', 'American Express', 'Hipercard', 'Outra'] as const
// Tons fundos: num fundo escuro, cartão em cor clara vira um bloco luminoso
// no meio da tela. O primeiro é o padrão da coluna no banco.
const cores = ['#0f172a', '#4a3a0f', '#4c1d95', '#1e3a8a', '#064e3b', '#7f1d1d', '#831843', '#164e63']

function diaValido(texto: string) {
  const dia = Number(texto)
  return Number.isInteger(dia) && dia >= 1 && dia <= 31
}

export default function ModalCartao({ cartao, aoFechar, aoSalvar }: Props) {
  const [nome, setNome] = useState(cartao?.nome ?? '')
  const [bandeira, setBandeira] = useState<string | null>(cartao?.bandeira ?? null)
  const [limiteCentavos, setLimiteCentavos] = useState(cartao ? Math.round(cartao.limite * 100) : 0)
  const [fechamento, setFechamento] = useState(cartao ? String(cartao.dia_fechamento) : '')
  const [vencimento, setVencimento] = useState(cartao ? String(cartao.dia_vencimento) : '')
  const [cor, setCor] = useState(cartao?.cor ?? cores[1])

  const [tentouSalvar, setTentouSalvar] = useState(false)
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState('')

  function validar(): Erros {
    const erros: Erros = {}
    if (!nome.trim()) erros.nome = 'Dê um nome para o cartão.'
    if (limiteCentavos <= 0) erros.limite = 'Informe o limite.'
    if (!diaValido(fechamento)) erros.fechamento = 'Dia entre 1 e 31.'
    if (!diaValido(vencimento)) erros.vencimento = 'Dia entre 1 e 31.'
    return erros
  }
  const erros = tentouSalvar ? validar() : {}

  async function aoEnviar(e: SubmitEvent<HTMLFormElement>) {
    e.preventDefault()
    setErro('')
    setTentouSalvar(true)
    if (Object.keys(validar()).length > 0) return

    setSalvando(true)
    try {
      const salvo = await salvarCartao(
        {
          nome: nome.trim(),
          bandeira,
          limite: limiteCentavos / 100,
          dia_fechamento: Number(fechamento),
          dia_vencimento: Number(vencimento),
          cor,
        },
        cartao?.id,
      )
      aoSalvar(salvo)
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
      titulo={cartao ? 'Editar cartão' : 'Novo cartão'}
      rodape={
        <Botao type="submit" form="form-cartao" carregando={salvando}>
          {salvando ? 'Salvando...' : cartao ? 'Salvar alterações' : 'Cadastrar cartão'}
        </Botao>
      }
    >
      <form id="form-cartao" onSubmit={aoEnviar} noValidate className="flex flex-col gap-5">
        <CartaoVisual nome={nome} bandeira={bandeira} cor={cor} className="mx-auto max-w-72" />

        <Campo
          id="nome-cartao"
          label="Nome"
          placeholder="Ex.: Nubank, Itaú Platinum"
          required
          maxLength={40}
          value={nome}
          onChange={(e) => setNome(e.target.value)}
          erro={erros.nome}
        />

        <Escolha
          label="Bandeira"
          opcoes={bandeiras.map((b) => ({ valor: b, label: b }))}
          valor={bandeira}
          aoMudar={setBandeira}
        />

        <Campo
          id="limite"
          label="Limite"
          inputMode="numeric"
          autoComplete="off"
          required
          value={formatarMoeda(limiteCentavos / 100)}
          onChange={(e) => setLimiteCentavos(Number(e.target.value.replace(/\D/g, '').slice(-11) || 0))}
          erro={erros.limite}
        />

        <div className="grid grid-cols-2 gap-3">
          <Campo
            id="fechamento"
            label="Dia do fechamento"
            type="number"
            inputMode="numeric"
            min={1}
            max={31}
            required
            value={fechamento}
            onChange={(e) => setFechamento(e.target.value)}
            erro={erros.fechamento}
          />
          <Campo
            id="vencimento"
            label="Dia do vencimento"
            type="number"
            inputMode="numeric"
            min={1}
            max={31}
            required
            value={vencimento}
            onChange={(e) => setVencimento(e.target.value)}
            erro={erros.vencimento}
          />
        </div>
        <p className="-mt-3 text-xs text-texto-suave">
          Compras feitas a partir do dia do fechamento entram na fatura seguinte.
        </p>

        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-texto">Cor</span>
          <div role="group" aria-label="Cor do cartão" className="flex flex-wrap gap-2.5">
            {cores.map((c) => (
              <button
                key={c}
                type="button"
                aria-label={`Cor ${c}`}
                aria-pressed={c === cor}
                onClick={() => setCor(c)}
                className={`h-8 w-8 rounded-full transition ${c === cor ? 'ring-2 ring-texto ring-offset-2' : ''}`}
                style={{ backgroundColor: c }}
              />
            ))}
          </div>
        </div>

        {erro && <Alerta>{erro}</Alerta>}
      </form>
    </Modal>
  )
}
