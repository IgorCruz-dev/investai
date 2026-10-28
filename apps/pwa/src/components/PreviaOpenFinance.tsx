import { IconeCheck } from './icones'

// Dados de mentira, só para ilustrar o painel do login
const contas = [
  { banco: 'Nubank', sigla: 'Nu', cor: 'bg-purple-600', tipo: 'Conta corrente', saldo: 'R$ 2.140,50' },
  { banco: 'Itaú', sigla: 'It', cor: 'bg-orange-500', tipo: 'Conta corrente', saldo: 'R$ 1.689,20' },
  { banco: 'Inter', sigla: 'In', cor: 'bg-amber-500', tipo: 'Poupança', saldo: 'R$ 450,30' },
]

function IconeAproximacao({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M7 9.5a4 4 0 0 1 0 5M10.5 7a8 8 0 0 1 0 10M14 4.5a12 12 0 0 1 0 15" />
    </svg>
  )
}

function CartaoCredito() {
  return (
    <div className="relative h-44 w-72 overflow-hidden rounded-2xl bg-linear-to-br from-slate-700 via-slate-900 to-black p-5 text-white shadow-2xl shadow-black/50 ring-1 ring-white/10">
      {/* brilho diagonal */}
      <div className="absolute inset-0 bg-linear-to-tr from-transparent via-white/10 to-transparent" />
      <div className="absolute -top-16 -right-10 h-40 w-40 rounded-full bg-primaria/20 blur-2xl" />

      <div className="relative flex items-center justify-between">
        <span className="text-sm font-semibold tracking-wide">InvestAI</span>
        <IconeAproximacao className="h-5 w-5 text-white/70" />
      </div>

      {/* chip */}
      <div className="relative mt-4 grid h-8 w-11 grid-cols-3 gap-px overflow-hidden rounded-md bg-amber-300/90 p-1 shadow-inner">
        {Array.from({ length: 6 }, (_, i) => (
          <span key={i} className="rounded-[2px] bg-amber-200/80" />
        ))}
      </div>

      <p className="relative mt-4 font-mono text-[15px] tracking-[0.2em]">•••• •••• •••• 4821</p>
      <div className="relative mt-2 flex justify-between text-[11px] text-white/60 uppercase">
        <span>Crédito</span>
        <span>12/30</span>
      </div>
    </div>
  )
}

/** Versão pequena da cena, para o cabeçalho do login no celular. */
export function PreviaOpenFinanceCompacta({ className = '' }: { className?: string }) {
  return (
    <div className={`flex items-center gap-4 rounded-2xl bg-white/10 p-4 ring-1 ring-white/20 backdrop-blur ${className}`}>
      {/* mini cartão */}
      <div className="relative h-16 w-24 shrink-0 -rotate-6 overflow-hidden rounded-lg bg-linear-to-br from-slate-700 via-slate-900 to-black p-2.5 shadow-xl shadow-black/50 ring-1 ring-white/10">
        <div className="absolute inset-0 bg-linear-to-tr from-transparent via-white/10 to-transparent" />
        <div className="relative h-3.5 w-5 rounded-[3px] bg-amber-300/90" />
        <p className="relative mt-3 font-mono text-[10px] tracking-widest">•• 4821</p>
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <div className="flex -space-x-1.5">
            {contas.map((c) => (
              <span
                key={c.banco}
                className={`flex h-6 w-6 items-center justify-center rounded-full text-[9px] font-bold text-white ring-2 ring-black/40 ${c.cor}`}
              >
                {c.sigla}
              </span>
            ))}
          </div>
          <p className="text-sm font-semibold">{contas.length} bancos conectados</p>
        </div>
        <p className="mt-2 flex items-center gap-1.5 text-xs text-white/70">
          <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full vidro text-destaque">
            <IconeCheck className="h-2.5 w-2.5" />
          </span>
          Cartão final 4821 adicionado
        </p>
      </div>
    </div>
  )
}

/** Cena ilustrativa do painel do login: bancos conectados, cartão e aviso de "cartão adicionado". */
export default function PreviaOpenFinance() {
  return (
    <div className="relative mt-12 h-[23rem]">
      {/* Cartão de crédito, atrás e inclinado */}
      <div className="absolute top-0 right-0 rotate-6">
        <CartaoCredito />
      </div>

      {/* Contas conectadas */}
      <div className="absolute bottom-0 left-0 z-10 w-80 rounded-2xl vidro p-5 text-texto shadow-2xl shadow-black/40">
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold">Contas conectadas</p>
          <span className="flex items-center gap-1.5 rounded-full bg-primaria/12 px-2.5 py-0.5 text-xs font-semibold text-destaque">
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primaria opacity-60" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-primaria" />
            </span>
            Open Finance
          </span>
        </div>

        <ul className="mt-4 space-y-3.5">
          {contas.map((c) => (
            <li key={c.banco} className="flex items-center gap-3">
              <span
                className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white ${c.cor}`}
              >
                {c.sigla}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{c.banco}</p>
                <p className="text-xs text-texto-suave">{c.tipo}</p>
              </div>
              <div className="text-right">
                <p className="text-sm font-semibold">{c.saldo}</p>
                <p className="flex items-center justify-end gap-1 text-[11px] text-destaque">
                  <IconeCheck className="h-3 w-3" />
                  Sincronizado
                </p>
              </div>
            </li>
          ))}
        </ul>

        <div className="mt-4 flex items-center justify-between border-t border-borda pt-3.5">
          <p className="text-xs text-texto-suave">Saldo total</p>
          <p className="font-bold tracking-tight">R$ 4.280,00</p>
        </div>
      </div>

      {/* Aviso flutuante */}
      <div className="absolute top-6 left-0 z-20 flex items-center gap-3 rounded-xl vidro py-2.5 pr-4 pl-2.5 text-texto shadow-xl shadow-black/30">
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-primaria/15 text-destaque">
          <IconeCheck className="h-4 w-4" />
        </span>
        <div>
          <p className="text-sm font-semibold">Cartão adicionado</p>
          <p className="text-xs text-texto-suave">Final 4821 · sincronizado agora</p>
        </div>
      </div>
    </div>
  )
}
