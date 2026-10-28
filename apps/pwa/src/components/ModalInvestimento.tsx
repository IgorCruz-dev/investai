import { useState, type FormEvent } from 'react'
import { formatarMoeda } from '../lib/formatar'
import { excluirInvestimento, salvarInvestimento, type Cotacao, type Investimento } from '../services/carteira'
import Alerta from './Alerta'
import Botao from './Botao'
import Campo from './Campo'
import Escolha from './Escolha'
import Modal from './Modal'

type Props = {
  /** Sem investimento: cadastrar um novo */
  investimento?: Investimento
  cotacoes: Map<string, Cotacao>
  aoFechar: () => void
  aoSalvar: () => void
}

type Tipo = 'FIXED_INCOME' | 'EQUITY' | 'MUTUAL_FUND' | 'CASH'

const TIPOS: { valor: Tipo; label: string }[] = [
  { valor: 'FIXED_INCOME', label: 'Renda fixa' },
  { valor: 'EQUITY', label: 'Ação ou FII' },
  { valor: 'MUTUAL_FUND', label: 'Fundo' },
  { valor: 'CASH', label: 'Dólar ou outro' },
]

const centavosDe = (texto: string) => Number(texto.replace(/\D/g, '').slice(-11) || 0)

/**
 * Investimento cadastrado à mão (o que a Pluggy não traz). Ação/FII com ticker e quantidade: o saldo é atualizado todo
 * dia pela cotação; nos outros, o saldo é o que você informar.
 */
export default function ModalInvestimento({ investimento, cotacoes, aoFechar, aoSalvar }: Props) {
  const [tipo, setTipo] = useState<Tipo>((investimento?.tipo as Tipo) ?? 'FIXED_INCOME')
  const [nome, setNome] = useState(investimento?.nome ?? '')
  const [instituicao, setInstituicao] = useState(investimento?.instituicao ?? '')
  const [codigo, setCodigo] = useState(investimento?.codigo ?? '')
  const [quantidade, setQuantidade] = useState(investimento?.quantidade ? String(investimento.quantidade) : '')
  const [saldo, setSaldo] = useState(Math.round(Number(investimento?.saldo_bruto ?? 0) * 100))
  const [aplicado, setAplicado] = useState(Math.round(Number(investimento?.valor_aplicado ?? 0) * 100))
  const [empresarial, setEmpresarial] = useState(investimento?.empresarial ?? false)
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState('')
  const [confirmandoExclusao, setConfirmandoExclusao] = useState(false)

  const comTicker = tipo === 'EQUITY'
  const qtd = Number(quantidade.replace(',', '.'))
  const cotacao = comTicker ? cotacoes.get(codigo.trim().toUpperCase()) : undefined
  // Com cotação já conhecida, o saldo sai da quantidade × preço
  const saldoCalculado = cotacao && qtd > 0 ? Math.round(qtd * Number(cotacao.preco) * 100) : null
  const podeSalvar = nome.trim() !== '' && (comTicker ? codigo.trim() !== '' && qtd > 0 : saldo > 0)

  async function aoEnviar(e: FormEvent) {
    e.preventDefault()
    if (!podeSalvar) return
    setErro('')
    setSalvando(true)
    try {
      await salvarInvestimento(
        {
          tipo,
          nome,
          instituicao,
          codigo: comTicker ? codigo : '',
          quantidade: comTicker ? qtd : null,
          saldoCentavos: saldoCalculado ?? (comTicker ? aplicado : saldo),
          aplicadoCentavos: aplicado,
          empresarial,
        },
        investimento?.id,
      )
      aoSalvar()
      aoFechar()
    } catch (err) {
      setErro((err as Error).message)
      setSalvando(false)
    }
  }

  async function excluir() {
    if (!investimento) return
    setSalvando(true)
    try {
      await excluirInvestimento(investimento.id)
      aoSalvar()
      aoFechar()
    } catch (err) {
      setErro((err as Error).message)
      setSalvando(false)
    }
  }

  if (confirmandoExclusao && investimento) {
    return (
      <Modal aberto aoFechar={aoFechar} titulo="Excluir investimento">
        <div className="flex flex-col gap-4">
          <p className="text-texto-suave">
            Excluir <strong className="text-texto">{investimento.nome}</strong> da carteira? O histórico dele também sai.
          </p>
          {erro && <Alerta>{erro}</Alerta>}
          <Botao variante="perigo" carregando={salvando} onClick={excluir}>
            Excluir
          </Botao>
          <button
            type="button"
            onClick={() => setConfirmandoExclusao(false)}
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
      titulo={investimento ? 'Editar investimento' : 'Novo investimento'}
      rodape={
        <div className="flex flex-col gap-2">
          <Botao type="submit" form="form-investimento" carregando={salvando} disabled={!podeSalvar}>
            Salvar
          </Botao>
          {investimento && (
            <button
              type="button"
              onClick={() => setConfirmandoExclusao(true)}
              disabled={salvando}
              className="h-10 rounded-xl text-sm font-semibold text-despesa transition hover:bg-despesa/12"
            >
              Excluir
            </button>
          )}
        </div>
      }
    >
      <form id="form-investimento" onSubmit={aoEnviar} noValidate className="flex flex-col gap-5">
        <Escolha label="Tipo" opcoes={TIPOS} valor={tipo} aoMudar={setTipo} obrigatorio />
        <Campo
          id="inv-nome"
          label="Nome"
          required
          placeholder={comTicker ? 'Petrobras' : tipo === 'CASH' ? 'Dólar em espécie' : 'CDB 100% CDI'}
          value={nome}
          onChange={(e) => setNome(e.target.value)}
        />
        <Campo
          id="inv-instituicao"
          label="Onde está"
          placeholder="Nu Invest, Inter, em casa..."
          value={instituicao}
          onChange={(e) => setInstituicao(e.target.value)}
        />
        {comTicker ? (
          <>
            <div className="grid grid-cols-2 gap-3">
              <Campo
                id="inv-codigo"
                label="Ticker"
                required
                placeholder="PETR4"
                autoCapitalize="characters"
                value={codigo}
                onChange={(e) => setCodigo(e.target.value.toUpperCase())}
              />
              <Campo
                id="inv-qtd"
                label="Quantidade"
                required
                inputMode="decimal"
                placeholder="10"
                value={quantidade}
                onChange={(e) => setQuantidade(e.target.value.replace(/[^\d.,]/g, ''))}
              />
            </div>
            <p className="-mt-2 text-sm text-texto-suave">
              {saldoCalculado !== null
                ? `Hoje: ${formatarMoeda(saldoCalculado / 100)} (${formatarMoeda(Number(cotacao!.preco))} cada). Atualiza sozinho todo dia.`
                : 'O valor de hoje é calculado pela cotação, atualizada todo dia à noite.'}
            </p>
          </>
        ) : (
          <Campo
            id="inv-saldo"
            label="Quanto tem hoje"
            required
            inputMode="numeric"
            autoComplete="off"
            value={formatarMoeda(saldo / 100)}
            onChange={(e) => setSaldo(centavosDe(e.target.value))}
          />
        )}
        <Campo
          id="inv-aplicado"
          label="Quanto você colocou (opcional)"
          inputMode="numeric"
          autoComplete="off"
          value={formatarMoeda(aplicado / 100)}
          onChange={(e) => setAplicado(centavosDe(e.target.value))}
        />
        <label className="flex items-start gap-3 text-sm">
          <input
            type="checkbox"
            checked={empresarial}
            onChange={(e) => setEmpresarial(e.target.checked)}
            className="mt-0.5 h-4 w-4 accent-primaria"
          />
          <span>
            <span className="block font-medium">É da empresa</span>
            <span className="block text-texto-suave">Fica fora do patrimônio pessoal, num bloco separado.</span>
          </span>
        </label>
        {erro && <Alerta>{erro}</Alerta>}
      </form>
    </Modal>
  )
}
