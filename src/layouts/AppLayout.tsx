import { useEffect, useMemo, useState } from 'react'
import { Outlet } from 'react-router'
import BottomNav from '../components/BottomNav'
import ModalLancamento from '../components/ModalLancamento'
import { IconeFechar, IconeMais, IconeRepetir, IconeSair } from '../components/icones'
import { LancamentosContext, type ControleLancamentos, type PadraoLancamento } from '../contexts/lancamentos'
import { lancarAssinaturasPendentes } from '../services/assinaturas'
import { sair } from '../services/auth'
import type { Transacao } from '../types/financas'

/** Moldura das telas logadas: barra do topo, conteúdo, botão "+" de lançamento e navegação fixa embaixo. */
export default function AppLayout() {
  // null = modal fechado; { transacao: null } = novo lançamento
  const [modal, setModal] = useState<{
    transacao: Transacao | null
    padrao?: PadraoLancamento
    excluir?: boolean
  } | null>(null)
  const [versao, setVersao] = useState(0)
  const [aviso, setAviso] = useState('')

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
    }),
    [versao],
  )

  return (
    <LancamentosContext.Provider value={controle}>
      <div className="min-h-dvh bg-slate-50">
        <header className="sticky top-0 z-30 border-b border-borda bg-white/95 pt-[env(safe-area-inset-top)] backdrop-blur">
          <div className="mx-auto flex max-w-5xl items-center justify-between px-5 py-3">
            <div className="flex items-center gap-2.5">
              <img src="/icon.svg" alt="" className="h-8 w-8" />
              <span className="font-semibold">Meu Bolso</span>
            </div>
            <button
              onClick={sair}
              className="flex h-9 items-center gap-2 rounded-lg px-2.5 text-sm font-medium text-texto-suave transition hover:bg-slate-100 hover:text-texto"
            >
              <IconeSair className="h-5 w-5" />
              Sair
            </button>
          </div>
        </header>

        {aviso && (
          <div className="sticky top-[calc(env(safe-area-inset-top)+3.75rem)] z-20 mx-auto max-w-5xl px-5 pt-3">
            <div
              role="status"
              className="flex items-center gap-3 rounded-xl border border-violet-200 bg-violet-50 px-4 py-3 text-sm text-violet-900 shadow-sm"
            >
              <IconeRepetir className="h-4 w-4 shrink-0" />
              <span className="flex-1">{aviso}</span>
              <button onClick={() => setAviso('')} aria-label="Fechar aviso" className="text-violet-700 hover:text-violet-900">
                <IconeFechar className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}

        <main className="mx-auto max-w-5xl px-5 pt-6 pb-[calc(env(safe-area-inset-bottom)+9rem)]">
          <Outlet />
        </main>

        {/* Botão flutuante: alinhado à direita do conteúdo, acima da BottomNav */}
        <button
          onClick={() => controle.novoLancamento()}
          aria-label="Novo lançamento"
          title="Novo lançamento"
          className="fixed right-[max(1.25rem,calc((100vw-64rem)/2+1.25rem))] bottom-[calc(env(safe-area-inset-bottom)+5.25rem)] z-30 flex h-14 w-14 items-center justify-center rounded-full bg-primaria text-white shadow-lg shadow-emerald-900/25 transition hover:bg-primaria-escura active:scale-95"
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
