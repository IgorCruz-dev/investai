import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link, useSearchParams } from 'react-router'
import Alerta from '../../components/Alerta'
import Card from '../../components/Card'
import { EsqueletoLista } from '../../components/Esqueleto'
import IconeCategoria, { COR_SEM_CATEGORIA } from '../../components/IconeCategoria'
import ListaLancamentos from '../../components/ListaLancamentos'
import SeletorMes from '../../components/SeletorMes'
import { IconeBanco, IconeChevronEsquerda, IconeFechar, IconeLista } from '../../components/icones'
import { useLancamentos } from '../../hooks/useLancamentos'
import { deMesISO, inicioDoMes, intervaloDoMes, paraMesISO } from '../../lib/datas'
import { formatarMoeda } from '../../lib/formatar'
import { gastoEmCentavos, receitaEmCentavos } from '../../lib/resumos'
import { listarCartoes } from '../../services/cartoes'
import { listarCategorias } from '../../services/categorias'
import { listarContas } from '../../services/contas'
import { listarTransacoesDoMes } from '../../services/transacoes'
import type { Cartao, Categoria, Conta, Transacao } from '../../types/financas'

const CINZA = COR_SEM_CATEGORIA

/** "NUBANK CARD 0807" → "Nubank", "Itaú Corrente 79-8" → "Itaú": junta conta e cartão do mesmo banco */
function nomeDoBanco(nome: string) {
  const limpo = nome
    .replace(/\b(corrente|poupan[çc]a|card|cart[ãa]o|conta|cr[ée]dito)\b/gi, '')
    .replace(/[\d-]+/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  const base = limpo || nome
  return base === base.toUpperCase() ? base.toLowerCase().replace(/(^|\s)\S/g, (l) => l.toUpperCase()) : base
}

/**
 * Todos os lançamentos de um mês, com filtros por categoria, banco e período dentro do mês.
 * Endereço: /lancamentos?mes=2026-10&categoria=<id|sem>&banco=Nubank&de=2026-10-05&ate=2026-10-12
 * (categoria aceita várias separadas por vírgula)
 */
export default function Lancamentos() {
  const { versao, editarLancamento } = useLancamentos()
  const [parametros, setParametros] = useSearchParams()
  const mesNaUrl = parametros.get('mes')
  const mes = useMemo(() => deMesISO(mesNaUrl) ?? inicioDoMes(), [mesNaUrl])
  const [inicioDoMesISO, fimDoMesISO] = intervaloDoMes(mes)
  const filtroCategoria = parametros.get('categoria')
  const escolhidas = useMemo(() => (filtroCategoria ? new Set(filtroCategoria.split(',')) : null), [filtroCategoria])
  const banco = parametros.get('banco')
  const de = parametros.get('de')
  const ate = parametros.get('ate')
  const temFiltro = Boolean(filtroCategoria || banco || de || ate)

  const [transacoes, setTransacoes] = useState<Transacao[]>([])
  const [categorias, setCategorias] = useState<Categoria[]>([])
  const [cartoes, setCartoes] = useState<Cartao[]>([])
  const [contas, setContas] = useState<Conta[]>([])
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState('')

  useEffect(() => {
    let ativo = true
    setCarregando(true)
    Promise.all([listarTransacoesDoMes(mes), listarCategorias(), listarCartoes(), listarContas()])
      .then(([ts, cats, crts, cts]) => {
        if (!ativo) return
        setTransacoes(ts)
        setCategorias(cats)
        setCartoes(crts)
        setContas(cts)
        setErro('')
      })
      .catch(() => ativo && setErro('Não foi possível carregar seus lançamentos.'))
      .finally(() => ativo && setCarregando(false))
    return () => {
      ativo = false
    }
  }, [mes, versao])

  function mudar(novos: {
    mes?: Date
    categoria?: string | null
    banco?: string | null
    de?: string | null
    ate?: string | null
  }) {
    const proximos = new URLSearchParams(parametros)
    if (novos.mes) {
      proximos.set('mes', paraMesISO(novos.mes))
      // o período é de dentro do mês: troca de mês, some
      proximos.delete('de')
      proximos.delete('ate')
    }
    for (const chave of ['categoria', 'banco', 'de', 'ate'] as const) {
      const valor = novos[chave]
      if (valor === undefined) continue
      if (valor) proximos.set(chave, valor)
      else proximos.delete(chave)
    }
    setParametros(proximos, { replace: true })
  }

  function limparFiltros() {
    mudar({ categoria: null, banco: null, de: null, ate: null })
  }

  // Banco de cada conta e cartão (conta corrente e cartão do Nubank viram "Nubank")
  const bancoPorId = useMemo(() => {
    const mapa = new Map<string, string>()
    for (const c of contas) mapa.set(c.id, nomeDoBanco(c.nome))
    for (const c of cartoes) mapa.set(c.id, nomeDoBanco(c.nome))
    return mapa
  }, [contas, cartoes])
  const bancos = useMemo(() => [...new Set(bancoPorId.values())].sort((a, b) => a.localeCompare(b, 'pt-BR')), [bancoPorId])

  // Banco e período valem para tudo (inclusive as somas das categorias); a categoria filtra só a lista
  const doBancoEPeriodo = useMemo(
    () =>
      transacoes.filter((t) => {
        if (banco) {
          const id = t.cartao_id ?? t.conta_id
          if (!id || bancoPorId.get(id) !== banco) return false
        }
        if (de && t.data < de) return false
        if (ate && t.data > ate) return false
        return true
      }),
    [transacoes, banco, bancoPorId, de, ate],
  )

  const filtradas = useMemo(
    () => (escolhidas ? doBancoEPeriodo.filter((t) => escolhidas.has(t.categoria_id ?? 'sem')) : doBancoEPeriodo),
    [doBancoEPeriodo, escolhidas],
  )

  const totais = useMemo(() => {
    let receitas = 0
    let despesas = 0
    for (const t of filtradas) {
      receitas += receitaEmCentavos(t)
      despesas += gastoEmCentavos(t)
    }
    return { receitas: receitas / 100, despesas: despesas / 100 }
  }, [filtradas])

  // Gasto por categoria, para a lista de filtros do computador
  const gastoPorCategoria = useMemo(() => {
    const gastos = new Map<string, number>()
    for (const t of doBancoEPeriodo) {
      const chave = t.categoria_id ?? 'sem'
      gastos.set(chave, (gastos.get(chave) ?? 0) + gastoEmCentavos(t))
    }
    return gastos
  }, [doBancoEPeriodo])

  // Só mostra no filtro as categorias que têm lançamento (e a escolhida, mesmo vazia), da que mais gastou para a que menos
  const categoriasDoMes = useMemo(() => {
    const usadas = new Set(doBancoEPeriodo.map((t) => t.categoria_id ?? 'sem'))
    for (const chave of escolhidas ?? []) usadas.add(chave)
    const lista = categorias
      .filter((c) => usadas.has(c.id))
      .map((c) => ({ chave: c.id, nome: c.nome, cor: c.cor, icone: c.icone as string | null }))
    if (usadas.has('sem')) lista.push({ chave: 'sem', nome: 'Sem categoria', cor: CINZA, icone: null })
    const gasto = (chave: string) => gastoPorCategoria.get(chave) ?? 0
    return lista.sort((a, b) => gasto(b.chave) - gasto(a.chave) || a.nome.localeCompare(b.nome, 'pt-BR'))
  }, [doBancoEPeriodo, categorias, escolhidas, gastoPorCategoria])

  const resumo = (
    <>
      {filtradas.length} {filtradas.length === 1 ? 'lançamento' : 'lançamentos'}
      {totais.despesas > 0 && <> · Despesas {formatarMoeda(totais.despesas)}</>}
      {totais.receitas > 0 && <> · Receitas {formatarMoeda(totais.receitas)}</>}
    </>
  )

  const filtroDeBanco = (
    <div role="group" aria-label="Filtrar por banco" className="flex flex-wrap gap-2">
      <BotaoFiltro escolhido={!banco} aoClicar={() => mudar({ banco: null })}>
        Todos
      </BotaoFiltro>
      {bancos.map((b) => (
        <BotaoFiltro key={b} escolhido={banco === b} aoClicar={() => mudar({ banco: banco === b ? null : b })}>
          <IconeBanco className="h-4 w-4 opacity-70" />
          {b}
        </BotaoFiltro>
      ))}
    </div>
  )

  const filtroDePeriodo = (
    <div className="grid grid-cols-2 gap-2">
      <CampoData
        id="periodo-de"
        rotulo="De"
        valor={de}
        min={inicioDoMesISO}
        max={ate ?? fimDoMesISO}
        aoMudar={(v) => mudar({ de: v })}
      />
      <CampoData
        id="periodo-ate"
        rotulo="Até"
        valor={ate}
        min={de ?? inicioDoMesISO}
        max={fimDoMesISO}
        aoMudar={(v) => mudar({ ate: v })}
      />
    </div>
  )

  const botaoLimpar = temFiltro && (
    <button
      type="button"
      onClick={limparFiltros}
      className="inline-flex h-9 items-center gap-1.5 rounded-full bg-texto/[0.07] px-3.5 text-sm font-medium transition hover:bg-texto/[0.11]"
    >
      <IconeFechar className="h-4 w-4" />
      Limpar filtros
    </button>
  )

  return (
    <>
      <Link
        to="/dashboard"
        className="-ml-1 inline-flex items-center gap-1 text-sm font-medium text-texto-suave transition hover:text-texto"
      >
        <IconeChevronEsquerda className="h-4 w-4" />
        Início
      </Link>

      <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Lançamentos</h1>
        <SeletorMes mes={mes} aoMudar={(novo) => mudar({ mes: novo })} />
      </div>

      {/* Celular e tablet: banco, período e categorias em cima da lista; no computador (xl) vão para a coluna lateral */}
      <div className="mt-5 flex flex-col gap-3 xl:hidden">
        <div className="-mx-5 overflow-x-auto px-5">
          <div className="w-max">{filtroDeBanco}</div>
        </div>
        <div className="max-w-md">{filtroDePeriodo}</div>
        <div className="-mx-5 overflow-x-auto px-5">
          <div role="group" aria-label="Filtrar por categoria" className="flex w-max gap-2">
            <BotaoFiltro escolhido={!filtroCategoria} aoClicar={() => mudar({ categoria: null })}>
              Todas
            </BotaoFiltro>
            {categoriasDoMes.map((c) => (
              <BotaoFiltro
                key={c.chave}
                escolhido={escolhidas?.has(c.chave) ?? false}
                aoClicar={() => mudar({ categoria: escolhidas?.has(c.chave) ? null : c.chave })}
              >
                <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: c.cor }} />
                {c.nome}
              </BotaoFiltro>
            ))}
          </div>
        </div>
      </div>

      {erro && (
        <div className="mt-4">
          <Alerta>{erro}</Alerta>
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center justify-between gap-2 xl:hidden">
        <p className="text-sm text-texto-suave">{resumo}</p>
        {botaoLimpar}
      </div>

      <div className="xl:mt-6 xl:grid xl:grid-cols-[300px_minmax(0,1fr)] 2xl:grid-cols-[340px_minmax(0,1fr)] xl:items-start xl:gap-6">
        {/* Filtros com rolagem própria, presos na tela; no fim dela a rolagem passa para a página */}
        <aside className="hidden xl:sticky xl:top-6 xl:-mr-2 xl:flex xl:max-h-[calc(100dvh-3rem)] xl:flex-col xl:gap-6 xl:overflow-y-auto xl:pr-2 xl:pb-2">
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-[28px] solido p-4">
              <p className="text-xs text-texto-suave">Despesas</p>
              <p className="mt-1 text-lg font-bold tracking-tight text-despesa">{formatarMoeda(totais.despesas)}</p>
            </div>
            <div className="rounded-[28px] solido p-4">
              <p className="text-xs text-texto-suave">Receitas</p>
              <p className="mt-1 text-lg font-bold tracking-tight text-receita">{formatarMoeda(totais.receitas)}</p>
            </div>
          </div>

          <Card titulo="Filtros" acao={botaoLimpar || undefined}>
            <div className="flex flex-col gap-5">
              <div>
                <p className="mb-2 text-xs font-medium text-texto-suave">Banco</p>
                {filtroDeBanco}
              </div>
              <div>
                <p className="mb-2 text-xs font-medium text-texto-suave">Período</p>
                {filtroDePeriodo}
              </div>
            </div>
          </Card>

          <Card titulo="Categorias" semEspaco>
            <ul role="group" aria-label="Filtrar por categoria" className="p-2">
              {[{ chave: null, nome: 'Todas', cor: null, icone: null }, ...categoriasDoMes].map((c) => {
                const escolhida = c.chave === null ? !escolhidas : (escolhidas?.has(c.chave) ?? false)
                const gasto = c.chave ? (gastoPorCategoria.get(c.chave) ?? 0) : null
                return (
                  <li key={c.chave ?? 'todas'}>
                    <button
                      type="button"
                      aria-pressed={escolhida}
                      onClick={() => mudar({ categoria: c.chave !== null && escolhida ? null : c.chave })}
                      className={`flex w-full items-center gap-3 rounded-2xl px-2.5 py-1.5 text-left text-sm transition ${escolhida ? 'bg-primaria/12 font-medium text-destaque' : 'text-texto hover:bg-texto/[0.05]'}`}
                    >
                      {c.chave ? (
                        <IconeCategoria icone={c.icone} cor={c.cor} tamanho="pequeno" />
                      ) : (
                        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[14px] bg-texto/[0.07] text-texto-suave">
                          <IconeLista className="h-4 w-4" />
                        </span>
                      )}
                      <span className="min-w-0 flex-1 truncate">{c.nome}</span>
                      {gasto !== null && gasto > 0 && (
                        <span className="numero shrink-0 text-xs text-texto-suave">{formatarMoeda(gasto / 100)}</span>
                      )}
                    </button>
                  </li>
                )
              })}
            </ul>
          </Card>
        </aside>

        <div>
          <p className="mb-3 hidden text-sm text-texto-suave xl:block">{resumo}</p>
          <Card className="mt-3 xl:mt-0" semEspaco>
            {carregando && transacoes.length === 0 ? (
              <EsqueletoLista linhas={6} />
            ) : filtradas.length === 0 ? (
              <div className="flex flex-col items-center px-5 py-14 text-center">
                <span className="flex h-12 w-12 items-center justify-center rounded-full bg-texto/[0.07] text-texto-suave">
                  <IconeLista className="h-6 w-6" />
                </span>
                <p className="mt-4 font-medium">Nenhum lançamento aqui</p>
                <p className="mt-1 max-w-xs text-sm text-texto-suave">Troque o mês ou os filtros.</p>
                {temFiltro && <div className="mt-4">{botaoLimpar}</div>}
              </div>
            ) : (
              <div className={carregando ? 'opacity-60 transition' : 'transition'}>
                <ListaLancamentos
                  transacoes={filtradas}
                  categorias={categorias}
                  cartoes={cartoes}
                  aoEscolher={editarLancamento}
                />
              </div>
            )}
          </Card>
        </div>
      </div>
    </>
  )
}

function BotaoFiltro({ escolhido, aoClicar, children }: { escolhido: boolean; aoClicar: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={escolhido}
      onClick={aoClicar}
      className={`flex h-9 shrink-0 items-center gap-2 rounded-full border px-3.5 text-sm transition ${escolhido ? 'border-primaria bg-primaria/12 font-medium text-destaque' : 'border-borda vidro text-texto hover:border-texto/20'}`}
    >
      {children}
    </button>
  )
}

/** Data dentro do mês; vazia vale "desde o dia 1" (De) ou "até o fim do mês" (Até) */
function CampoData(p: {
  id: string
  rotulo: string
  valor: string | null
  min: string
  max: string
  aoMudar: (valor: string | null) => void
}) {
  return (
    <label htmlFor={p.id} className="flex flex-col gap-1">
      <span className="text-[11px] text-texto-suave">{p.rotulo}</span>
      <input
        id={p.id}
        type="date"
        value={p.valor ?? ''}
        min={p.min}
        max={p.max}
        onChange={(e) => p.aoMudar(e.target.value || null)}
        className={`h-10 w-full min-w-0 rounded-xl border bg-texto/[0.04] px-2.5 text-sm text-texto outline-none transition focus:border-primaria/60 focus:ring-4 focus:ring-primaria/10 ${p.valor ? 'border-primaria/60' : 'border-borda hover:border-texto/20'}`}
      />
    </label>
  )
}
