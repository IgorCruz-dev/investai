import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import Alerta from '../../components/Alerta'
import CartaoVisual, { UsoDoLimite } from '../../components/CartaoVisual'
import ModalCartao from '../../components/ModalCartao'
import { IconeCartao, IconeLapis, IconeMais } from '../../components/icones'
import { useLancamentos } from '../../hooks/useLancamentos'
import { buscarLimitesUsados, listarCartoes } from '../../services/cartoes'
import type { Cartao } from '../../types/financas'

export default function Cartoes() {
  const { versao } = useLancamentos()
  const [cartoes, setCartoes] = useState<Cartao[]>([])
  const [usados, setUsados] = useState<Map<string, number>>(new Map())
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState('')
  // undefined = fechado; null = cartão novo
  const [editando, setEditando] = useState<Cartao | null | undefined>(undefined)
  const [recarregar, setRecarregar] = useState(0)

  useEffect(() => {
    let ativo = true
    Promise.all([listarCartoes(), buscarLimitesUsados()])
      .then(([crts, lims]) => {
        if (!ativo) return
        setCartoes(crts)
        setUsados(lims)
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
            className="flex h-10 items-center gap-1.5 rounded-xl border border-borda bg-white px-3.5 text-sm font-semibold transition hover:bg-slate-50"
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
        <div className="flex justify-center py-20">
          <span className="h-7 w-7 animate-spin rounded-full border-3 border-emerald-100 border-t-primaria" />
        </div>
      ) : cartoes.length === 0 ? (
        <div className="mt-6 flex flex-col items-center rounded-2xl border border-borda bg-white px-5 py-14 text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-texto-suave">
            <IconeCartao className="h-6 w-6" />
          </span>
          <p className="mt-4 font-medium">Nenhum cartão cadastrado</p>
          <p className="mt-1 max-w-xs text-sm text-texto-suave">
            Cadastre seus cartões de crédito para lançar compras, ver as faturas e acompanhar o limite.
          </p>
          <button
            onClick={() => setEditando(null)}
            className="mt-5 flex h-11 items-center gap-2 rounded-xl bg-primaria px-5 font-semibold text-white transition hover:bg-primaria-escura"
          >
            <IconeMais className="h-4 w-4" />
            Cadastrar cartão
          </button>
        </div>
      ) : (
        <ul className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {cartoes.map((c) => (
            <li key={c.id} className="relative overflow-hidden rounded-2xl border border-borda bg-white">
              <Link to={`/cartoes/${c.id}`} className="block transition hover:bg-slate-50/60">
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
      )}

      {editando !== undefined && (
        <ModalCartao cartao={editando} aoFechar={() => setEditando(undefined)} aoSalvar={() => setRecarregar((n) => n + 1)} />
      )}
    </>
  )
}
