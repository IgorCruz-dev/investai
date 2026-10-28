import { useState } from 'react'
import { deISO } from '../lib/datas'
import { formatarDiaMes, formatarMoeda } from '../lib/formatar'
import type { Tese } from '../services/radar'
import { IconeCaderno } from './icones'
import Modal from './Modal'

type Props = { teses: Tese[]; carregando: boolean }

const precoDe = (ativo: string | null, preco: number) =>
  ativo === 'dolar' ? formatarMoeda(preco) : preco.toLocaleString('pt-BR', { maximumFractionDigits: 2 })

/** Diário: botão de caderninho que abre o que você fez com cada sinal e se o sinal acertou depois do prazo */
export default function DiarioDeTeses({ teses, carregando }: Props) {
  const [aberto, setAberto] = useState(false)
  const fechadas = teses.filter((t) => t.resultado)
  const acertos = fechadas.filter((t) => t.resultado === 'acertou').length
  const taxa = fechadas.length > 0 ? Math.round((acertos / fechadas.length) * 100) : null

  return (
    <>
      <button
        type="button"
        onClick={() => setAberto(true)}
        disabled={carregando}
        className="solido flex h-10 shrink-0 items-center gap-2 rounded-full pr-3 pl-1.5 text-sm font-medium transition hover:bg-texto/[0.06] disabled:opacity-50"
      >
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-primaria/20 text-destaque">
          <IconeCaderno className="h-4 w-4" />
        </span>
        <span className="hidden sm:inline">Diário de teses</span>
        <span className="sm:hidden">Diário</span>
        {teses.length > 0 && (
          <span className="rounded-full bg-texto/[0.07] px-2 py-0.5 text-xs font-semibold">{teses.length}</span>
        )}
      </button>

      <Modal aberto={aberto} aoFechar={() => setAberto(false)} titulo="Diário de teses">
        {taxa !== null && (
          <p className="mb-3 text-sm text-texto-suave">
            Acerto dos sinais: <span className="font-semibold text-texto">{taxa}%</span> de {fechadas.length}{' '}
            {fechadas.length === 1 ? 'fechado' : 'fechados'}
          </p>
        )}
        {teses.length === 0 ? (
          <p className="py-8 text-center text-sm text-texto-suave">
            Marque "Entrei" ou "Só acompanhar" num sinal do radar para medir se ele acerta.
          </p>
        ) : (
          <ul className="-mx-5 divide-y divide-borda border-y border-borda">
            {teses.map((t) => {
              const vence = t.prazo_dias ? deISO(t.dia) : null
              vence?.setDate(vence.getDate() + (t.prazo_dias ?? 0))
              return (
                <li key={t.id} className="flex items-center gap-3 px-5 py-3.5">
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium">{t.titulo}</span>
                    <span className="block text-xs text-texto-suave">
                      {[
                        formatarDiaMes(t.dia),
                        t.decisao === 'entrei' ? `entrou com ${formatarMoeda(Number(t.valor ?? 0))}` : 'só acompanhando',
                        t.preco_entrada != null && `a ${precoDe(t.ativo, Number(t.preco_entrada))}`,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                  </span>
                  {t.resultado ? (
                    <span
                      className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold ${t.resultado === 'acertou' ? 'bg-receita/15 text-receita' : 'bg-despesa/15 text-despesa'}`}
                    >
                      {t.resultado === 'acertou' ? 'Acertou' : 'Errou'}
                    </span>
                  ) : (
                    <span className="shrink-0 text-xs text-texto-suave">
                      {t.preco_entrada == null ? 'Sem preço para medir' : vence ? `Até ${formatarDiaMes(vence)}` : 'Aberta'}
                    </span>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </Modal>
    </>
  )
}
