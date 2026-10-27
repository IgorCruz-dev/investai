import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import Alerta from '../../components/Alerta'
import CartaoVisual, { UsoDoLimite } from '../../components/CartaoVisual'
import Esqueleto from '../../components/Esqueleto'
import ModalCartao from '../../components/ModalCartao'
import { IconeCartao, IconeLapis, IconeMais } from '../../components/icones'
import { useLancamentos } from '../../hooks/useLancamentos'
import { deISO } from '../../lib/datas'
import { datasDaFatura } from '../../lib/fatura'
import { formatarDiaMes, formatarMoeda } from '../../lib/formatar'
import { buscarLimitesUsados, listarCartoes, totaisDasFaturasAtuais } from '../../services/cartoes'
import type { Cartao } from '../../types/financas'

export default function Cartoes() {
  const { versao } = useLancamentos()
  const [cartoes, setCartoes] = useState<Cartao[]>([])
  const [usados, setUsados] = useState<Map<string, number>>(new Map())
  const [faturas, setFaturas] = useState<Awaited<ReturnType<typeof totaisDasFaturasAtuais>> | null>(null)
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState('')
  // undefined = fechado; null = cartão novo
  const [editando, setEditando] = useState<Cartao | null | undefined>(undefined)
  const [recarregar, setRecarregar] = useState(0)

  useEffect(() => {
    let ativo = true
    Promise.all([listarCartoes(), buscarLimitesUsados()])
      .then(async ([crts, lims]) => {
        const fats = await totaisDasFaturasAtuais(crts)
        if (!ativo) return
        setCartoes(crts)
        setUsados(lims)
        setFaturas(fats)
        setErro('')
      })
      .catch(() => ativo && setErro('Não foi possível carregar seus cartões.'))
      .finally(() => ativo && setCarregando(false))
    return () => {
      ativo = false
    }
  }, [versao, recarregar])

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Cartões</h1>
        {cartoes.length > 0 && (
          <button
            onClick={() => setEditando(null)}
            className="flex h-10 items-center gap-1.5 rounded-xl border border-borda bg-superficie px-3.5 text-sm font-semibold transition hover:bg-superficie-2"
          >
            <IconeMais className="h-4 w-4" />
            Novo cartão
          </button>
        )}
      </div>

      {erro && (
        <div className="mt-4">
          <Alerta>{erro}</Alerta>
        </div>
      )}

      {carregando ? (
        <ul className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-3" aria-busy="true" aria-label="Carregando">
          {[0, 1].map((i) => (
            <li key={i} className="rounded-2xl border border-borda bg-superficie">
              <div className="p-3 pb-0">
                <Esqueleto className="aspect-[1.75] rounded-2xl" />
              </div>
              <div className="flex flex-col gap-2 p-4">
                <Esqueleto className="h-4 w-1/2" />
                <Esqueleto className="h-2 w-full" />
              </div>
            </li>
          ))}
        </ul>
      ) : cartoes.length === 0 ? (
        <div className="mt-6 flex flex-col items-center rounded-2xl border border-borda bg-superficie px-5 py-14 text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-superficie-3 text-texto-suave">
            <IconeCartao className="h-6 w-6" />
          </span>
          <p className="mt-4 font-medium">Nenhum cartão cadastrado</p>
          <p className="mt-1 max-w-xs text-sm text-texto-suave">
            Cadastre seus cartões de crédito para lançar compras, ver as faturas e acompanhar o limite.
          </p>
          <button
            onClick={() => setEditando(null)}
            className="mt-5 flex h-11 items-center gap-2 rounded-xl bg-primaria px-5 font-semibold text-sobre-primaria transition hover:bg-primaria-escura"
          >
            <IconeMais className="h-4 w-4" />
            Cadastrar cartão
          </button>
        </div>
      ) : (
        <>
          {cartoes.length > 1 && faturas && <TodosOsCartoes cartoes={cartoes} usados={usados} faturas={faturas} />}
          <ul className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {cartoes.map((c) => (
              <li key={c.id} className="relative overflow-hidden rounded-2xl border border-borda bg-superficie">
                <Link to={`/cartoes/${c.id}`} className="block transition hover:bg-superficie-2">
                  <div className="p-3 pb-0">
                    <CartaoVisual nome={c.nome} bandeira={c.bandeira} cor={c.cor} />
                  </div>
                  <div className="p-4">
                    <UsoDoLimite limite={c.limite} usado={usados.get(c.id) ?? 0} />
                  </div>
                </Link>
                <button
                  onClick={() => setEditando(c)}
                  aria-label={`Editar ${c.nome}`}
                  title="Editar cartão"
                  className="absolute top-6 right-6 flex h-9 w-9 items-center justify-center rounded-full bg-white/20 text-white backdrop-blur transition hover:bg-white/30"
                >
                  <IconeLapis className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      {editando !== undefined && (
        <ModalCartao cartao={editando} aoFechar={() => setEditando(undefined)} aoSalvar={() => setRecarregar((n) => n + 1)} />
      )}
    </>
  )
}

type TodosProps = {
  cartoes: Cartao[]
  usados: Map<string, number>
  faturas: Awaited<ReturnType<typeof totaisDasFaturasAtuais>>
}

/** Soma dos cartões: fatura atual de cada um e o limite somado */
function TodosOsCartoes({ cartoes, usados, faturas }: TodosProps) {
  const totalFaturas = [...faturas.totais.values()].reduce((s, c) => s + c, 0) / 100
  const limite = cartoes.reduce((s, c) => s + Math.round(c.limite * 100), 0) / 100
  const usado = cartoes.reduce((s, c) => s + Math.round((usados.get(c.id) ?? 0) * 100), 0) / 100

  return (
    <section aria-label="Todos os cartões" className="mt-6 rounded-2xl border border-borda bg-superficie p-5">
      <p className="text-sm text-texto-suave">Faturas atuais somadas</p>
      <p className="mt-1 text-3xl font-bold tracking-tight">{formatarMoeda(totalFaturas)}</p>

      <ul className="mt-4 divide-y divide-borda border-y border-borda">
        {cartoes.map((c) => {
          const fatura = faturas.faturaDe.get(c.id)
          const vencimento = fatura ? datasDaFatura(deISO(fatura), c.dia_fechamento, c.dia_vencimento).vencimento : null
          return (
            <li key={c.id} className="flex items-center gap-3 py-2.5 text-sm">
              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: c.cor }} />
              <span className="min-w-0 flex-1 truncate font-medium">{c.nome}</span>
              {vencimento && <span className="shrink-0 text-xs text-texto-suave">vence {formatarDiaMes(vencimento)}</span>}
              <span className="w-28 shrink-0 text-right font-semibold">{formatarMoeda((faturas.totais.get(c.id) ?? 0) / 100)}</span>
            </li>
          )
        })}
      </ul>

      <div className="mt-4">
        <UsoDoLimite limite={limite} usado={usado} />
      </div>
    </section>
  )
}
