import { useState } from 'react'
import { formatarDiaMes, formatarMoeda } from '../lib/formatar'
import { metaDaReserva } from '../lib/projecoes'
import type { PerfilFinanceiro } from '../services/perfilFinanceiro'
import { TETO_TATICO, type GastoIA, type Sinal, type Tese } from '../services/radar'
import Botao from './Botao'
import Card from './Card'
import CampoValor from './CampoValor'
import Esqueleto from './Esqueleto'
import Modal from './Modal'
import { IconeAlvo, IconeCadeado, IconeChevronBaixo, IconeSetaBaixo, IconeSetaCima } from './icones'

const usd = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'USD' })
const percentual = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 })

const RISCO: Record<string, { nome: string; classe: string }> = {
  baixo: { nome: 'Risco baixo', classe: 'bg-receita/15 text-receita' },
  medio: { nome: 'Risco médio', classe: 'bg-alerta/15 text-alerta' },
  alto: { nome: 'Risco alto', classe: 'bg-despesa/15 text-despesa' },
}

type Props = {
  sinais: Sinal[]
  teses: Tese[]
  gasto: GastoIA | null
  perfil: PerfilFinanceiro | null
  /** Patrimônio pessoal de hoje: base do tamanho sugerido de cada aposta */
  patrimonio: number
  carregando: boolean
  aoDecidir: (sinal: Sinal, decisao: 'entrei' | 'passei', valor: number | null) => Promise<void>
}

/**
 * Sinais do dia. A IA sugere teses, mas as regras pessoais ficam aqui, no código: sem reserva de emergência completa
 * só passa pós-fixado; nenhuma aposta passa de 10% do patrimônio pessoal; todo card mostra a perda no cenário contrário.
 */
export default function CardRadar({ sinais, teses, gasto, perfil, patrimonio, carregando, aoDecidir }: Props) {
  const [entrando, setEntrando] = useState<{ sinal: Sinal; sugerido: number } | null>(null)
  const [centavos, setCentavos] = useState(0)
  const [salvando, setSalvando] = useState(false)

  const meta = perfil ? metaDaReserva(perfil.gastoMedio) : 0
  const reservaCompleta = meta > 0 && patrimonio >= meta
  const decididos = new Map(teses.filter((t) => t.sinal_id).map((t) => [t.sinal_id!, t.decisao]))
  const quant = sinais.filter((s) => s.origem === 'quant')
  const ia = sinais.filter((s) => s.origem === 'ia')
  const dia = sinais[0]?.dia
  const travadas = ia.filter((s) => s.classe !== 'pos_fixado' && !reservaCompleta).length

  async function decidir(sinal: Sinal, decisao: 'entrei' | 'passei', valor: number | null) {
    setSalvando(true)
    try {
      await aoDecidir(sinal, decisao, valor)
      setEntrando(null)
    } finally {
      setSalvando(false)
    }
  }

  return (
    <Card
      titulo="Radar"
      icone={<IconeAlvo className="h-4 w-4" />}
      acao={
        gasto && (
          <span className="text-xs text-texto-suave" title="Gasto com a IA neste mês">
            IA: {gasto.gasto > 0 && gasto.gasto < 0.01 ? 'menos de US$ 0,01' : usd.format(gasto.gasto)} de{' '}
            {usd.format(gasto.limite)}
          </span>
        )
      }
    >
      {carregando ? (
        <Esqueleto className="h-64" />
      ) : sinais.length === 0 ? (
        <p className="py-6 text-center text-sm text-texto-suave">Os sinais do dia aparecem aqui depois das 20h30.</p>
      ) : (
        <>
          {dia && <p className="-mt-2 text-xs text-texto-suave">Sinais de {formatarDiaMes(dia)}</p>}

          {gasto && gasto.gasto >= gasto.limite && (
            <p className="mt-3 rounded-2xl bg-alerta/10 px-4 py-3 text-sm text-alerta">
              Limite de gasto da IA atingido neste mês. Os sinais numéricos continuam.
            </p>
          )}

          {/* O bloqueio vale para todas as teses de uma vez: avisa uma vez só, no topo */}
          {travadas > 0 && (
            <p className="mt-3 flex items-start gap-2.5 rounded-2xl bg-texto/[0.04] px-4 py-3 text-sm">
              <IconeCadeado className="mt-0.5 h-4 w-4 shrink-0 text-texto-suave" />
              <span>
                <span className="font-medium">Apostas táticas travadas até a reserva ficar completa.</span>{' '}
                <span className="text-texto-suave">
                  Faltam {formatarMoeda(Math.max(meta - patrimonio, 0))}. Até lá, só pós-fixado; dá para acompanhar as teses e
                  medir se acertam.
                </span>
              </span>
            </p>
          )}

          {ia.length > 0 && (
            <>
              <h3 className="mt-5 text-xs font-semibold tracking-wide text-texto-suave uppercase">Teses da IA</h3>
              <ul className="mt-2 grid items-start gap-3 lg:grid-cols-2 xl:grid-cols-3">
                {ia.map((s) => {
                  const bloqueado = s.classe !== 'pos_fixado' && !reservaCompleta
                  const pct = Math.min(Number(s.pct_max ?? 0), TETO_TATICO)
                  const perdaPct = Number(s.perda_contraria_pct ?? 0)
                  const sugerido = Math.floor(patrimonio * pct) / 100
                  const decisao = decididos.get(s.id)
                  const risco = s.risco ? RISCO[s.risco] : undefined
                  return (
                    <li key={s.id} className="flex flex-col rounded-2xl border border-borda p-4">
                      <div className="flex flex-wrap items-center gap-2 text-xs">
                        <Direcao direcao={s.direcao} />
                        {risco && <span className={`rounded-full px-2 py-0.5 font-semibold ${risco.classe}`}>{risco.nome}</span>}
                        {s.prazo_dias && <span className="text-texto-suave">{prazo(s.prazo_dias)}</span>}
                        {bloqueado && (
                          <span
                            className="ml-auto flex items-center gap-1 text-texto-suave"
                            title="Travada até a reserva ficar completa"
                          >
                            <IconeCadeado className="h-3.5 w-3.5" />
                            Travada
                          </span>
                        )}
                      </div>
                      <p className="mt-3 font-display text-[17px] leading-snug font-semibold tracking-tight">{s.titulo}</p>
                      {s.objetivo && (
                        <p className="mt-2 text-sm leading-relaxed">
                          <span className="font-semibold text-destaque">Objetivo: </span>
                          {s.objetivo}
                        </p>
                      )}

                      <details className="group mt-3 text-sm">
                        <summary className="flex cursor-pointer list-none items-center gap-1 text-xs font-medium text-texto-suave hover:text-texto [&::-webkit-details-marker]:hidden">
                          <IconeChevronBaixo className="h-3.5 w-3.5 transition group-open:rotate-180" />
                          Entenda a tese
                        </summary>
                        <p className="mt-2 text-texto-suave">{s.tese}</p>
                        <dl className="mt-2 space-y-1.5">
                          {s.embutido && <Linha rotulo="Já no preço">{s.embutido}</Linha>}
                          {s.confirma && <Linha rotulo="Confirma">{s.confirma}</Linha>}
                          {s.invalida && <Linha rotulo="Invalida">{s.invalida}</Linha>}
                        </dl>
                      </details>

                      {/* Valor e botões no pé do card */}
                      <div className="mt-auto pt-4">
                        {!bloqueado && <Tamanho pct={pct} perdaPct={perdaPct} patrimonio={patrimonio} sugerido={sugerido} />}

                        {decisao ? (
                          <p className={`text-xs text-texto-suave ${bloqueado ? '' : 'mt-3'}`}>
                            {decisao === 'entrei' ? 'Você entrou nessa tese.' : 'Você está acompanhando sem entrar.'}
                          </p>
                        ) : (
                          <div className={`flex gap-2 ${bloqueado ? '' : 'mt-3'}`}>
                            {!bloqueado && (
                              <button
                                type="button"
                                onClick={() => {
                                  setCentavos(Math.round(sugerido * 100))
                                  setEntrando({ sinal: s, sugerido })
                                }}
                                className="h-9 flex-1 rounded-full bg-texto text-sm font-semibold text-fundo transition hover:opacity-90"
                              >
                                Entrei
                              </button>
                            )}
                            <button
                              type="button"
                              disabled={salvando}
                              onClick={() => decidir(s, 'passei', null)}
                              className="h-9 flex-1 rounded-full border border-borda text-sm font-medium text-texto-suave transition hover:bg-texto/[0.05] hover:text-texto disabled:opacity-50"
                            >
                              Só acompanhar
                            </button>
                          </div>
                        )}
                      </div>
                    </li>
                  )
                })}
              </ul>
            </>
          )}

          {quant.length > 0 && (
            <>
              <h3 className="mt-6 flex items-baseline gap-2 text-xs font-semibold tracking-wide text-texto-suave uppercase">
                Números do dia
                <span className="font-normal tracking-normal normal-case">regras fixas com dados do Banco Central, sem IA</span>
              </h3>
              <ul className="mt-2 divide-y divide-borda rounded-2xl bg-texto/[0.03]">
                {quant.map((s) => (
                  <li key={s.id}>
                    <details className="group">
                      <summary className="flex cursor-pointer list-none items-start gap-3 px-4 py-3 [&::-webkit-details-marker]:hidden">
                        <Direcao direcao={s.direcao} />
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-medium">{s.titulo}</span>
                          {s.objetivo && <span className="mt-0.5 block text-xs text-texto-suave">{s.objetivo}</span>}
                        </span>
                        <IconeChevronBaixo className="mt-0.5 h-4 w-4 shrink-0 text-texto-suave transition group-open:rotate-180" />
                      </summary>
                      <p className="-mt-1 px-4 pb-3 pl-[52px] text-xs leading-relaxed text-texto-suave">{s.tese}</p>
                    </details>
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}

      <p className="mt-4 text-xs text-texto-suave">Sinal informativo para uso pessoal, não é recomendação profissional.</p>

      <Modal
        aberto={entrando !== null}
        aoFechar={() => setEntrando(null)}
        titulo="Quanto você colocou?"
        rodape={
          <Botao carregando={salvando} onClick={() => entrando && decidir(entrando.sinal, 'entrei', centavos / 100)}>
            Registrar no diário
          </Botao>
        }
      >
        {entrando && (
          <>
            <p className="text-sm text-texto-suave">{entrando.sinal.titulo}</p>
            <div className="mt-5">
              <CampoValor centavos={centavos} aoMudar={setCentavos} tipo="despesa" />
            </div>
            {entrando.sugerido > 0 && centavos / 100 > entrando.sugerido && (
              <p className="mt-3 text-center text-sm text-alerta">
                Acima do sugerido ({formatarMoeda(entrando.sugerido)}). Aposta tática grande demais pode doer.
              </p>
            )}
          </>
        )}
      </Modal>
    </Card>
  )
}

function Direcao({ direcao }: { direcao: string | null }) {
  if (direcao === 'alta')
    return (
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-receita/15 text-receita" title="Alta">
        <IconeSetaCima className="h-3.5 w-3.5" />
      </span>
    )
  if (direcao === 'baixa')
    return (
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-despesa/15 text-despesa" title="Baixa">
        <IconeSetaBaixo className="h-3.5 w-3.5" />
      </span>
    )
  return (
    <span className="flex h-6 w-6 shrink-0 items-center justify-center" title="Neutra">
      <span className="h-2 w-2 rounded-full bg-texto-suave" />
    </span>
  )
}

type PropsTamanho = { pct: number; perdaPct: number; patrimonio: number; sugerido: number }

/** Quanto colocar em reais, de onde vem esse número e quanto pode perder */
function Tamanho({ pct, perdaPct, patrimonio, sugerido }: PropsTamanho) {
  if (patrimonio <= 0) {
    // Sem nada investido ainda: mostra a conta com um exemplo de R$ 1.000
    const exemplo = pct * 10
    return (
      <div className="rounded-xl bg-texto/[0.05] px-3 py-3 text-sm">
        <p className="text-xs text-texto-suave">Quanto colocar, no máximo</p>
        <p className="mt-0.5">
          A cada <span className="font-semibold">R$ 1.000</span> investidos, até{' '}
          <span className="numero font-semibold">{formatarMoeda(exemplo)}</span> nesta tese ({percentual.format(pct)}%).
        </p>
        <p className="mt-2 border-t border-borda pt-2 text-xs text-texto-suave">
          Se der errado, esses {formatarMoeda(exemplo)} podem perder até{' '}
          <span className="font-semibold text-despesa">{formatarMoeda((exemplo * perdaPct) / 100)}</span>.
        </p>
      </div>
    )
  }
  return (
    <div className="rounded-xl bg-texto/[0.05] px-3 py-3 text-sm">
      <p className="text-xs text-texto-suave">Quanto colocar, no máximo</p>
      <p className="numero mt-0.5 text-xl font-semibold">{formatarMoeda(sugerido)}</p>
      <p className="text-xs text-texto-suave">
        {percentual.format(pct)}% dos {formatarMoeda(patrimonio)} que você tem investido hoje
      </p>
      <p className="mt-2 border-t border-borda pt-2 text-xs text-texto-suave">
        Se der errado, você perde até{' '}
        <span className="font-semibold text-despesa">{formatarMoeda((sugerido * perdaPct) / 100)}</span> desse valor (
        {percentual.format(perdaPct)}%). O resto do patrimônio não é afetado.
      </p>
    </div>
  )
}

function Linha({ rotulo, children }: { rotulo: string; children: string }) {
  return (
    <div>
      <dt className="inline font-medium">{rotulo}: </dt>
      <dd className="inline text-texto-suave">{children}</dd>
    </div>
  )
}

function prazo(dias: number) {
  if (dias < 30) return `${dias} dias`
  if (dias < 365) return `${Math.round(dias / 30)} ${Math.round(dias / 30) === 1 ? 'mês' : 'meses'}`
  return `${Math.round(dias / 365)} ${Math.round(dias / 365) === 1 ? 'ano' : 'anos'}`
}
