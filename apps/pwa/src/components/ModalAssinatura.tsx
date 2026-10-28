import { useState, type SubmitEvent } from 'react'
import { dataDeCobranca } from '../lib/assinaturas'
import { inicioDoMes, paraISO } from '../lib/datas'
import { formatarDiaMes, formatarMoeda } from '../lib/formatar'
import { definirAtiva, excluirAssinatura, lancarAssinaturasPendentes, salvarAssinatura } from '../services/assinaturas'
import type { Assinatura, Cartao } from '../types/financas'
import Alerta from './Alerta'
import Botao from './Botao'
import Campo from './Campo'
import Escolha from './Escolha'
import Modal from './Modal'

type Props = {
  /** null = assinatura nova */
  assinatura: Assinatura | null
  cartoes: Cartao[]
  aoFechar: () => void
  /** Chamado depois de salvar, pausar, retomar ou excluir */
  aoMudar: () => void
}

type Erros = Partial<Record<'nome' | 'valor' | 'dia' | 'parcelas', string>>

const SEM_CARTAO = 'sem-cartao'

export default function ModalAssinatura({ assinatura, cartoes, aoFechar, aoMudar }: Props) {
  const [nome, setNome] = useState(assinatura?.nome ?? '')
  const [centavos, setCentavos] = useState(assinatura ? Math.round(assinatura.valor * 100) : 0)
  const [dia, setDia] = useState(assinatura ? String(assinatura.dia_cobranca) : '')
  const [cartaoId, setCartaoId] = useState<string>(assinatura?.cartao_id ?? SEM_CARTAO)
  // Vazio = sem fim (assinatura); com número = parcelado (ex.: financiamento)
  const [parcelas, setParcelas] = useState(assinatura?.total_parcelas ? String(assinatura.total_parcelas) : '')
  const doBanco = assinatura?.do_banco ?? false
  const [lancarAgora, setLancarAgora] = useState(true)

  const [tentouSalvar, setTentouSalvar] = useState(false)
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState('')
  const [confirmandoExclusao, setConfirmandoExclusao] = useState(false)

  const diaNumero = Number(dia)
  const diaValido = Number.isInteger(diaNumero) && diaNumero >= 1 && diaNumero <= 31
  // Numa assinatura nova cujo dia já passou neste mês, pergunta se lança a cobrança deste mês
  const cobrancaDesteMes = diaValido ? dataDeCobranca(inicioDoMes(), diaNumero) : null
  const jaPassouNoMes = !assinatura && cobrancaDesteMes !== null && cobrancaDesteMes <= new Date()

  function validar(): Erros {
    const erros: Erros = {}
    if (!nome.trim()) erros.nome = 'Dê um nome (ex.: Netflix).'
    if (centavos <= 0) erros.valor = 'Informe o valor.'
    if (!diaValido) erros.dia = 'Dia entre 1 e 31.'
    if (parcelas && !(Number(parcelas) >= 1 && Number(parcelas) <= 360)) erros.parcelas = 'Entre 1 e 360.'
    return erros
  }
  const erros = tentouSalvar ? validar() : {}

  async function executar(acao: () => Promise<unknown>) {
    setErro('')
    setSalvando(true)
    try {
      await acao()
      aoMudar()
      aoFechar()
    } catch (err) {
      setErro((err as Error).message)
      setSalvando(false)
    }
  }

  function aoEnviar(e: SubmitEvent<HTMLFormElement>) {
    e.preventDefault()
    setTentouSalvar(true)
    if (Object.keys(validar()).length > 0) return

    executar(async () => {
      const dados = {
        nome: nome.trim(),
        valor: centavos / 100,
        dia_cobranca: diaNumero,
        cartao_id: cartaoId === SEM_CARTAO ? null : cartaoId,
        total_parcelas: parcelas ? Number(parcelas) : null,
      }
      if (assinatura) {
        await salvarAssinatura(dados, assinatura.id)
        return
      }
      // Sem lançar agora: marca a cobrança deste mês como já feita para o lançamento automático pular
      const ultimo = jaPassouNoMes && !lancarAgora && cobrancaDesteMes ? paraISO(cobrancaDesteMes) : null
      await salvarAssinatura({ ...dados, ultimo_lancamento: ultimo })
      if (jaPassouNoMes && lancarAgora) await lancarAssinaturasPendentes()
    })
  }

  if (confirmandoExclusao && assinatura) {
    return (
      <Modal aberto aoFechar={aoFechar} titulo="Excluir assinatura">
        <div className="flex flex-col gap-4">
          <p className="text-texto-suave">
            Excluir <strong className="text-texto">{assinatura.nome}</strong>? As cobranças já lançadas continuam no histórico. Se
            só quer parar por um tempo, use Pausar.
          </p>
          {erro && <Alerta>{erro}</Alerta>}
          <Botao variante="perigo" carregando={salvando} onClick={() => executar(() => excluirAssinatura(assinatura.id))}>
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
      titulo={assinatura ? 'Editar assinatura' : 'Nova assinatura'}
      rodape={
        <div className="flex flex-col gap-2">
          <Botao type="submit" form="form-assinatura" carregando={salvando}>
            {salvando ? 'Salvando...' : assinatura ? 'Salvar alterações' : 'Cadastrar assinatura'}
          </Botao>
          {assinatura && (
            <div className={`grid gap-2 ${doBanco ? 'grid-cols-1' : 'grid-cols-2'}`}>
              <button
                type="button"
                disabled={salvando}
                onClick={() => executar(() => definirAtiva(assinatura.id, !assinatura.ativa))}
                className="h-10 rounded-xl border border-borda text-sm font-semibold transition hover:bg-texto/[0.05]"
              >
                {assinatura.ativa ? 'Pausar' : 'Retomar'}
              </button>
              {/* As do banco voltariam na próxima cobrança: para parar de acompanhar, pausa */}
              {!doBanco && (
                <button
                  type="button"
                  disabled={salvando}
                  onClick={() => setConfirmandoExclusao(true)}
                  className="h-10 rounded-xl text-sm font-semibold text-despesa transition hover:bg-despesa/12"
                >
                  Excluir
                </button>
              )}
            </div>
          )}
        </div>
      }
    >
      <form id="form-assinatura" onSubmit={aoEnviar} noValidate className="flex flex-col gap-5">
        <Campo
          id="nome-assinatura"
          label="Nome"
          placeholder="Ex.: Netflix, Spotify, academia"
          required
          maxLength={40}
          value={nome}
          onChange={(e) => setNome(e.target.value)}
          erro={erros.nome}
        />

        <div className="grid grid-cols-2 gap-3">
          <Campo
            id="valor-assinatura"
            label="Valor por mês"
            inputMode="numeric"
            autoComplete="off"
            required
            value={formatarMoeda(centavos / 100)}
            onChange={(e) => setCentavos(Number(e.target.value.replace(/\D/g, '').slice(-9) || 0))}
            erro={erros.valor}
          />
          <Campo
            id="dia-cobranca"
            label="Dia da cobrança"
            type="number"
            inputMode="numeric"
            min={1}
            max={31}
            required
            value={dia}
            onChange={(e) => setDia(e.target.value)}
            erro={erros.dia}
          />
        </div>

        <Escolha
          label="Cobrada em"
          opcoes={[
            { valor: SEM_CARTAO, label: 'Débito (conta)' },
            ...cartoes.map((c) => ({
              valor: c.id,
              label: (
                <>
                  <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: c.cor }} />
                  {c.nome}
                </>
              ),
            })),
          ]}
          valor={cartaoId}
          aoMudar={setCartaoId}
        />
        <p className="-mt-3 text-xs text-texto-suave">
          {doBanco ? (
            'Vem do banco: cada cobrança que chega é reconhecida sozinha e atualiza o valor e o dia. Cancelou? Pause.'
          ) : (
            <>
              Todo mês, no dia da cobrança, o app lança a despesa sozinho na categoria Assinaturas
              {cartaoId === SEM_CARTAO ? '.' : ', na fatura do cartão.'}
            </>
          )}
        </p>

        <Campo
          id="parcelas-assinatura"
          label="Total de parcelas"
          inputMode="numeric"
          placeholder="Sem fim"
          value={parcelas}
          onChange={(e) => setParcelas(e.target.value.replace(/\D/g, '').slice(0, 3))}
          erro={erros.parcelas}
        />
        <p className="-mt-3 text-xs text-texto-suave">
          Deixe vazio para assinatura sem fim. Com parcelas (ex.: financiamento), ela sai das ativas quando a última for paga.
        </p>

        {jaPassouNoMes && cobrancaDesteMes && (
          <label className="flex items-start gap-3 rounded-xl border border-borda p-3.5">
            <input
              type="checkbox"
              checked={lancarAgora}
              onChange={(e) => setLancarAgora(e.target.checked)}
              className="mt-0.5 h-5 w-5 shrink-0 accent-primaria"
            />
            <span className="text-sm">
              <span className="font-medium">Lançar a cobrança deste mês agora</span>
              <span className="block text-texto-suave">
                O dia {formatarDiaMes(cobrancaDesteMes)} já passou. Desmarque se você já lançou essa cobrança à mão.
              </span>
            </span>
          </label>
        )}

        {erro && <Alerta>{erro}</Alerta>}
      </form>
    </Modal>
  )
}
