import { useEffect, useMemo, useState } from 'react'
import Alerta from '../../components/Alerta'
import Card from '../../components/Card'
import ModalAssinatura from '../../components/ModalAssinatura'
import { IconeMais, IconeRepetir } from '../../components/icones'
import { useLancamentos } from '../../hooks/useLancamentos'
import { diasAte, proximaCobranca, textoDiasAte } from '../../lib/assinaturas'
import { formatarDiaMes, formatarMoeda } from '../../lib/formatar'
import { definirAtiva, listarAssinaturas } from '../../services/assinaturas'
import { listarCartoes } from '../../services/cartoes'
import type { Assinatura, Cartao } from '../../types/financas'

/** Cobranças em até 5 dias ganham destaque */
const DIAS_DESTAQUE = 5

export default function Assinaturas() {
  const { versao } = useLancamentos()
  const [assinaturas, setAssinaturas] = useState<Assinatura[]>([])
  const [cartoes, setCartoes] = useState<Cartao[]>([])
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState('')
  // undefined = fechado; null = nova
  const [editando, setEditando] = useState<Assinatura | null | undefined>(undefined)
  const [recarregar, setRecarregar] = useState(0)

  useEffect(() => {
    let ativo = true
    Promise.all([listarAssinaturas(), listarCartoes()])
      .then(([ass, crts]) => {
        if (!ativo) return
        setAssinaturas(ass)
        setCartoes(crts)
        setErro('')
      })
      .catch(() => ativo && setErro('Não foi possível carregar suas assinaturas.'))
      .finally(() => ativo && setCarregando(false))
    return () => {
      ativo = false
    }
  }, [versao, recarregar])

  const cartaoPorId = useMemo(() => new Map(cartoes.map((c) => [c.id, c])), [cartoes])
  const ativas = assinaturas.filter((a) => a.ativa)
  const pausadas = assinaturas.filter((a) => !a.ativa)
  const totalMensal = ativas.reduce((soma, a) => soma + Math.round(a.valor * 100), 0) / 100

  const proximas = ativas
    .map((a) => ({ assinatura: a, data: proximaCobranca(a) }))
    .map((p) => ({ ...p, dias: diasAte(p.data) }))
    .filter((p) => p.dias <= DIAS_DESTAQUE)
  const totalProximas = proximas.reduce((soma, p) => soma + Math.round(p.assinatura.valor * 100), 0) / 100
  const diasPorId = new Map(proximas.map((p) => [p.assinatura.id, p.dias]))

  async function retomar(a: Assinatura) {
    try {
      await definirAtiva(a.id, true)
      setRecarregar((n) => n + 1)
    } catch (err) {
      setErro((err as Error).message)
    }
  }

  function linha(a: Assinatura, pausada = false) {
    const cartao = a.cartao_id ? cartaoPorId.get(a.cartao_id) : undefined
    const dias = diasPorId.get(a.id)
    const destaque = !pausada && dias !== undefined
    return (
      <li key={a.id} className={destaque ? 'bg-amber-50/70' : ''}>
        <div className="flex items-center gap-3 px-5 py-3.5">
          <button onClick={() => setEditando(a)} className="flex min-w-0 flex-1 items-center gap-3 text-left">
            <span
              className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${pausada ? 'bg-slate-100 text-texto-suave' : 'bg-violet-50 text-violet-600'}`}
            >
              <IconeRepetir className="h-[18px] w-[18px]" />
            </span>
            <span className="min-w-0 flex-1">
              <span className={`block truncate font-medium ${pausada ? 'text-texto-suave' : ''}`}>{a.nome}</span>
              <span className="flex items-center gap-1.5 truncate text-xs text-texto-suave">
                Todo dia {a.dia_cobranca} ·
                {cartao ? (
                  <>
                    <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: cartao.cor }} />
                    {cartao.nome}
                  </>
                ) : (
                  ' Débito'
                )}
              </span>
              {destaque && (
                <span className="mt-1 inline-block rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800">
                  {textoDiasAte(dias)}
                </span>
              )}
            </span>
            <span className={`shrink-0 font-semibold ${pausada ? 'text-texto-suave' : ''}`}>{formatarMoeda(a.valor)}</span>
          </button>
          {pausada && (
            <button
              onClick={() => retomar(a)}
              className="shrink-0 rounded-lg border border-borda px-3 py-1.5 text-xs font-semibold transition hover:bg-slate-50"
            >
              Retomar
            </button>
          )}
        </div>
      </li>
    )
  }

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Assinaturas</h1>
        <button
          onClick={() => setEditando(null)}
          className="flex h-10 items-center gap-1.5 rounded-xl border border-borda bg-white px-3.5 text-sm font-semibold transition hover:bg-slate-50"
        >
          <IconeMais className="h-4 w-4" />
          Nova assinatura
        </button>
      </div>

      {erro && (
        <div className="mt-4">
          <Alerta>{erro}</Alerta>
        </div>
      )}

      {/* Total mensal */}
      <div className="mt-6 rounded-2xl bg-linear-to-br from-violet-600 to-violet-800 p-5 text-white shadow-lg shadow-violet-900/15">
        <p className="text-sm text-violet-100">Total mensal com assinaturas</p>
        <p className="mt-2 text-3xl font-bold tracking-tight">{formatarMoeda(totalMensal)}</p>
        <p className="mt-1 text-sm text-violet-100">
          {ativas.length} {ativas.length === 1 ? 'assinatura ativa' : 'assinaturas ativas'}
          {proximas.length > 0 && (
            <>
              {' '}
              · {formatarMoeda(totalProximas)} nos próximos {DIAS_DESTAQUE} dias
            </>
          )}
        </p>
      </div>

      {carregando ? (
        <div className="flex justify-center py-16">
          <span className="h-7 w-7 animate-spin rounded-full border-3 border-emerald-100 border-t-primaria" />
        </div>
      ) : assinaturas.length === 0 ? (
        <div className="mt-6 flex flex-col items-center rounded-2xl border border-borda bg-white px-5 py-14 text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-texto-suave">
            <IconeRepetir className="h-6 w-6" />
          </span>
          <p className="mt-4 font-medium">Nenhuma assinatura cadastrada</p>
          <p className="mt-1 max-w-xs text-sm text-texto-suave">
            Cadastre Netflix, Spotify, academia... e o app lança a cobrança sozinho todo mês.
          </p>
        </div>
      ) : (
        <>
          {proximas.length > 0 && (
            <p className="mt-6 text-sm text-texto-suave">
              <span className="font-semibold text-amber-800">Próximas cobranças: </span>
              {proximas
                .sort((a, b) => a.dias - b.dias)
                .map((p) => `${p.assinatura.nome} (${formatarDiaMes(p.data)})`)
                .join(', ')}
            </p>
          )}

          <Card titulo="Ativas" className="mt-4" semEspaco>
            {ativas.length === 0 ? (
              <p className="px-5 py-8 text-center text-sm text-texto-suave">Nenhuma assinatura ativa.</p>
            ) : (
              <ul className="divide-y divide-borda">{ativas.map((a) => linha(a))}</ul>
            )}
          </Card>

          {pausadas.length > 0 && (
            <Card titulo="Pausadas" className="mt-6" semEspaco>
              <ul className="divide-y divide-borda">{pausadas.map((a) => linha(a, true))}</ul>
            </Card>
          )}
        </>
      )}

      {editando !== undefined && (
        <ModalAssinatura
          assinatura={editando}
          cartoes={cartoes}
          aoFechar={() => setEditando(undefined)}
          aoMudar={() => setRecarregar((n) => n + 1)}
        />
      )}
    </>
  )
}
