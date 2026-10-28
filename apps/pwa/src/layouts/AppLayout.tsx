import { useEffect, useMemo, useState } from 'react'
import { NavLink, Outlet } from 'react-router'
import AvisoOpenFinance from '../components/AvisoOpenFinance'
import BarraLateral from '../components/BarraLateral'
import CartaoBlack from '../components/CartaoBlack'
import TrocaTema from '../components/TrocaTema'
import BottomNav from '../components/BottomNav'
import ModalLancamento from '../components/ModalLancamento'
import { IconeBanco, IconeFechar, IconeMais, IconeRepetir, IconeSair, IconeSino } from '../components/icones'
import { LancamentosContext, type ControleLancamentos, type PadraoLancamento } from '../contexts/lancamentos'
import { lancarAssinaturasPendentes } from '../services/assinaturas'
import { sair } from '../services/auth'
import type { Transacao } from '../types/financas'

const CHAVE_BARRA = 'investai:barra-recolhida'

function barraRecolhidaSalva() {
  try {
    return localStorage.getItem(CHAVE_BARRA) === '1'
  } catch {
    return false
  }
}

/**
 * Moldura das telas logadas. Celular: barra do topo, botão "+" flutuante e navegação fixa embaixo.
 * Computador (lg+): barra lateral com a navegação e o botão de novo lançamento.
 */
export default function AppLayout() {
  // null = modal fechado; { transacao: null } = novo lançamento
  const [modal, setModal] = useState<{
    transacao: Transacao | null
    padrao?: PadraoLancamento
    excluir?: boolean
  } | null>(null)
  const [versao, setVersao] = useState(0)
  const [aviso, setAviso] = useState('')
  const [barraRecolhida, setBarraRecolhida] = useState(barraRecolhidaSalva)

  function alternarBarra() {
    const nova = !barraRecolhida
    setBarraRecolhida(nova)
    try {
      localStorage.setItem(CHAVE_BARRA, nova ? '1' : '0')
    } catch {
      // navegação privada: vale só nesta visita
    }
  }

  // O botão flutuante sai da frente ao descer a página e volta ao subir (no celular ele fica
  // por cima do conteúdo; sem isso tapa valores e botões da tela)
  const [botaoVisivel, setBotaoVisivel] = useState(true)

  useEffect(() => {
    let anterior = window.scrollY
    function aoRolar() {
      const atual = window.scrollY
      if (Math.abs(atual - anterior) < 8) return
      setBotaoVisivel(atual < anterior || atual < 80)
      anterior = atual
    }
    window.addEventListener('scroll', aoRolar, { passive: true })
    return () => window.removeEventListener('scroll', aoRolar)
  }, [])

  // Ao abrir o app: lança as assinaturas do mês que já venceram (o banco garante que não duplica)
  useEffect(() => {
    let ativo = true
    lancarAssinaturasPendentes()
      .then((lancadas) => {
        if (!ativo || lancadas === 0) return
        setVersao((v) => v + 1)
        setAviso(
          lancadas === 1
            ? '1 assinatura do mês foi lançada automaticamente.'
            : `${lancadas} assinaturas do mês foram lançadas automaticamente.`,
        )
      })
      .catch((err) => console.error('Falha ao lançar assinaturas', err))
    return () => {
      ativo = false
    }
  }, [])

  useEffect(() => {
    if (!aviso) return
    const tempo = setTimeout(() => setAviso(''), 6000)
    return () => clearTimeout(tempo)
  }, [aviso])

  const controle = useMemo<ControleLancamentos>(
    () => ({
      novoLancamento: (padrao) => setModal({ transacao: null, padrao }),
      editarLancamento: (transacao, opcoes) => setModal({ transacao, excluir: opcoes?.excluir }),
      versao,
      recarregar: () => setVersao((v) => v + 1),
    }),
    [versao],
  )

  return (
    <LancamentosContext.Provider value={controle}>
      {/* Fundo: manchas de cor desfocadas que o vidro das superfícies deixa aparecer */}
      <div className="aurora" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>

      <div className="min-h-dvh">
        <BarraLateral aoNovoLancamento={() => controle.novoLancamento()} recolhida={barraRecolhida} aoAlternar={alternarBarra} />

        <div
          className={`transition-[padding] duration-300 ease-[cubic-bezier(.2,.9,.25,1)] ${barraRecolhida ? 'lg:pl-[6.5rem]' : 'lg:pl-[17rem]'}`}
        >
          <header className="vidro-forte sticky top-0 z-30 rounded-b-[28px] border-t-0 pt-[env(safe-area-inset-top)] lg:hidden">
            <div className="mx-auto flex max-w-5xl items-center justify-between px-5 py-3">
              <div className="flex items-center gap-2.5">
                <CartaoBlack variante="logo" className="w-12" />
                <span className="font-display text-lg font-semibold tracking-tight">InvestAI</span>
              </div>
              <div className="flex items-center gap-1">
                <TrocaTema className="mr-1" />
                <NavLink
                  to="/notificacoes"
                  aria-label="Notificações"
                  title="Notificações"
                  className={({ isActive }) =>
                    `flex h-9 w-9 items-center justify-center rounded-full transition hover:bg-texto/[0.08] hover:text-texto ${isActive ? 'bg-texto/[0.08] text-destaque' : 'text-texto-suave'}`
                  }
                >
                  <IconeSino className="h-5 w-5" />
                </NavLink>
                <NavLink
                  to="/bancos"
                  className={({ isActive }) =>
                    `flex h-9 items-center gap-2 rounded-full px-3 text-sm font-medium transition hover:bg-texto/[0.08] hover:text-texto ${isActive ? 'bg-texto/[0.08] text-destaque' : 'text-texto-suave'}`
                  }
                >
                  <IconeBanco className="h-5 w-5" />
                  <span className="max-[420px]:sr-only">Bancos</span>
                </NavLink>
                <button
                  onClick={sair}
                  className="flex h-9 items-center gap-2 rounded-full px-3 text-sm font-medium text-texto-suave transition hover:bg-texto/[0.08] hover:text-texto"
                >
                  <IconeSair className="h-5 w-5" />
                  <span className="max-[420px]:sr-only">Sair</span>
                </button>
              </div>
            </div>
          </header>

          {aviso && (
            <div className="sticky top-[calc(env(safe-area-inset-top)+3.75rem)] z-20 mx-auto max-w-5xl px-4 pt-3 sm:px-5 lg:top-3 lg:max-w-[1600px] lg:pr-6 lg:pl-2">
              <div role="status" className="vidro-forte flex items-center gap-3 rounded-2xl px-4 py-3 text-sm text-lilas">
                <IconeRepetir className="h-4 w-4 shrink-0" />
                <span className="flex-1">{aviso}</span>
                <button onClick={() => setAviso('')} aria-label="Fechar aviso" className="text-lilas hover:text-texto">
                  <IconeFechar className="h-4 w-4" />
                </button>
              </div>
            </div>
          )}

          <main className="mx-auto max-w-5xl px-4 pt-6 pb-[calc(env(safe-area-inset-bottom)+9rem)] sm:px-5 lg:max-w-[1600px] lg:pt-7 lg:pr-6 lg:pb-12 lg:pl-2">
            <div className="mb-5 empty:hidden">
              <AvisoOpenFinance />
            </div>
            <Outlet />
          </main>
        </div>

        {/* Botão flutuante (só celular): alinhado à direita do conteúdo, acima do dock */}
        <button
          onClick={() => controle.novoLancamento()}
          aria-label="Novo lançamento"
          title="Novo lançamento"
          aria-hidden={!botaoVisivel}
          tabIndex={botaoVisivel ? undefined : -1}
          className={`fixed right-[max(1rem,calc((100vw-64rem)/2+1rem))] bottom-[calc(env(safe-area-inset-bottom)+6rem)] z-30 flex h-14 w-14 items-center justify-center rounded-full bg-primaria text-sobre-primaria shadow-[0_14px_36px_-10px_rgb(212_175_55/0.7),inset_0_1px_0_rgb(255_255_255/0.6)] transition duration-200 hover:bg-primaria-escura active:scale-95 lg:hidden ${botaoVisivel ? '' : 'pointer-events-none translate-y-28 opacity-0'}`}
        >
          <IconeMais className="h-7 w-7" />
        </button>

        <BottomNav />
      </div>

      {modal && (
        <ModalLancamento
          transacao={modal.transacao}
          padrao={modal.padrao}
          iniciarExcluindo={modal.excluir}
          aoFechar={() => setModal(null)}
          aoSalvar={() => setVersao((v) => v + 1)}
        />
      )}
    </LancamentosContext.Provider>
  )
}
