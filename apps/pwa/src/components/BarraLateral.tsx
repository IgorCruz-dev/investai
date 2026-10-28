import { useEffect, useState, type ReactNode } from 'react'
import { NavLink } from 'react-router'
import { abas } from './BottomNav'
import CartaoBlack from './CartaoBlack'
import TrocaTema from './TrocaTema'
import {
  IconeBanco,
  IconeChevronDireita,
  IconeChevronEsquerda,
  IconeLista,
  IconeMais,
  IconeSair,
  IconeSino,
  IconeUsuario,
} from './icones'
import { useAuth } from '../hooks/useAuth'
import { useLancamentos } from '../hooks/useLancamentos'
import { hojeISO } from '../lib/datas'
import { sair } from '../services/auth'
import { buscarPerfil } from '../services/perfis'
import { buscarSaldoAtual, buscarSaldoEm } from '../services/transacoes'

// No computador cabe mais: telas que no celular só abrem por link também ficam no menu
const extras: { to: string; label: string; icone: ReactNode }[] = [
  { to: '/lancamentos', label: 'Lançamentos', icone: <IconeLista /> },
  { to: '/acertos', label: 'Acertos', icone: <IconeUsuario /> },
  { to: '/bancos', label: 'Bancos', icone: <IconeBanco /> },
  { to: '/notificacoes', label: 'Notificações', icone: <IconeSino /> },
]

type Props = {
  aoNovoLancamento: () => void
  /** Recolhida: vira uma faixa estreita só com os ícones */
  recolhida: boolean
  aoAlternar: () => void
}

/**
 * Navegação do computador (lg+): painel de vidro flutuando à esquerda, no lugar do topo, do dock e do botão "+".
 * Dá para recolher numa faixa só de ícones (o botão na borda abre e fecha).
 */
export default function BarraLateral({ aoNovoLancamento, recolhida, aoAlternar }: Props) {
  const patrimonio = usePatrimonio()
  const { usuario } = useAuth()
  const [nome, setNome] = useState('')

  useEffect(() => {
    if (!usuario) return
    setNome(usuario.user_metadata.nome ?? '')
    buscarPerfil(usuario.id)
      .then((perfil) => setNome(perfil.nome))
      .catch(() => {}) // sem perfil, fica o nome do cadastro
  }, [usuario])

  return (
    <aside
      className={`vidro fixed inset-y-3 left-3 z-30 hidden flex-col rounded-[28px] transition-[width] duration-300 ease-[cubic-bezier(.2,.9,.25,1)] lg:flex ${recolhida ? 'w-[4.5rem]' : 'w-60'}`}
    >
      <button
        type="button"
        onClick={aoAlternar}
        aria-label={recolhida ? 'Abrir barra lateral' : 'Recolher barra lateral'}
        aria-expanded={!recolhida}
        title={recolhida ? 'Abrir barra lateral' : 'Recolher barra lateral'}
        className="solido absolute top-7 -right-3.5 z-10 flex h-7 w-7 items-center justify-center rounded-full border border-borda text-texto-suave shadow-md transition hover:text-texto"
      >
        {recolhida ? <IconeChevronDireita className="h-4 w-4" /> : <IconeChevronEsquerda className="h-4 w-4" />}
      </button>

      {/* A marca do app é o cartão Black (recolhida, só o medalhão) */}
      <div className={recolhida ? 'px-2.5 pt-4 pb-5' : 'mx-auto w-44 pt-4 pb-4'}>
        <h1 className="sr-only">InvestAI</h1>
        {recolhida ? <CartaoBlack variante="logo" /> : <CartaoBlack nome={nome} patrimonio={patrimonio} />}
      </div>

      <div className={recolhida ? 'px-2.5' : 'px-3'}>
        <button
          onClick={aoNovoLancamento}
          aria-label={recolhida ? 'Novo lançamento' : undefined}
          title={recolhida ? 'Novo lançamento' : undefined}
          className="flex h-11 w-full items-center justify-center gap-2 rounded-full bg-primaria text-sm font-semibold text-sobre-primaria shadow-[0_10px_30px_-10px_rgb(212_175_55/0.6),inset_0_1px_0_rgb(255_255_255/0.5)] transition hover:bg-primaria-escura active:scale-[0.98]"
        >
          <IconeMais className="h-5 w-5" />
          {!recolhida && 'Novo lançamento'}
        </button>
      </div>

      <nav className={`mt-6 flex-1 overflow-x-hidden overflow-y-auto ${recolhida ? 'px-2.5' : 'px-3'}`}>
        <p
          className={`px-3 pb-2 text-[11px] font-medium tracking-wider text-texto-suave/70 uppercase ${recolhida ? 'sr-only' : ''}`}
        >
          Visão geral
        </p>
        <ul className="space-y-1">
          {abas.map((aba) => (
            <Item key={aba.to} {...aba} recolhida={recolhida} />
          ))}
        </ul>
        {recolhida ? (
          <div className="mx-3 my-4 h-px bg-borda" aria-hidden="true" />
        ) : (
          <p className="mt-6 px-3 pb-2 text-[11px] font-medium tracking-wider text-texto-suave/70 uppercase">Detalhes</p>
        )}
        <ul className="space-y-1">
          {extras.map((aba) => (
            <Item key={aba.to} {...aba} recolhida={recolhida} />
          ))}
        </ul>
      </nav>

      <div className={recolhida ? 'p-2.5' : 'p-3'}>
        <div className={`flex items-center gap-2 ${recolhida ? 'flex-col-reverse' : ''}`}>
          <button
            onClick={sair}
            aria-label={recolhida ? 'Sair' : undefined}
            title={recolhida ? 'Sair' : undefined}
            className={`flex h-10 items-center gap-3 rounded-full text-sm font-medium text-texto-suave transition hover:bg-texto/[0.06] hover:text-texto ${recolhida ? 'w-10 justify-center' : 'flex-1 px-3'}`}
          >
            <IconeSair className="h-5 w-5" />
            {!recolhida && 'Sair'}
          </button>
          <TrocaTema compacto={recolhida} />
        </div>
      </div>
    </aside>
  )
}

function Item({ to, label, icone, recolhida }: { to: string; label: string; icone: ReactNode; recolhida: boolean }) {
  return (
    <li>
      <NavLink
        to={to}
        title={recolhida ? label : undefined}
        aria-label={recolhida ? label : undefined}
        className={({ isActive }) =>
          `flex h-10 items-center gap-3 rounded-full text-sm font-medium transition ${recolhida ? 'justify-center' : 'px-3'} ${isActive ? 'bg-texto/[0.09] text-texto shadow-[inset_0_1px_0_rgb(255_255_255/0.08)]' : 'text-texto-suave hover:bg-texto/[0.05] hover:text-texto'}`
        }
      >
        {({ isActive }) => (
          <>
            <span className={isActive ? 'text-destaque' : ''}>{icone}</span>
            {!recolhida && label}
            {isActive && !recolhida && (
              <span className="ml-auto h-1.5 w-1.5 rounded-full bg-primaria shadow-[0_0_10px_2px_rgb(212_175_55/0.6)]" />
            )}
          </>
        )}
      </NavLink>
    </li>
  )
}

/** Saldo pessoal + saldo da empresa; atualiza sempre que um lançamento é salvo */
function usePatrimonio() {
  const { versao } = useLancamentos()
  const [patrimonio, setPatrimonio] = useState<number | null>(null)
  useEffect(() => {
    let ativo = true
    Promise.all([buscarSaldoAtual(), buscarSaldoEm(hojeISO(), true)])
      .then(([pessoal, empresa]) => ativo && setPatrimonio(pessoal + empresa))
      .catch(() => {})
    return () => {
      ativo = false
    }
  }, [versao])
  return patrimonio
}
