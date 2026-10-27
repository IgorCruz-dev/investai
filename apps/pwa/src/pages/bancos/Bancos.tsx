import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import Alerta from '../../components/Alerta'
import Botao from '../../components/Botao'
import Card from '../../components/Card'
import { EsqueletoLista } from '../../components/Esqueleto'
import Modal from '../../components/Modal'
import Sincronizar from '../../components/Sincronizar'
import { IconeBanco, IconeChevronDireita, IconeSincronizar } from '../../components/icones'
import { useLancamentos } from '../../hooks/useLancamentos'
import { hojeISO } from '../../lib/datas'
import { formatarDataHora, formatarMoeda } from '../../lib/formatar'
import { problemaDaConexao } from '../../lib/openFinance'
import { listarCartoes } from '../../services/cartoes'
import { listarContas } from '../../services/contas'
import {
  ErroOpenFinance,
  ajustarSaldoDaConta,
  atualizarContasDoBanco,
  criarDoBanco,
  listarConexoes,
  listarContasDoBanco,
  vincularCartao,
  vincularConta,
} from '../../services/openFinance'
import type { Cartao, ConexaoPluggy, Conta, ContaPluggy } from '../../types/financas'

const MEU_PLUGGY = 'https://meu.pluggy.ai'
const NAO_IMPORTAR = ''
const CRIAR = '__criar__'

const dataCurta = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' })

/** Open Finance: conexões, sincronização e vínculo de cada conta/cartão do banco com o app */
export default function Bancos() {
  const { versao, recarregar } = useLancamentos()
  const [conexoes, setConexoes] = useState<ConexaoPluggy[]>([])
  const [contasBanco, setContasBanco] = useState<ContaPluggy[]>([])
  const [contas, setContas] = useState<Conta[]>([])
  const [cartoes, setCartoes] = useState<Cartao[]>([])
  const [carregando, setCarregando] = useState(true)
  const [atualizando, setAtualizando] = useState(false)
  const [erro, setErro] = useState('')
  // Usuário sem Open Finance configurado (ou que não é o dono das conexões)
  const [semAcesso, setSemAcesso] = useState(false)
  const [salvando, setSalvando] = useState<string | null>(null)
  const [ajustando, setAjustando] = useState<{ conta: Conta; banco: ContaPluggy } | null>(null)

  async function carregar() {
    const [cx, cb, cts, crts] = await Promise.all([listarConexoes(), listarContasDoBanco(), listarContas(), listarCartoes()])
    setConexoes(cx)
    setContasBanco(cb)
    setContas(cts)
    setCartoes(crts)
    return cx
  }

  async function atualizarDoBanco() {
    setErro('')
    setAtualizando(true)
    try {
      await atualizarContasDoBanco()
      setSemAcesso(false)
      await carregar()
    } catch (e) {
      if (e instanceof ErroOpenFinance && (e.codigo === 'nao_liberado' || e.codigo === 'sem_conexoes')) setSemAcesso(true)
      else setErro((e as Error).message)
    } finally {
      setAtualizando(false)
    }
  }

  useEffect(() => {
    let ativo = true
    carregar()
      // Primeira visita: ainda não há nada salvo, então pergunta direto para a Pluggy
      .then((cx) => {
        if (ativo && cx.length === 0) return atualizarDoBanco()
      })
      .catch(() => ativo && setErro('Não foi possível carregar seus bancos.'))
      .finally(() => ativo && setCarregando(false))
    return () => {
      ativo = false
    }
  }, [versao])

  async function mudarVinculo(banco: ContaPluggy, escolha: string) {
    setErro('')
    setSalvando(banco.id)
    try {
      if (escolha === CRIAR) await criarDoBanco(banco)
      else if (banco.tipo === 'BANK') await vincularConta(banco.id, escolha || null)
      else await vincularCartao(banco.id, escolha || null)
      await carregar()
      recarregar()
    } catch (e) {
      setErro((e as Error).message)
    } finally {
      setSalvando(null)
    }
  }

  if (!carregando && semAcesso) return <ConecteSeusBancos />

  const doBanco = (tipo: ContaPluggy['tipo']) => contasBanco.filter((c) => c.tipo === tipo)

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Bancos</h1>
        <Link
          to="/bancos/categorias"
          className="flex h-10 items-center gap-1 rounded-xl border border-borda bg-superficie px-3.5 text-sm font-semibold transition hover:bg-superficie-2"
        >
          Categorias do banco
          <IconeChevronDireita className="h-4 w-4" />
        </Link>
      </div>
      <p className="mt-1 text-sm text-texto-suave">Open Finance via Meu Pluggy, só leitura. Lançamentos manuais continuam valendo.</p>

      {erro && (
        <div className="mt-4">
          <Alerta>{erro}</Alerta>
        </div>
      )}

      <div className="mt-5">
        <Sincronizar />
      </div>

      <Card
        titulo="Conexões"
        className="mt-6"
        semEspaco
        acao={
          <a href={MEU_PLUGGY} target="_blank" rel="noreferrer" className="text-sm font-semibold text-primaria hover:underline">
            Abrir meu.pluggy.ai
          </a>
        }
      >
        {carregando ? (
          <EsqueletoLista linhas={2} />
        ) : conexoes.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-texto-suave">Nenhuma conexão encontrada.</p>
        ) : (
          <ul className="divide-y divide-borda">
            {conexoes.map((c) => {
              const problema = problemaDaConexao(c)
              return (
                <li key={c.item_id} className="flex items-start gap-3 px-5 py-3.5">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-superficie-3 text-texto-suave">
                    <IconeBanco className="h-[18px] w-[18px]" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{c.banco}</span>
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                          problema?.grave
                            ? 'bg-erro-fundo text-despesa'
                            : problema
                              ? 'bg-aviso-fundo text-aviso-texto'
                              : 'bg-sucesso-fundo text-sucesso-texto'
                        }`}
                      >
                        {problema?.selo ?? 'Conectado'}
                      </span>
                    </div>
                    <p className="mt-0.5 text-xs text-texto-suave">
                      {c.atualizado_no_banco_em && <>Dados do banco de {formatarDataHora(c.atualizado_no_banco_em)}</>}
                      {c.consentimento_expira_em && (
                        <>
                          {c.atualizado_no_banco_em && ' · '}
                          Consentimento até {dataCurta.format(new Date(c.consentimento_expira_em))}
                        </>
                      )}
                    </p>
                    {problema && <p className={`mt-1 text-xs ${problema.grave ? 'text-despesa' : 'text-aviso-texto'}`}>{problema.texto}</p>}
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </Card>

      <Card
        titulo="Contas e cartões do banco"
        className="mt-6"
        semEspaco
        acao={
          <button
            onClick={atualizarDoBanco}
            disabled={atualizando}
            className="flex items-center gap-1.5 text-sm font-semibold text-primaria hover:underline disabled:opacity-60"
          >
            <IconeSincronizar className={`h-4 w-4 ${atualizando ? 'animate-spin' : ''}`} />
            Atualizar lista
          </button>
        }
      >
        <p className="border-b border-borda px-5 py-3 text-sm text-texto-suave">
          Escolha a qual conta ou cartão do app cada um corresponde. Só os vinculados são importados.
        </p>
        {carregando ? (
          <EsqueletoLista linhas={3} />
        ) : contasBanco.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-texto-suave">
            {atualizando ? 'Buscando no banco...' : 'Nenhuma conta encontrada nas conexões.'}
          </p>
        ) : (
          (['BANK', 'CREDIT'] as const).map((tipo) =>
            doBanco(tipo).length === 0 ? null : (
              <div key={tipo}>
                <p className="bg-superficie-2 px-5 py-2 text-xs font-semibold tracking-wide text-texto-suave uppercase">
                  {tipo === 'BANK' ? 'Contas' : 'Cartões de crédito'}
                </p>
                <ul className="divide-y divide-borda">
                  {doBanco(tipo).map((b) => (
                    <LinhaVinculo
                      key={b.id}
                      banco={b}
                      contas={contas}
                      cartoes={cartoes}
                      salvando={salvando === b.id}
                      aoMudar={(escolha) => mudarVinculo(b, escolha)}
                      aoAjustarSaldo={(conta) => setAjustando({ conta, banco: b })}
                    />
                  ))}
                </ul>
              </div>
            ),
          )
        )}
      </Card>

      {ajustando && (
        <ModalAjustarSaldo
          conta={ajustando.conta}
          banco={ajustando.banco}
          aoFechar={() => setAjustando(null)}
          aoAjustar={() => {
            setAjustando(null)
            recarregar()
          }}
        />
      )}
    </>
  )
}

type LinhaProps = {
  banco: ContaPluggy
  contas: Conta[]
  cartoes: Cartao[]
  salvando: boolean
  aoMudar: (escolha: string) => void
  aoAjustarSaldo: (conta: Conta) => void
}

function LinhaVinculo({ banco, contas, cartoes, salvando, aoMudar, aoAjustarSaldo }: LinhaProps) {
  const ehConta = banco.tipo === 'BANK'
  const opcoes = ehConta ? contas : cartoes
  const vinculada = opcoes.find((o) => o.pluggy_account_id === banco.id)
  const idSelect = `vinculo-${banco.id}`

  return (
    <li className="px-5 py-3.5">
      <div className="flex items-baseline justify-between gap-3">
        <span className="min-w-0">
          <span className="block truncate font-medium">
            {banco.nome}
            {banco.numero && <span className="text-texto-suave"> · {banco.numero.slice(-4)}</span>}
          </span>
          <span className="block text-xs text-texto-suave">{banco.banco}</span>
        </span>
        <span className="shrink-0 text-right text-sm">
          {ehConta
            ? banco.saldo !== null && <>Saldo {formatarMoeda(banco.saldo)}</>
            : banco.limite !== null && <>Limite {formatarMoeda(banco.limite)}</>}
        </span>
      </div>

      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        <label htmlFor={idSelect} className="sr-only">
          Corresponde a
        </label>
        <select
          id={idSelect}
          value={vinculada?.id ?? NAO_IMPORTAR}
          disabled={salvando}
          onChange={(e) => aoMudar(e.target.value)}
          className="h-10 min-w-0 flex-1 rounded-xl border border-borda bg-superficie px-3 text-base outline-none sm:text-sm focus:border-primaria focus:ring-4 focus:ring-primaria/15 disabled:opacity-60"
        >
          <option value={NAO_IMPORTAR}>Não importar</option>
          {opcoes.map((o) => (
            <option key={o.id} value={o.id} disabled={Boolean(o.pluggy_account_id && o.pluggy_account_id !== banco.id)}>
              {o.nome}
              {o.pluggy_account_id && o.pluggy_account_id !== banco.id ? ' (já vinculado)' : ''}
            </option>
          ))}
          {!vinculada && <option value={CRIAR}>+ Criar {ehConta ? 'conta' : 'cartão'} "{banco.nome}" no app</option>}
        </select>
        {ehConta && vinculada && banco.saldo !== null && (
          <button
            onClick={() => aoAjustarSaldo(vinculada as Conta)}
            className="h-10 rounded-xl border border-borda px-3 text-sm font-semibold transition hover:bg-superficie-2"
          >
            Ajustar saldo
          </button>
        )}
      </div>
      {!ehConta && !vinculada && (banco.dia_fechamento === null || banco.dia_vencimento === null) && (
        <p className="mt-1.5 text-xs text-texto-suave">
          O banco não informou fechamento/vencimento: ao criar, confira esses dias em Cartões.
        </p>
      )}
    </li>
  )
}

type AjusteProps = { conta: Conta; banco: ContaPluggy; aoFechar: () => void; aoAjustar: () => void }

/** Confirma antes de mexer no saldo inicial da conta */
function ModalAjustarSaldo({ conta, banco, aoFechar, aoAjustar }: AjusteProps) {
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState('')

  async function confirmar() {
    setErro('')
    setSalvando(true)
    try {
      await ajustarSaldoDaConta(conta.id, banco.saldo ?? 0, hojeISO())
      aoAjustar()
    } catch (e) {
      setErro((e as Error).message)
      setSalvando(false)
    }
  }

  return (
    <Modal aberto aoFechar={aoFechar} titulo="Ajustar saldo">
      <div className="flex flex-col gap-4">
        <p className="text-texto-suave">
          O saldo de <strong className="text-texto">{conta.nome}</strong> no app passa a bater com o do banco:{' '}
          <strong className="text-texto">{formatarMoeda(banco.saldo ?? 0)}</strong>. Só o saldo inicial da conta muda; os
          lançamentos ficam como estão.
        </p>
        {erro && <Alerta>{erro}</Alerta>}
        <Botao carregando={salvando} onClick={confirmar}>
          Ajustar saldo
        </Botao>
        <button
          type="button"
          onClick={aoFechar}
          disabled={salvando}
          className="h-11 rounded-xl text-sm font-medium text-texto-suave transition hover:bg-superficie-2 hover:text-texto"
        >
          Cancelar
        </button>
      </div>
    </Modal>
  )
}

/** Quem ainda não tem Open Finance: passo a passo para conectar */
function ConecteSeusBancos() {
  const passos = [
    <>
      Conecte seus bancos em{' '}
      <a href={MEU_PLUGGY} target="_blank" rel="noreferrer" className="font-semibold text-primaria hover:underline">
        meu.pluggy.ai
      </a>{' '}
      (uso pessoal, só leitura).
    </>,
    <>Copie o Client ID, o Client Secret e os IDs das conexões no painel da Pluggy.</>,
    <>
      Cadastre-os como secrets da função <code className="text-texto">sync-pluggy</code> no Supabase, junto com o seu id de
      usuário.
    </>,
    <>Volte aqui, vincule cada conta e cartão e toque em Sincronizar.</>,
  ]

  return (
    <>
      <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Bancos</h1>
      <div className="mt-6 rounded-2xl border border-borda bg-superficie p-6">
        <span className="flex h-12 w-12 items-center justify-center rounded-full bg-sucesso-fundo text-primaria">
          <IconeBanco className="h-6 w-6" />
        </span>
        <p className="mt-4 text-lg font-semibold">Conecte seus bancos</p>
        <p className="mt-1 text-sm text-texto-suave">
          Com o Open Finance, suas compras e transferências entram sozinhas. Os lançamentos manuais continuam funcionando.
        </p>
        <ol className="mt-5 space-y-3">
          {passos.map((passo, i) => (
            <li key={i} className="flex gap-3 text-sm">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-superficie-3 text-xs font-semibold">
                {i + 1}
              </span>
              <span className="pt-0.5">{passo}</span>
            </li>
          ))}
        </ol>
      </div>
    </>
  )
}
