/** Bloco cinza pulsando no lugar do conteúdo enquanto a primeira carga não chega */
export default function Esqueleto({ className = '' }: { className?: string }) {
  return <span aria-hidden className={`block animate-pulse rounded-lg bg-superficie-3 ${className}`} />
}

/** Linhas de lista (ícone redondo + dois textos + valor), como as listas de lançamentos */
export function EsqueletoLista({ linhas = 4 }: { linhas?: number }) {
  return (
    <ul className="divide-y divide-borda" aria-busy="true" aria-label="Carregando">
      {Array.from({ length: linhas }, (_, i) => (
        <li key={i} className="flex items-center gap-3 px-5 py-3.5">
          <Esqueleto className="h-9 w-9 shrink-0 rounded-full" />
          <span className="flex min-w-0 flex-1 flex-col gap-2">
            <Esqueleto className="h-4 w-2/5" />
            <Esqueleto className="h-3 w-1/4" />
          </span>
          <Esqueleto className="h-4 w-16 shrink-0" />
        </li>
      ))}
    </ul>
  )
}
