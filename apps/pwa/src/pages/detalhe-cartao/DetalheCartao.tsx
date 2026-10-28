import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link, useParams, useSearchParams } from 'react-router'
import Alerta from '../../components/Alerta'
import Botao from '../../components/Botao'
import Card from '../../components/Card'
import Esqueleto, { EsqueletoLista } from '../../components/Esqueleto'
import GraficoFaturas, { type BarraFatura } from '../../components/GraficoFaturas'
import IconeCategoria, { COR_SEM_CATEGORIA } from '../../components/IconeCategoria'
import ModalCartao from '../../components/ModalCartao'
import ModalDetalheTransacao from '../../components/ModalDetalheTransacao'
import ModalPagarFatura from '../../components/ModalPagarFatura'
import {
  IconeBusca,
  IconeCartao,
  IconeCheck,
  IconeChevronDireita,
  IconeChevronEsquerda,
  IconeFechar,
  IconeLapis,
  IconeMais,
} from '../../components/icones'
import { useLancamentos } from '../../hooks/useLancamentos'
import { deMesISO, paraISO, paraMesISO } from '../../lib/datas'
import { datasDaFatura, mesDaFatura, statusDaFatura, type StatusFatura } from '../../lib/fatura'
import { formatarDiaMes, formatarMesAno, formatarMoeda } from '../../lib/formatar'
import { buscarCartao } from '../../services/cartoes'
import { listarCategorias } from '../../services/categorias'
import { listarPagamentosDaFatura, listarTransacoesDaFatura, totaisDasFaturas } from '../../services/transacoes'
import type { Cartao, Categoria, Transacao } from '../../types/financas'

const CATEGORIAS_VISIVEIS = 6
const FATURAS_NO_GRAFICO = 6
const TRANSACOES_VISIVEIS = 10

const selos: Record<StatusFatura, { texto: string; classes: string }> = {
  aberta: { texto: 'Em aberto', classes: 'border-alerta/30 bg-alerta/10 text-alerta' },
  fechada: { texto: 'Fechada', classes: 'border-sky-400/30 bg-sky-400/12 text-sky-300' },
  parcial: { texto: 'Paga em parte', classes: 'border-lilas/30 bg-lilas/12 text-lilas' },
  paga: { texto: 'Paga', classes: 'border-primaria/30 bg-primaria/12 text-destaque' },
}

type GastoCategoria = { chave: string; centavos: number }

/** Compra soma, estorno (crédito no cartão) desconta */
const centavosDe = (t: Transacao) => (t.tipo === 'despesa' ? 1 : -1) * Math.round(t.valor * 100)

/**
 * Detalhe do cartão: fatura do mês, gastos por categoria e transações. Endereço: /cartoes/:id?fatura=2026-11
 * Mostra só o que é meu; o que é de outras pessoas aparece somado (o pagamento continua sendo da fatura inteira).
 */
export default function DetalheCartao() {
  const { id = '' } = useParams()
  const [parametros, setParametros] = useSearchParams()
  const { versao, novoLancamento, editarLancamento } = useLancamentos()

  const [cartao, setCartao] = useState<Cartao | null>(null)
  const [naoEncontrado, setNaoEncontrado] = useState(false)
  const [categorias, setCategorias] = useState<Categoria[]>([])
  const [transacoes, setTransacoes] = useState<Transacao[]>([])
  const [pagamentos, setPagamentos] = useState<Transacao[]>([])
  const [totaisAnteriores, setTotaisAnteriores] = useState<Map<string, number>>(new Map())
  const [carregando, setCarregando] = useState(true)
  const [faturaCarregada, setFaturaCarregada] = useState(false)
  const [erro, setErro] = useState('')
  const [recarregar, setRecarregar] = useState(0)

  const [filtroCategoria, setFiltroCategoria] = useState<string | null>(null)
  const [todasCategorias, setTodasCategorias] = useState(false)
  const [todasTransacoes, setTodasTransacoes] = useState(false)
  const [busca, setBusca] = useState('')

  const [editandoCartao, setEditandoCartao] = useState(false)
  const [pagando, setPagando] = useState(false)
  const [detalhe, setDetalhe] = useState<Transacao | null>(null)

  // Fatura mostrada: a da URL ou, sem ela, a que recebe as compras de hoje
  const faturaNaUrl = parametros.get('fatura')
  const fatura = useMemo(() => {
    const daUrl = deMesISO(faturaNaUrl)
    if (daUrl) return daUrl
    return cartao ? mesDaFatura(new Date(), cartao.dia_fechamento, cartao.dia_vencimento) : null
  }, [faturaNaUrl, cartao])

  useEffect(() => {
    let ativo = true
    Promise.all([buscarCartao(id), listarCategorias()])
      .then(([c, cats]) => {
        if (!ativo) return
        setCartao(c)
        setNaoEncontrado(c === null)
        setCategorias(cats)
      })
      .catch(() => ativo && setErro('Não foi possível carregar o cartão.'))
    return () => {
      ativo = false
    }
  }, [id, versao, recarregar])

  useEffect(() => {
    if (!fatura) return
    let ativo = true
    setCarregando(true)
    const primeiraDoGrafico = new Date(fatura.getFullYear(), fatura.getMonth() - (FATURAS_NO_GRAFICO - 1), 1)
    Promise.all([
      listarTransacoesDaFatura(id, fatura),
      listarPagamentosDaFatura(id, fatura),
      totaisDasFaturas(id, primeiraDoGrafico, fatura, true),
    ])
      .then(([ts, pg, totais]) => {
        if (!ativo) return
        setTransacoes(ts)
        setPagamentos(pg)
        setTotaisAnteriores(totais)
        setFaturaCarregada(true)
        setErro('')
      })
      .catch(() => ativo && setErro('Não foi possível carregar a fatura.'))
      .finally(() => ativo && setCarregando(false))
    return () => {
      ativo = false
    }
  }, [id, fatura, versao, recarregar])

  // Ao trocar de fatura, limpa filtros e listas abertas
  useEffect(() => {
    setFiltroCategoria(null)
    setTodasCategorias(false)
    setTodasTransacoes(false)
    setBusca('')
  }, [faturaNaUrl])

  const categoriaPorId = useMemo(() => new Map(categorias.map((c) => [c.id, c])), [categorias])

  // Fatura inteira (é o que o banco cobra) e só a minha parte (o que a tela mostra)
  const totalCentavos = useMemo(() => transacoes.reduce((soma, t) => soma + centavosDe(t), 0), [transacoes])
  const minhas = useMemo(() => transacoes.filter((t) => !t.terceiro), [transacoes])
  const minhaParteCentavos = useMemo(() => minhas.reduce((soma, t) => soma + centavosDe(t), 0), [minhas])
  // Quanto de cada pessoa está nesta fatura
  const deOutros = useMemo(() => {
    const porPessoa = new Map<string, number>()
    for (const t of transacoes) if (t.terceiro) porPessoa.set(t.terceiro, (porPessoa.get(t.terceiro) ?? 0) + centavosDe(t))
    return [...porPessoa.entries()].sort((a, b) => b[1] - a[1])
  }, [transacoes])

  const pagoCentavos = useMemo(() => pagamentos.reduce((soma, p) => soma + Math.round(p.valor * 100), 0), [pagamentos])

  const porCategoria = useMemo<GastoCategoria[]>(() => {
    const somas = new Map<string, number>()
    for (const t of minhas) {
      if (t.tipo !== 'despesa') continue
      const chave = t.categoria_id ?? 'sem'
      somas.set(chave, (somas.get(chave) ?? 0) + Math.round(t.valor * 100))
    }
    return [...somas.entries()].map(([chave, centavos]) => ({ chave, centavos })).sort((a, b) => b.centavos - a.centavos)
  }, [minhas])

  const filtradas = useMemo(() => {
    const termo = busca.trim().toLocaleLowerCase('pt-BR')
    return minhas.filter((t) => {
      if (filtroCategoria && (t.categoria_id ?? 'sem') !== filtroCategoria) return false
      if (!termo) return true
      return [t.local, t.descricao].some((texto) => texto?.toLocaleLowerCase('pt-BR').includes(termo))
    })
  }, [minhas, filtroCategoria, busca])

  if (naoEncontrado) {
    return (
      <div className="py-16 text-center">
        <p className="font-medium">Cartão não encontrado.</p>
        <Link to="/cartoes" className="mt-3 inline-block text-sm font-semibold text-destaque hover:underline">
          Voltar para Cartões
        </Link>
      </div>
    )
  }

  if (!cartao || !fatura) {
    return erro ? (
      <Alerta>{erro}</Alerta>
    ) : (
      <div aria-busy="true" aria-label="Carregando">
        <Esqueleto className="h-4 w-20" />
        <div className="mt-3 flex items-center gap-3">
          <Esqueleto className="h-12 w-12 rounded-2xl" />
          <div className="flex flex-1 flex-col gap-2">
            <Esqueleto className="h-6 w-40" />
            <Esqueleto className="h-4 w-28" />
          </div>
        </div>
        <Esqueleto className="mt-6 h-44 rounded-2xl" />
        <Card titulo="Transações da fatura" className="mt-6" semEspaco>
          <EsqueletoLista linhas={4} />
        </Card>
      </div>
    )
  }

  const { vencimento, ultimoDiaDeCompras, fechamento } = datasDaFatura(fatura, cartao.dia_fechamento, cartao.dia_vencimento)
  const status = statusDaFatura(fechamento, pagoCentavos, totalCentavos)
  const faltaCentavos = Math.max(totalCentavos - pagoCentavos, 0)
  const selo = selos[status]
  const nomeDaCategoria = (chave: string) =>
    chave === 'sem' ? 'Sem categoria' : (categoriaPorId.get(chave)?.nome ?? 'Categoria')
  const maiorCategoria = porCategoria[0]?.centavos ?? 0
  const categoriasMostradas = todasCategorias ? porCategoria : porCategoria.slice(0, CATEGORIAS_VISIVEIS)
  const transacoesMostradas = todasTransacoes ? filtradas : filtradas.slice(0, TRANSACOES_VISIVEIS)

  function abrirFatura(mes: Date) {
    const proximos = new URLSearchParams(parametros)
    proximos.set('fatura', paraMesISO(mes))
    setParametros(proximos, { replace: true })
  }

  function irParaFatura(meses: number) {
    if (fatura) abrirFatura(new Date(fatura.getFullYear(), fatura.getMonth() + meses, 1))
  }

  // Últimas faturas até a escolhida, da mais antiga para a mais nova
  const barras: BarraFatura[] = Array.from({ length: FATURAS_NO_GRAFICO }, (_, i) => {
    const mes = new Date(fatura.getFullYear(), fatura.getMonth() - (FATURAS_NO_GRAFICO - 1) + i, 1)
    return { mes, centavos: totaisAnteriores.get(paraISO(mes)) ?? 0, selecionada: i === FATURAS_NO_GRAFICO - 1 }
  })

  const recarregando = carregando ? 'opacity-60 transition' : 'transition'

  return (
    <>
      <Link
        to="/cartoes"
        className="-ml-1 inline-flex items-center gap-1 text-sm font-medium text-texto-suave transition hover:text-texto"
      >
        <IconeChevronEsquerda className="h-4 w-4" />
        Cartões
      </Link>

      {/* a) Cabeçalho */}
      <div className="mt-3 flex items-center gap-3">
        <span
          className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl text-white shadow-sm"
          style={{ backgroundColor: cartao.cor }}
        >
          <IconeCartao className="h-6 w-6" />
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-2xl font-bold tracking-tight">{cartao.nome}</h1>
          <p className="text-sm text-texto-suave">Vence em {formatarDiaMes(vencimento)}</p>
        </div>
        <button
          onClick={() => setEditandoCartao(true)}
          aria-label="Editar cartão"
          title="Editar cartão"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-borda vidro text-texto-suave transition hover:text-texto"
        >
          <IconeLapis className="h-4 w-4" />
        </button>
      </div>

      {/* b) Período de compras */}
      <p className="mt-4 text-sm text-texto-suave">
        Período de compras até <strong className="font-semibold text-texto">{formatarDiaMes(ultimoDiaDeCompras)}</strong>
      </p>

      {erro && (
        <div className="mt-4">
          <Alerta>{erro}</Alerta>
        </div>
      )}

      {/* No computador: valor da fatura ao lado do gráfico; categorias ao lado das transações */}
      <div className="lg:mt-6 lg:grid lg:grid-cols-2 lg:gap-6">
        {/* c) Valor da fatura */}
        <section
          className={`mt-4 flex flex-col justify-center lg:mt-0 rounded-[28px] solido p-5 ${recarregando}`}
          aria-label="Valor da fatura"
        >
          <div className="flex items-center justify-between gap-2">
            <button onClick={() => irParaFatura(-1)} aria-label="Fatura anterior" className={estiloSeta}>
              <IconeChevronEsquerda className="h-5 w-5" />
            </button>
            <p className="text-sm font-semibold" aria-live="polite">
              Fatura de {formatarMesAno(fatura).toLowerCase()}
            </p>
            <button onClick={() => irParaFatura(1)} aria-label="Próxima fatura" className={estiloSeta}>
              <IconeChevronDireita className="h-5 w-5" />
            </button>
          </div>
          <div className="mt-4 flex flex-col items-center gap-2">
            <p className="text-sm text-texto-suave">{deOutros.length ? 'Sua parte da fatura' : 'Valor da fatura'}</p>
            {faturaCarregada ? (
              <p className="text-4xl font-bold tracking-tight">{formatarMoeda(minhaParteCentavos / 100)}</p>
            ) : (
              <Esqueleto className="h-10 w-40" />
            )}
            {faturaCarregada && deOutros.length > 0 && (
              <p className="text-center text-xs text-texto-suave">
                Fatura inteira {formatarMoeda(totalCentavos / 100)} ·{' '}
                {deOutros.map(([pessoa, centavos], i) => (
                  <span key={pessoa}>
                    {i > 0 && ', '}
                    {formatarMoeda(centavos / 100)} de {pessoa}
                  </span>
                ))}{' '}
                ·{' '}
                <Link to="/acertos" className="font-medium text-texto underline-offset-2 hover:underline">
                  Acertos
                </Link>
              </p>
            )}
            <span className={`rounded-full border px-3 py-0.5 text-xs font-semibold ${selo.classes}`}>{selo.texto}</span>
            {status === 'parcial' && (
              <p className="text-sm text-texto-suave">
                Falta pagar <strong className="text-texto">{formatarMoeda(faltaCentavos / 100)}</strong>
              </p>
            )}
            {pagamentos.map((p) => (
              <button
                key={p.id}
                onClick={() => setDetalhe(p)}
                className="text-xs text-texto-suave underline-offset-2 hover:text-texto hover:underline"
              >
                Pago em {formatarDiaMes(p.data)} · {formatarMoeda(p.valor)}
              </button>
            ))}
          </div>
        </section>

        {/* Faturas anteriores: comparação com os meses anteriores */}
        <Card titulo="Faturas anteriores" className={`mt-6 lg:mt-0 ${recarregando}`}>
          {!faturaCarregada ? (
            <Esqueleto className="h-56" />
          ) : barras.every((b) => b.centavos === 0) ? (
            <p className="py-10 text-center text-sm text-texto-suave">
              Nenhuma fatura com compras nos últimos {FATURAS_NO_GRAFICO} meses.
            </p>
          ) : (
            <GraficoFaturas barras={barras} aoEscolher={abrirFatura} />
          )}
        </Card>
      </div>

      <div className="lg:mt-6 lg:grid lg:grid-cols-5 lg:items-start lg:gap-6">
        {/* d) Gastos por categoria */}
        <Card
          className={`mt-6 lg:col-span-2 lg:mt-0 ${recarregando}`}
          semEspaco
          titulo="Gastos por categoria"
          acao={
            <span className="text-sm text-texto-suave">
              {minhas.length} {minhas.length === 1 ? 'transação' : 'transações'}
            </span>
          }
        >
          {!faturaCarregada ? (
            <EsqueletoLista linhas={3} />
          ) : porCategoria.length === 0 ? (
            <p className="px-5 py-8 text-center text-sm text-texto-suave">Nenhuma compra nesta fatura.</p>
          ) : (
            <>
              <ul className="divide-y divide-borda">
                {categoriasMostradas.map((g) => {
                  const categoria = categoriaPorId.get(g.chave)
                  const escolhida = filtroCategoria === g.chave
                  return (
                    <li key={g.chave}>
                      <button
                        onClick={() => setFiltroCategoria(escolhida ? null : g.chave)}
                        aria-pressed={escolhida}
                        className={`flex w-full items-center gap-3 px-5 py-3 text-left transition ${escolhida ? 'bg-primaria/12' : 'hover:bg-texto/[0.05]'}`}
                      >
                        <IconeCategoria icone={categoria?.icone} cor={categoria?.cor} tamanho="pequeno" />
                        <span className="min-w-0 flex-1">
                          <span className="flex items-baseline justify-between gap-3">
                            <span className="truncate text-sm font-medium">{nomeDaCategoria(g.chave)}</span>
                            <span className="shrink-0 text-sm font-semibold">{formatarMoeda(g.centavos / 100)}</span>
                          </span>
                          <span className="mt-1.5 block h-1.5 overflow-hidden rounded-full bg-texto/[0.07]">
                            <span
                              className="block h-full rounded-full"
                              style={{
                                width: `${maiorCategoria ? (g.centavos / maiorCategoria) * 100 : 0}%`,
                                backgroundColor: categoria?.cor ?? COR_SEM_CATEGORIA,
                              }}
                            />
                          </span>
                        </span>
                      </button>
                    </li>
                  )
                })}
              </ul>
              {porCategoria.length > CATEGORIAS_VISIVEIS && (
                <button
                  onClick={() => setTodasCategorias(!todasCategorias)}
                  className="w-full border-t border-borda py-3 text-sm font-semibold text-destaque transition hover:bg-texto/[0.05]"
                >
                  {todasCategorias ? 'Mostrar menos' : `+${porCategoria.length - CATEGORIAS_VISIVEIS} categorias`}
                </button>
              )}
            </>
          )}
        </Card>

        {/* e) Transações da fatura */}
        <Card className={`mt-6 lg:col-span-3 lg:mt-0 ${recarregando}`} semEspaco titulo="Transações da fatura">
          {(filtroCategoria || todasTransacoes) && (
            <div className="flex flex-col gap-3 border-b border-borda px-5 py-3">
              {todasTransacoes && (
                <label className="relative block">
                  <span className="sr-only">Buscar por local ou descrição</span>
                  <IconeBusca className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-texto-suave" />
                  <input
                    value={busca}
                    onChange={(e) => setBusca(e.target.value)}
                    placeholder="Buscar por local ou descrição"
                    className="h-10 w-full rounded-lg border border-borda vidro pr-3 pl-9 text-base outline-none focus:border-primaria focus:ring-4 focus:ring-primaria/15"
                  />
                </label>
              )}
              {todasTransacoes && porCategoria.length > 1 && (
                <div className="-mx-5 overflow-x-auto px-5">
                  <div role="group" aria-label="Filtrar por categoria" className="flex w-max gap-2">
                    <Filtro escolhido={!filtroCategoria} aoClicar={() => setFiltroCategoria(null)}>
                      Todas
                    </Filtro>
                    {porCategoria.map((g) => (
                      <Filtro key={g.chave} escolhido={filtroCategoria === g.chave} aoClicar={() => setFiltroCategoria(g.chave)}>
                        {nomeDaCategoria(g.chave)}
                      </Filtro>
                    ))}
                  </div>
                </div>
              )}
              {filtroCategoria && !todasTransacoes && (
                <button
                  onClick={() => setFiltroCategoria(null)}
                  className="flex w-fit items-center gap-1.5 rounded-full bg-primaria/12 px-3 py-1 text-sm font-medium text-destaque"
                >
                  {nomeDaCategoria(filtroCategoria)}
                  <IconeFechar className="h-3.5 w-3.5" />
                  <span className="sr-only">Remover filtro</span>
                </button>
              )}
            </div>
          )}

          {!faturaCarregada ? (
            <EsqueletoLista linhas={4} />
          ) : transacoesMostradas.length === 0 ? (
            <p className="px-5 py-8 text-center text-sm text-texto-suave">
              {minhas.length === 0 ? 'Nenhuma compra sua nesta fatura.' : 'Nada encontrado com esse filtro.'}
            </p>
          ) : (
            <ul className="divide-y divide-borda">
              {transacoesMostradas.map((t) => {
                const categoria = t.categoria_id ? categoriaPorId.get(t.categoria_id) : undefined
                return (
                  <li key={t.id}>
                    <button
                      onClick={() => setDetalhe(t)}
                      className="flex w-full items-center gap-3 px-5 py-3.5 text-left transition hover:bg-texto/[0.05]"
                    >
                      <IconeCategoria icone={categoria?.icone} cor={categoria?.cor} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-semibold">
                          {t.local || t.descricao || categoria?.nome || 'Compra'}
                        </span>
                        <span className="block text-xs text-texto-suave">{formatarDiaMes(t.data)}</span>
                      </span>
                      <span className="shrink-0 text-right">
                        <span className="block font-semibold">{formatarMoeda(t.valor)}</span>
                        {t.total_parcelas && (
                          <span className="block text-xs text-texto-suave">
                            {t.parcela_atual}/{t.total_parcelas}
                          </span>
                        )}
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}

          {!todasTransacoes && filtradas.length > TRANSACOES_VISIVEIS && (
            <button
              onClick={() => setTodasTransacoes(true)}
              className="w-full border-t border-borda py-3 text-sm font-semibold text-destaque transition hover:bg-texto/[0.05]"
            >
              Ver todas ({filtradas.length})
            </button>
          )}
        </Card>
      </div>

      {/* f) e g) Ações */}
      <div className="mt-6 grid gap-3 sm:grid-cols-2">
        <Botao variante="secundaria" onClick={() => novoLancamento({ forma: 'credito', cartaoId: cartao.id })}>
          <IconeMais className="h-4 w-4" />
          Adicionar compra neste cartão
        </Botao>
        {status === 'paga' ? (
          <p className="flex h-12 items-center justify-center gap-2 rounded-xl bg-primaria/12 font-semibold text-destaque">
            <IconeCheck className="h-5 w-5" />
            Fatura paga
          </p>
        ) : (
          <Botao onClick={() => setPagando(true)} disabled={faltaCentavos <= 0}>
            {status === 'parcial' ? 'Pagar restante' : 'Pagar fatura'} · {formatarMoeda(faltaCentavos / 100)}
          </Botao>
        )}
      </div>

      {editandoCartao && (
        <ModalCartao cartao={cartao} aoFechar={() => setEditandoCartao(false)} aoSalvar={() => setRecarregar((n) => n + 1)} />
      )}
      {pagando && (
        <ModalPagarFatura
          cartao={cartao}
          fatura={fatura}
          faltaCentavos={faltaCentavos}
          aoFechar={() => setPagando(false)}
          aoPagar={() => setRecarregar((n) => n + 1)}
        />
      )}
      {detalhe && (
        <ModalDetalheTransacao
          transacao={detalhe}
          categoria={detalhe.categoria_id ? categoriaPorId.get(detalhe.categoria_id) : undefined}
          cartao={cartao}
          aoFechar={() => setDetalhe(null)}
          aoEditar={() => {
            setDetalhe(null)
            editarLancamento(detalhe)
          }}
          aoExcluir={() => {
            setDetalhe(null)
            editarLancamento(detalhe, { excluir: true })
          }}
        />
      )}
    </>
  )
}

const estiloSeta =
  'flex h-9 w-9 items-center justify-center rounded-lg text-texto-suave transition hover:bg-texto/[0.08] hover:text-texto'

function Filtro({ escolhido, aoClicar, children }: { escolhido: boolean; aoClicar: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={escolhido}
      onClick={aoClicar}
      className={`flex h-8 shrink-0 items-center rounded-full border px-3 text-sm transition ${escolhido ? 'border-primaria bg-primaria/12 font-medium text-destaque' : 'border-borda vidro text-texto hover:border-texto/20'}`}
    >
      {children}
    </button>
  )
}
