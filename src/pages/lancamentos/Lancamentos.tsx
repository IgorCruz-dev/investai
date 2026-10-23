import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link, useSearchParams } from 'react-router'
import Alerta from '../../components/Alerta'
import Card from '../../components/Card'
import { EsqueletoLista } from '../../components/Esqueleto'
import ListaLancamentos from '../../components/ListaLancamentos'
import SeletorMes from '../../components/SeletorMes'
import { IconeChevronEsquerda, IconeLista } from '../../components/icones'
import { useLancamentos } from '../../hooks/useLancamentos'
import { deMesISO, inicioDoMes, paraMesISO } from '../../lib/datas'
import { formatarMoeda } from '../../lib/formatar'
import { ehGasto } from '../../lib/resumos'
import { listarCartoes } from '../../services/cartoes'
import { listarCategorias } from '../../services/categorias'
import { listarTransacoesDoMes } from '../../services/transacoes'
import type { Cartao, Categoria, Transacao } from '../../types/financas'

/** Todos os lançamentos de um mês, com filtro por categoria. Endereço: /lancamentos?mes=2026-10&categoria=<id|sem> */
export default function Lancamentos() {
  const { versao, editarLancamento } = useLancamentos()
  const [parametros, setParametros] = useSearchParams()
  const mesNaUrl = parametros.get('mes')
  const mes = useMemo(() => deMesISO(mesNaUrl) ?? inicioDoMes(), [mesNaUrl])
  const filtroCategoria = parametros.get('categoria')

  const [transacoes, setTransacoes] = useState<Transacao[]>([])
  const [categorias, setCategorias] = useState<Categoria[]>([])
  const [cartoes, setCartoes] = useState<Cartao[]>([])
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState('')

  useEffect(() => {
    let ativo = true
    setCarregando(true)
    Promise.all([listarTransacoesDoMes(mes), listarCategorias(), listarCartoes()])
      .then(([ts, cats, crts]) => {
        if (!ativo) return
        setTransacoes(ts)
        setCategorias(cats)
        setCartoes(crts)
        setErro('')
      })
      .catch(() => ativo && setErro('Não foi possível carregar seus lançamentos.'))
      .finally(() => ativo && setCarregando(false))
    return () => {
      ativo = false
    }
  }, [mes, versao])

  function mudar(novos: { mes?: Date; categoria?: string | null }) {
    const proximos = new URLSearchParams(parametros)
    if (novos.mes) proximos.set('mes', paraMesISO(novos.mes))
    if (novos.categoria !== undefined) {
      if (novos.categoria) proximos.set('categoria', novos.categoria)
      else proximos.delete('categoria')
    }
    setParametros(proximos, { replace: true })
  }

  const filtradas = useMemo(
    () =>
      filtroCategoria
        ? transacoes.filter((t) => (filtroCategoria === 'sem' ? t.categoria_id === null : t.categoria_id === filtroCategoria))
        : transacoes,
    [transacoes, filtroCategoria],
  )

  const totais = useMemo(() => {
    let receitas = 0
    let despesas = 0
    for (const t of filtradas) {
      if (t.tipo === 'receita') receitas += Math.round(t.valor * 100)
      else if (ehGasto(t)) despesas += Math.round(t.valor * 100)
    }
    return { receitas: receitas / 100, despesas: despesas / 100 }
  }, [filtradas])

  // Só mostra no filtro as categorias que têm lançamento no mês (e a escolhida, mesmo vazia)
  const categoriasDoMes = useMemo(() => {
    const usadas = new Set(transacoes.map((t) => t.categoria_id ?? 'sem'))
    if (filtroCategoria) usadas.add(filtroCategoria)
    const lista = categorias.filter((c) => usadas.has(c.id)).map((c) => ({ chave: c.id, nome: c.nome, cor: c.cor }))
    if (usadas.has('sem')) lista.push({ chave: 'sem', nome: 'Sem categoria', cor: '#94a3b8' })
    return lista
  }, [transacoes, categorias, filtroCategoria])

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

      {/* Filtro por categoria: rola de lado no celular */}
      <div className="-mx-5 mt-5 overflow-x-auto px-5">
        <div role="group" aria-label="Filtrar por categoria" className="flex w-max gap-2">
          <BotaoFiltro escolhido={!filtroCategoria} aoClicar={() => mudar({ categoria: null })}>
            Todas
          </BotaoFiltro>
          {categoriasDoMes.map((c) => (
            <BotaoFiltro key={c.chave} escolhido={filtroCategoria === c.chave} aoClicar={() => mudar({ categoria: c.chave })}>
              <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: c.cor }} />
              {c.nome}
            </BotaoFiltro>
          ))}
        </div>
      </div>

      {erro && (
        <div className="mt-4">
          <Alerta>{erro}</Alerta>
        </div>
      )}

      <p className="mt-4 text-sm text-texto-suave">
        {filtradas.length} {filtradas.length === 1 ? 'lançamento' : 'lançamentos'}
        {totais.despesas > 0 && <> · Despesas {formatarMoeda(totais.despesas)}</>}
        {totais.receitas > 0 && <> · Receitas {formatarMoeda(totais.receitas)}</>}
      </p>

      <Card className="mt-3" semEspaco>
        {carregando && transacoes.length === 0 ? (
          <EsqueletoLista linhas={6} />
        ) : filtradas.length === 0 ? (
          <div className="flex flex-col items-center px-5 py-14 text-center">
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-texto-suave">
              <IconeLista className="h-6 w-6" />
            </span>
            <p className="mt-4 font-medium">Nenhum lançamento aqui</p>
            <p className="mt-1 max-w-xs text-sm text-texto-suave">Troque o mês ou o filtro de categoria.</p>
          </div>
        ) : (
          <div className={carregando ? 'opacity-60 transition' : 'transition'}>
            <ListaLancamentos transacoes={filtradas} categorias={categorias} cartoes={cartoes} aoEscolher={editarLancamento} />
          </div>
        )}
      </Card>
    </>
  )
}

function BotaoFiltro({ escolhido, aoClicar, children }: { escolhido: boolean; aoClicar: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={escolhido}
      onClick={aoClicar}
      className={`flex h-9 shrink-0 items-center gap-2 rounded-full border px-3.5 text-sm transition ${escolhido ? 'border-primaria bg-emerald-50 font-medium text-primaria' : 'border-borda bg-white text-texto hover:border-slate-300'}`}
    >
      {children}
    </button>
  )
}
