import { useMemo, useState } from 'react'
import { formatarDataHora } from '../lib/formatar'
import { TEMAS, type Noticia } from '../services/radar'
import Card from './Card'
import { EsqueletoLista } from './Esqueleto'
import { IconeChevronDireita, IconeChevronEsquerda, IconeJornal, IconeSetaBaixo, IconeSetaCima } from './icones'

const POR_PAGINA = 6
// Abaixo disso a manchete não mexe com preço (critério da classificação)
const RELEVANTE = 0.5

const NOME_DO_ATIVO: Record<string, string> = {
  dolar: 'Dólar',
  selic: 'Selic',
  ipca: 'IPCA',
  prefixado: 'Prefixado',
  ibovespa: 'Ibovespa',
  acoes: 'Ações',
  fii: 'FIIs',
  cripto: 'Cripto',
  ouro: 'Ouro',
  petroleo: 'Petróleo',
}

const relevancia = (n: Noticia) => n.relevancia ?? 0
const maisNova = (a: Noticia, b: Noticia) => b.publicada_em.localeCompare(a.publicada_em)

const ORDENS = {
  relevantes: { nome: 'Mais relevantes', comparar: (a: Noticia, b: Noticia) => relevancia(b) - relevancia(a) || maisNova(a, b) },
  irrelevantes: {
    nome: 'Menos relevantes',
    comparar: (a: Noticia, b: Noticia) => relevancia(a) - relevancia(b) || maisNova(a, b),
  },
  recentes: { nome: 'Mais recentes', comparar: maisNova },
  antigas: { nome: 'Mais antigas', comparar: (a: Noticia, b: Noticia) => maisNova(b, a) },
  fonte: {
    nome: 'Fonte (A a Z)',
    comparar: (a: Noticia, b: Noticia) => (a.fonte ?? '').localeCompare(b.fonte ?? '', 'pt-BR') || maisNova(a, b),
  },
} satisfies Record<string, { nome: string; comparar: (a: Noticia, b: Noticia) => number }>
type Ordem = keyof typeof ORDENS

type Props = { noticias: Noticia[]; carregando: boolean }

/** Manchetes dos últimos dias, com filtro por tema, ordenação e paginação */
export default function CardNoticias({ noticias, carregando }: Props) {
  const [tema, setTema] = useState<string | null>(null)
  const [ordem, setOrdem] = useState<Ordem>('relevantes')
  const [pagina, setPagina] = useState(0)

  const lista = useMemo(
    () => noticias.filter((n) => !tema || n.temas.includes(tema)).sort(ORDENS[ordem].comparar),
    [noticias, tema, ordem],
  )
  const paginas = Math.max(1, Math.ceil(lista.length / POR_PAGINA))
  const atual = Math.min(pagina, paginas - 1)
  const visiveis = lista.slice(atual * POR_PAGINA, (atual + 1) * POR_PAGINA)

  return (
    <Card
      titulo="Notícias"
      icone={<IconeJornal className="h-4 w-4" />}
      semEspaco
      acao={
        <label className="flex items-center gap-2 text-sm text-texto-suave">
          <span className="sr-only">Ordenar por</span>
          <select
            value={ordem}
            onChange={(e) => {
              setOrdem(e.target.value as Ordem)
              setPagina(0)
            }}
            className="h-9 rounded-full bg-texto/[0.05] px-3 font-medium text-texto outline-none focus-visible:ring-2 focus-visible:ring-primaria"
          >
            {Object.entries(ORDENS).map(([id, o]) => (
              <option key={id} value={id}>
                {o.nome}
              </option>
            ))}
          </select>
        </label>
      }
    >
      <div role="group" aria-label="Tema" className="flex gap-2 overflow-x-auto px-5 pb-3 [scrollbar-width:none]">
        {[null, ...Object.keys(TEMAS)].map((t) => (
          <button
            key={t ?? 'todas'}
            type="button"
            aria-pressed={tema === t}
            onClick={() => {
              setTema(t)
              setPagina(0)
            }}
            className={`h-8 shrink-0 rounded-full px-3 text-sm font-medium transition ${tema === t ? 'bg-texto text-fundo' : 'bg-texto/[0.05] text-texto-suave hover:text-texto'}`}
          >
            {t ? TEMAS[t] : 'Todas'}
          </button>
        ))}
      </div>

      {carregando ? (
        <EsqueletoLista linhas={POR_PAGINA} />
      ) : lista.length === 0 ? (
        <p className="px-5 py-8 text-center text-sm text-texto-suave">Nenhuma notícia nos últimos dias.</p>
      ) : (
        <>
          <ul className="divide-y divide-borda border-t border-borda">
            {visiveis.map((n) => {
              const c = n.classificacao
              const relevante = relevancia(n) >= RELEVANTE && c && c.ativos.length > 0
              return (
                <li key={n.id}>
                  <a
                    href={n.link}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block px-5 py-3.5 transition hover:bg-texto/[0.04]"
                  >
                    <span className="block leading-snug font-medium">{n.titulo}</span>
                    <span className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-texto-suave">
                      {relevante && (
                        <span
                          className={`inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 font-semibold ${
                            c.direcao === 'alta'
                              ? 'bg-receita/15 text-receita'
                              : c.direcao === 'baixa'
                                ? 'bg-despesa/15 text-despesa'
                                : 'bg-texto/[0.07] text-texto'
                          }`}
                        >
                          {c.direcao === 'alta' && <IconeSetaCima className="h-3 w-3" />}
                          {c.direcao === 'baixa' && <IconeSetaBaixo className="h-3 w-3" />}
                          {NOME_DO_ATIVO[c.ativos[0]] ?? c.ativos[0]}
                        </span>
                      )}
                      <span>{[n.fonte, formatarDataHora(n.publicada_em)].filter(Boolean).join(' · ')}</span>
                    </span>
                  </a>
                </li>
              )
            })}
          </ul>

          {paginas > 1 && (
            <nav
              aria-label="Páginas de notícias"
              className="flex items-center justify-between gap-2 border-t border-borda px-3 py-2"
            >
              <button
                type="button"
                disabled={atual === 0}
                onClick={() => setPagina(atual - 1)}
                aria-label="Página anterior"
                className="flex h-9 w-9 items-center justify-center rounded-full text-texto-suave transition hover:bg-texto/[0.06] hover:text-texto disabled:opacity-30"
              >
                <IconeChevronEsquerda className="h-5 w-5" />
              </button>
              <span className="text-sm text-texto-suave">
                Página <span className="font-semibold text-texto">{atual + 1}</span> de {paginas}
              </span>
              <button
                type="button"
                disabled={atual >= paginas - 1}
                onClick={() => setPagina(atual + 1)}
                aria-label="Próxima página"
                className="flex h-9 w-9 items-center justify-center rounded-full text-texto-suave transition hover:bg-texto/[0.06] hover:text-texto disabled:opacity-30"
              >
                <IconeChevronDireita className="h-5 w-5" />
              </button>
            </nav>
          )}
        </>
      )}
      <p className="border-t border-borda px-5 pt-3 pb-3 text-xs text-texto-suave">
        Manchetes do Google Notícias. A seta é a direção provável do preço segundo a IA, não uma garantia.
      </p>
    </Card>
  )
}
