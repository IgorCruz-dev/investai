import { useEffect, useState, type SubmitEvent } from 'react'
import { hojeISO } from '../lib/datas'
import { dividirEmParcelas } from '../lib/fatura'
import { formatarMoeda } from '../lib/formatar'
import { listarCartoes } from '../services/cartoes'
import { listarCategorias } from '../services/categorias'
import { listarContas } from '../services/contas'
import {
  atualizarLancamento,
  criarLancamento,
  excluirGrupoDeParcelas,
  excluirTransacao,
  type DadosLancamento,
} from '../services/transacoes'
import type { PadraoLancamento } from '../contexts/lancamentos'
import type { Cartao, Categoria, Conta, FormaPagamento, TipoTransacao, Transacao } from '../types/financas'
import Alerta from './Alerta'
import Botao from './Botao'
import Campo from './Campo'
import CampoValor from './CampoValor'
import Escolha, { type Opcao } from './Escolha'
import Modal from './Modal'
import SeletorCategoria from './SeletorCategoria'

type Props = {
  /** null = novo lançamento */
  transacao: Transacao | null
  /** Valores já escolhidos num lançamento novo (ex.: crédito no cartão X) */
  padrao?: PadraoLancamento
  /** Abre direto na confirmação de exclusão */
  iniciarExcluindo?: boolean
  aoFechar: () => void
  /** Chamado depois de salvar ou excluir, para as telas recarregarem */
  aoSalvar: () => void
}

type Erros = Partial<Record<'valor' | 'cartao' | 'local' | 'data', string>>

const todasAsFormas: Opcao<FormaPagamento>[] = [
  { valor: 'pix', label: 'Pix' },
  { valor: 'debito', label: 'Débito' },
  { valor: 'dinheiro', label: 'Dinheiro' },
  { valor: 'credito', label: 'Crédito' },
]
// Receita não entra no crédito
const formasDeReceita = todasAsFormas.filter((f) => f.valor !== 'credito')

const opcoesParcelas = Array.from({ length: 12 }, (_, i) => i + 1)

export default function ModalLancamento({ transacao, padrao, iniciarExcluindo = false, aoFechar, aoSalvar }: Props) {
  const editando = transacao !== null
  const ehParcela = Boolean(transacao?.grupo_parcela)
  const ehPagamento = Boolean(transacao?.pagamento_cartao_id)

  const [categorias, setCategorias] = useState<Categoria[]>([])
  const [contas, setContas] = useState<Conta[]>([])
  const [cartoes, setCartoes] = useState<Cartao[]>([])

  const [tipo, setTipo] = useState<TipoTransacao>(transacao?.tipo ?? 'despesa')
  const [centavos, setCentavos] = useState(transacao ? Math.round(transacao.valor * 100) : 0)
  const [forma, setForma] = useState<FormaPagamento>(transacao?.forma ?? padrao?.forma ?? 'pix')
  const [cartaoId, setCartaoId] = useState<string | null>(transacao?.cartao_id ?? padrao?.cartaoId ?? null)
  const [contaId, setContaId] = useState<string | null>(transacao?.conta_id ?? null)
  const [parcelas, setParcelas] = useState(1)
  const [local, setLocal] = useState(transacao?.local ?? '')
  const [descricao, setDescricao] = useState(transacao?.descricao ?? '')
  const [observacao, setObservacao] = useState(transacao?.observacao ?? '')
  const [categoriaId, setCategoriaId] = useState<string | null>(transacao?.categoria_id ?? null)
  const [data, setData] = useState(transacao?.data ?? hojeISO())

  const [tentouSalvar, setTentouSalvar] = useState(false)
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState('')
  const [confirmandoExclusao, setConfirmandoExclusao] = useState(iniciarExcluindo)

  useEffect(() => {
    let ativo = true
    Promise.all([listarCategorias(), listarContas(), listarCartoes()])
      .then(([cats, cts, crts]) => {
        if (!ativo) return
        setCategorias(cats)
        setContas(cts)
        setCartoes(crts)
        // Num lançamento novo, com uma só conta/cartão, já deixa escolhido
        if (!transacao) {
          if (cts.length === 1) setContaId(cts[0].id)
          if (crts.length === 1) setCartaoId((atual) => atual ?? crts[0].id)
        }
      })
      .catch(() => ativo && setErro('Não foi possível carregar categorias, contas e cartões.'))
    return () => {
      ativo = false
    }
  }, [transacao])

  const noCredito = forma === 'credito'
  const cartao = cartoes.find((c) => c.id === cartaoId) ?? null

  function validar(): Erros {
    const erros: Erros = {}
    if (centavos <= 0) erros.valor = 'Informe o valor.'
    else if (noCredito && !editando && centavos < parcelas) erros.valor = `Valor baixo demais para ${parcelas} parcelas.`
    if (noCredito) {
      if (!cartaoId) erros.cartao = cartoes.length ? 'Escolha o cartão.' : 'Nenhum cartão cadastrado ainda.'
      if (!local.trim()) erros.local = 'Informe onde foi a compra.'
    }
    if (!data) erros.data = 'Informe a data.'
    return erros
  }
  const erros = tentouSalvar ? validar() : {}

  function mudarTipo(novo: TipoTransacao) {
    setTipo(novo)
    if (novo === 'receita' && forma === 'credito') setForma('pix')
  }

  async function aoEnviar(e: SubmitEvent<HTMLFormElement>) {
    e.preventDefault()
    setErro('')
    setTentouSalvar(true)
    if (Object.keys(validar()).length > 0) return

    const dados: DadosLancamento = {
      tipo,
      forma,
      valorCentavos: centavos,
      local,
      descricao,
      observacao,
      categoriaId,
      data,
      contaId,
      cartao,
      parcelas: noCredito ? parcelas : 1,
    }
    setSalvando(true)
    try {
      if (transacao) await atualizarLancamento(transacao, dados)
      else await criarLancamento(dados)
      aoSalvar()
      aoFechar()
    } catch (err) {
      setErro((err as Error).message)
      setSalvando(false)
    }
  }

  async function excluir(todasDoGrupo: boolean) {
    if (!transacao) return
    setErro('')
    setSalvando(true)
    try {
      if (todasDoGrupo && transacao.grupo_parcela) await excluirGrupoDeParcelas(transacao.grupo_parcela)
      else await excluirTransacao(transacao.id)
      aoSalvar()
      aoFechar()
    } catch (err) {
      setErro((err as Error).message)
      setSalvando(false)
    }
  }

  if (confirmandoExclusao && transacao) {
    return (
      <Modal aberto aoFechar={aoFechar} titulo="Excluir lançamento">
        <div className="flex flex-col gap-4">
          <p className="text-texto-suave">
            {ehParcela
              ? `Esta é a parcela ${transacao.parcela_atual} de ${transacao.total_parcelas}. O que você quer excluir?`
              : ehPagamento
                ? 'Excluir este pagamento faz a fatura voltar a ficar em aberto/fechada. Tem certeza?'
                : 'Tem certeza? Essa ação não pode ser desfeita.'}
          </p>
          {erro && <Alerta>{erro}</Alerta>}
          <div className="flex flex-col gap-2">
            {ehParcela ? (
              <>
                <Botao variante="perigo" carregando={salvando} onClick={() => excluir(false)}>
                  Só esta parcela
                </Botao>
                <Botao variante="secundaria" disabled={salvando} onClick={() => excluir(true)}>
                  Todas as {transacao.total_parcelas} parcelas
                </Botao>
              </>
            ) : (
              <Botao variante="perigo" carregando={salvando} onClick={() => excluir(false)}>
                Excluir
              </Botao>
            )}
            <button
              type="button"
              onClick={() => setConfirmandoExclusao(false)}
              disabled={salvando}
              className="h-11 rounded-xl text-sm font-medium text-texto-suave transition hover:bg-slate-50 hover:text-texto"
            >
              Cancelar
            </button>
          </div>
        </div>
      </Modal>
    )
  }

  const valoresParcelas = noCredito && parcelas > 1 ? dividirEmParcelas(centavos, parcelas) : null

  return (
    <Modal
      aberto
      aoFechar={aoFechar}
      titulo={editando ? 'Editar lançamento' : 'Novo lançamento'}
      rodape={
        <div className="flex flex-col gap-2">
          <Botao type="submit" form="form-lancamento" carregando={salvando}>
            {salvando ? 'Salvando...' : editando ? 'Salvar alterações' : 'Salvar lançamento'}
          </Botao>
          {editando && (
            <button
              type="button"
              onClick={() => setConfirmandoExclusao(true)}
              disabled={salvando}
              className="h-10 rounded-xl text-sm font-semibold text-despesa transition hover:bg-red-50"
            >
              Excluir lançamento
            </button>
          )}
        </div>
      }
    >
      <form id="form-lancamento" onSubmit={aoEnviar} noValidate className="flex flex-col gap-5">
        {/* Despesa / Receita */}
        <div role="group" aria-label="Tipo" className="grid grid-cols-2 gap-1 rounded-xl bg-slate-100 p-1">
          {(['despesa', 'receita'] as const).map((t) => (
            <button
              key={t}
              type="button"
              aria-pressed={tipo === t}
              disabled={ehParcela || ehPagamento}
              onClick={() => mudarTipo(t)}
              className={`h-10 rounded-lg text-sm font-semibold transition disabled:cursor-not-allowed ${tipo === t ? `bg-white shadow-sm ${t === 'despesa' ? 'text-despesa' : 'text-receita'}` : 'text-texto-suave'}`}
            >
              {t === 'despesa' ? 'Despesa' : 'Receita'}
            </button>
          ))}
        </div>

        <CampoValor centavos={centavos} aoMudar={setCentavos} tipo={tipo} erro={erros.valor} />

        {ehParcela && (
          <p className="rounded-xl bg-slate-50 px-3.5 py-3 text-sm text-texto-suave">
            Parcela {transacao?.parcela_atual} de {transacao?.total_parcelas}. Aqui você muda só esta parcela; forma,
            cartão e data valem para todas. Para mudar isso, exclua e lance de novo.
          </p>
        )}

        {ehPagamento && (
          <p className="rounded-xl bg-slate-50 px-3.5 py-3 text-sm text-texto-suave">
            Pagamento de fatura de cartão. Ele desconta do saldo, mas não entra nas despesas do mês (as compras já
            contaram quando foram feitas).
          </p>
        )}

        <Escolha
          label="Forma de pagamento"
          opcoes={tipo === 'receita' ? formasDeReceita : todasAsFormas}
          valor={forma}
          aoMudar={setForma}
          desabilitado={ehParcela || ehPagamento}
        />

        {noCredito && (
          <>
            {cartoes.length > 0 ? (
              <Escolha
                label="Cartão"
                obrigatorio
                opcoes={cartoes.map((c) => ({
                  valor: c.id,
                  label: (
                    <>
                      <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: c.cor }} />
                      {c.nome}
                    </>
                  ),
                }))}
                valor={cartaoId}
                aoMudar={setCartaoId}
                erro={erros.cartao}
                desabilitado={ehParcela}
              />
            ) : (
              <Alerta>Nenhum cartão cadastrado ainda. Cadastre um cartão para lançar no crédito.</Alerta>
            )}

            {!editando && (
              <div className="flex flex-col gap-1.5">
                <label htmlFor="parcelas" className="text-sm font-medium text-texto">
                  Parcelas
                </label>
                <select
                  id="parcelas"
                  value={parcelas}
                  onChange={(e) => setParcelas(Number(e.target.value))}
                  className="h-12 rounded-xl border border-borda bg-white px-3.5 text-base outline-none focus:border-primaria focus:ring-4 focus:ring-primaria/15"
                >
                  {opcoesParcelas.map((n) => (
                    <option key={n} value={n}>
                      {n === 1 ? 'À vista (1x)' : `${n}x`}
                    </option>
                  ))}
                </select>
                {valoresParcelas && centavos > 0 && (
                  <p className="text-sm text-texto-suave">
                    {valoresParcelas[0] === valoresParcelas[1]
                      ? `${parcelas}x de ${formatarMoeda(valoresParcelas[0] / 100)}`
                      : `1x de ${formatarMoeda(valoresParcelas[0] / 100)} + ${parcelas - 1}x de ${formatarMoeda(valoresParcelas[1] / 100)}`}
                  </p>
                )}
              </div>
            )}
          </>
        )}

        {!noCredito && contas.length > 1 && (
          <Escolha
            label="Conta"
            opcoes={contas.map((c) => ({ valor: c.id, label: c.nome }))}
            valor={contaId}
            aoMudar={setContaId}
          />
        )}

        <Campo
          id="local"
          label={tipo === 'receita' ? 'De onde veio' : 'Local (onde gastei)'}
          placeholder={tipo === 'receita' ? 'Ex.: Salário, cliente...' : 'Ex.: Mercado, Uber...'}
          required={noCredito}
          maxLength={80}
          value={local}
          onChange={(e) => setLocal(e.target.value)}
          erro={erros.local}
        />

        <SeletorCategoria
          categorias={categorias}
          valor={categoriaId}
          aoMudar={setCategoriaId}
          aoCriar={(nova) => setCategorias((atuais) => [...atuais, nova].sort((a, b) => a.nome.localeCompare(b.nome)))}
        />

        <Campo
          id="data"
          label="Data"
          type="date"
          required
          disabled={ehParcela}
          value={data}
          onChange={(e) => setData(e.target.value)}
          erro={erros.data}
        />

        <Campo
          id="descricao"
          label="Descrição (opcional)"
          placeholder="Algum detalhe para lembrar depois"
          maxLength={140}
          value={descricao}
          onChange={(e) => setDescricao(e.target.value)}
        />

        <Campo
          id="observacao"
          label="Observação (opcional)"
          placeholder="Ex.: dividido com fulano, garantia até..."
          maxLength={280}
          value={observacao}
          onChange={(e) => setObservacao(e.target.value)}
        />

        {erro && <Alerta>{erro}</Alerta>}
      </form>
    </Modal>
  )
}
