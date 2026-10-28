import type { ReactNode } from 'react'
import { formatarMoeda } from '../lib/formatar'
import { NOME_DO_TIPO, valorAtual, type Cotacao, type Investimento } from '../services/carteira'
import Card from './Card'
import { EsqueletoLista } from './Esqueleto'
import { IconeMais, IconeRendimento } from './icones'

const percentual = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 })

type Props = {
  titulo: string
  icone?: ReactNode
  investimentos: Investimento[]
  cotacoes: Map<string, Cotacao>
  carregando: boolean
  /** Só os cadastrados à mão abrem para editar; os da Pluggy vêm do banco */
  aoAbrir: (i: Investimento) => void
  aoAdicionar?: () => void
  vazio?: string
}

/** Total, divisão por tipo e cada posição */
export default function CardCarteira({ titulo, icone, investimentos, cotacoes, carregando, aoAbrir, aoAdicionar, vazio }: Props) {
  const total = investimentos.reduce((s, i) => s + Math.round(valorAtual(i) * 100), 0) / 100
  const porTipo = new Map<string, number>()
  for (const i of investimentos) porTipo.set(i.tipo, (porTipo.get(i.tipo) ?? 0) + valorAtual(i))
  const tipos = [...porTipo.entries()].sort((a, b) => b[1] - a[1])

  return (
    <Card
      titulo={titulo}
      icone={icone}
      semEspaco
      acao={
        aoAdicionar && (
          <button
            onClick={aoAdicionar}
            className="flex items-center gap-1 rounded-full px-3 py-1.5 text-sm font-medium text-texto-suave transition hover:bg-texto/[0.06] hover:text-texto"
          >
            <IconeMais className="h-4 w-4" /> Adicionar
          </button>
        )
      }
    >
      {carregando ? (
        <EsqueletoLista linhas={3} />
      ) : investimentos.length === 0 ? (
        <p className="px-5 py-8 text-center text-sm text-texto-suave">{vazio}</p>
      ) : (
        <>
          <div className="px-5 pb-4">
            <p className="cifra text-3xl font-semibold">{formatarMoeda(total)}</p>
            {tipos.length > 1 && (
              <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-texto-suave">
                {tipos.map(([tipo, valor]) => (
                  <li key={tipo}>
                    {NOME_DO_TIPO[tipo] ?? tipo} ·{' '}
                    <span className="font-semibold text-texto">{percentual.format((valor / total) * 100)}%</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <ul className="divide-y divide-borda border-t border-borda">
            {investimentos.map((i) => {
              const cot = i.codigo ? cotacoes.get(i.codigo.toUpperCase()) : undefined
              const aplicado = i.valor_aplicado ? Number(i.valor_aplicado) : null
              const ganho = aplicado ? valorAtual(i) - aplicado : null
              const conteudo = (
                <>
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-lilas/15 text-lilas">
                    <IconeRendimento className="h-4 w-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{i.nome}</span>
                    <span className="block truncate text-xs text-texto-suave">
                      {[
                        NOME_DO_TIPO[i.tipo] ?? i.tipo,
                        i.instituicao,
                        i.indexador && i.taxa ? `${percentual.format(Number(i.taxa))}% ${i.indexador}` : null,
                        cot
                          ? `${formatarMoeda(Number(cot.preco))} ${cot.variacao_dia !== null ? `(${Number(cot.variacao_dia) >= 0 ? '+' : ''}${percentual.format(Number(cot.variacao_dia))}%)` : ''}`
                          : null,
                        i.origem === 'pluggy' ? 'do banco' : null,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                  </span>
                  <span className="shrink-0 text-right">
                    <span className="numero block font-semibold">{formatarMoeda(valorAtual(i))}</span>
                    {ganho !== null && Math.abs(ganho) >= 0.01 && (
                      <span className={`numero block text-xs ${ganho >= 0 ? 'text-receita' : 'text-despesa'}`}>
                        {ganho >= 0 ? '+' : '−'}
                        {formatarMoeda(Math.abs(ganho))}
                      </span>
                    )}
                  </span>
                </>
              )
              return (
                <li key={i.id}>
                  {i.origem === 'manual' ? (
                    <button
                      onClick={() => aoAbrir(i)}
                      className="flex w-full items-center gap-3 px-5 py-3.5 text-left transition hover:bg-texto/[0.04]"
                    >
                      {conteudo}
                    </button>
                  ) : (
                    <div className="flex items-center gap-3 px-5 py-3.5">{conteudo}</div>
                  )}
                </li>
              )
            })}
          </ul>
        </>
      )}
    </Card>
  )
}
