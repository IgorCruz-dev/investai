import type { ReactNode } from 'react'
import CartaoBlack from '../components/CartaoBlack'
import { IconeCheck } from '../components/icones'
import PreviaOpenFinance, { PreviaOpenFinanceCompacta } from '../components/PreviaOpenFinance'

type Props = {
  titulo: string
  subtitulo?: ReactNode
  /** Link do pé (ex.: "Não tem conta?"). No celular fica preso no fim da tela. */
  rodape?: ReactNode
  children: ReactNode
}

const vantagens = ['Todas as contas e cartões num só lugar', 'Saiba para onde vai cada real', 'Relatórios do mês sem planilha']

/** Textura de pontinhos que vai sumindo para as bordas */
const texturaPontos = {
  backgroundImage: 'radial-gradient(var(--pontos) 1px, transparent 1px)',
  backgroundSize: '22px 22px',
  maskImage: 'radial-gradient(ellipse at center, black 30%, transparent 75%)',
}

function Logo() {
  return (
    <div className="flex items-center gap-3">
      <CartaoBlack variante="logo" className="w-14" />
      <span className="font-display text-lg font-semibold">InvestAI</span>
    </div>
  )
}

/** Moldura das telas de login e cadastro: painel da marca à esquerda (só no computador) e formulário à direita. */
export default function AuthLayout({ titulo, subtitulo, rodape, children }: Props) {
  return (
    <div className="relative flex min-h-dvh flex-col lg:grid lg:grid-cols-2">
      <div className="aurora" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
      <aside className="destaque destaque-ouro relative m-3 hidden overflow-hidden rounded-[32px] p-12 lg:flex lg:flex-col lg:justify-between lg:gap-10">
        <div className="absolute inset-0" style={texturaPontos} />
        <div className="absolute top-1/3 left-1/2 h-[28rem] w-[28rem] -translate-x-1/2 rounded-full bg-primaria/10 blur-3xl" />

        <div className="relative">
          <Logo />
        </div>

        <div className="relative mx-auto w-full max-w-md">
          <h2 className="text-5xl leading-[1.05] font-semibold">
            Seu dinheiro, <span className="text-destaque">organizado.</span>
          </h2>
          <p className="mt-4 text-lg text-texto-suave">Conecte seus bancos e cartões e entenda seu mês em segundos.</p>

          <ul className="mt-7 space-y-3">
            {vantagens.map((v) => (
              <li key={v} className="flex items-center gap-3 text-texto/85">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primaria/15 text-destaque">
                  <IconeCheck className="h-3.5 w-3.5" />
                </span>
                {v}
              </li>
            ))}
          </ul>

          <PreviaOpenFinance />
        </div>

        <p className="relative text-sm text-texto-suave">© {new Date().getFullYear()} InvestAI</p>
      </aside>

      {/* Cabeçalho do celular: a cor de fundo continua na barra de status (theme-color) */}
      <header className="destaque destaque-ouro relative overflow-hidden px-6 pt-[calc(env(safe-area-inset-top)+1.75rem)] pb-14 lg:hidden">
        <div className="absolute inset-0" style={texturaPontos} />
        <div className="absolute -top-16 -right-16 h-56 w-56 rounded-full bg-primaria/10 blur-3xl" />

        <div className="relative">
          <Logo />
        </div>
        <p className="relative mt-7 font-display text-3xl leading-tight font-semibold">
          Seu dinheiro, <span className="text-destaque">organizado.</span>
        </p>
        <p className="relative mt-1.5 text-sm text-texto-suave">Conecte seus bancos e cartões num só lugar.</p>

        {/* Mini prévia dos bancos; some em telas baixas para o formulário caber */}
        <PreviaOpenFinanceCompacta className="relative mt-6 [@media(max-height:700px)]:hidden" />
      </header>

      <main className="relative -mt-6 flex flex-1 flex-col items-center max-lg:vidro-forte rounded-t-[32px] px-6 pt-8 pb-[calc(env(safe-area-inset-bottom)+1.5rem)] sm:px-8 lg:mt-0 lg:justify-center lg:rounded-none lg:py-10">
        <div className="flex w-full max-w-sm flex-1 flex-col lg:flex-none">
          <h1 className="text-3xl font-semibold lg:text-4xl">{titulo}</h1>
          {subtitulo && <p className="mt-1.5 text-texto-suave lg:mt-2">{subtitulo}</p>}

          <div className="mt-7 lg:mt-8">{children}</div>

          {rodape && <div className="mt-auto pt-8 text-center text-sm text-texto-suave lg:mt-8 lg:pt-0">{rodape}</div>}
        </div>
      </main>
    </div>
  )
}
