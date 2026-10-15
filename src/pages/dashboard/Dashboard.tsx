import { useEffect, useState, type ReactNode } from 'react'
import { IconeLista, IconeSair, IconeSetaBaixo, IconeSetaCima } from '../../components/icones'
import { useAuth } from '../../hooks/useAuth'
import { formatarMesAno, formatarMoeda } from '../../lib/formatar'
import { sair } from '../../services/auth'
import { buscarPerfil } from '../../services/perfis'

// Ainda não existem tabelas de lançamentos; quando existirem, esses valores vêm do banco
const resumo = { receitas: 0, despesas: 0 }

export default function Dashboard() {
  const { usuario } = useAuth()
  const [nome, setNome] = useState('')

  useEffect(() => {
    if (!usuario) return
    setNome(usuario.user_metadata.nome ?? '')
    buscarPerfil(usuario.id)
      .then((perfil) => setNome(perfil.nome))
      .catch(() => {}) // sem perfil, fica o nome do cadastro
  }, [usuario])

  const primeiroNome = nome.split(' ')[0]
  const iniciais = nome
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((parte) => parte[0].toUpperCase())
    .join('')
  const saldo = resumo.receitas - resumo.despesas

  return (
    <div className="min-h-dvh bg-slate-50">
      <header className="border-b border-borda bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-5 py-3.5">
          <div className="flex items-center gap-2.5">
            <img src="/icon.svg" alt="" className="h-8 w-8" />
            <span className="font-semibold">Meu Bolso</span>
          </div>

          <div className="flex items-center gap-3">
            <span className="hidden text-sm text-texto-suave sm:block">{nome}</span>
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-emerald-100 text-sm font-semibold text-primaria">
              {iniciais}
            </span>
            <button
              onClick={sair}
              aria-label="Sair"
              title="Sair"
              className="flex h-9 w-9 items-center justify-center rounded-lg text-texto-suave transition hover:bg-slate-100 hover:text-texto"
            >
              <IconeSair className="h-5 w-5" />
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-5 py-8">
        <p className="text-sm text-texto-suave">{formatarMesAno(new Date())}</p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight sm:text-3xl">
          Olá{primeiroNome && `, ${primeiroNome}`}
        </h1>

        <div className="mt-6 grid gap-4 sm:grid-cols-3">
          <div className="rounded-2xl bg-linear-to-br from-emerald-600 to-emerald-800 p-5 text-white shadow-lg shadow-emerald-900/15">
            <p className="text-sm text-emerald-100">Saldo do mês</p>
            <p className="mt-2 text-3xl font-bold tracking-tight">{formatarMoeda(saldo)}</p>
          </div>
          <CartaoResumo titulo="Receitas" valor={resumo.receitas} cor="text-receita" fundo="bg-emerald-50" icone={<IconeSetaCima className="h-4 w-4" />} />
          <CartaoResumo titulo="Despesas" valor={resumo.despesas} cor="text-despesa" fundo="bg-red-50" icone={<IconeSetaBaixo className="h-4 w-4" />} />
        </div>

        <section className="mt-8 rounded-2xl border border-borda bg-white">
          <h2 className="border-b border-borda px-5 py-4 font-semibold">Últimos lançamentos</h2>
          <div className="flex flex-col items-center px-5 py-14 text-center">
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-texto-suave">
              <IconeLista className="h-6 w-6" />
            </span>
            <p className="mt-4 font-medium">Nenhum lançamento ainda</p>
            <p className="mt-1 max-w-xs text-sm text-texto-suave">
              Quando você registrar receitas e despesas, elas aparecem aqui.
            </p>
          </div>
        </section>
      </main>
    </div>
  )
}

type CartaoResumoProps = { titulo: string; valor: number; cor: string; fundo: string; icone: ReactNode }

function CartaoResumo({ titulo, valor, cor, fundo, icone }: CartaoResumoProps) {
  return (
    <div className="rounded-2xl border border-borda bg-white p-5">
      <div className="flex items-center gap-2">
        <span className={`flex h-7 w-7 items-center justify-center rounded-lg ${fundo} ${cor}`}>{icone}</span>
        <p className="text-sm text-texto-suave">{titulo}</p>
      </div>
      <p className={`mt-2 text-2xl font-bold tracking-tight ${cor}`}>{formatarMoeda(valor)}</p>
    </div>
  )
}
