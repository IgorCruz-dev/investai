import { useMemo, useState } from 'react'
import { inicioDoMes, somarMeses } from '../lib/datas'
import { formatarMesAno, formatarMoeda } from '../lib/formatar'
import { aportePara, mesesAte, metaDaReserva, MESES_DE_RESERVA, PRODUTOS, projetar, type SelicPorAno } from '../lib/projecoes'
import type { PerfilFinanceiro } from '../services/perfilFinanceiro'
import Card from './Card'
import Campo from './Campo'
import Dica from './Dica'
import Esqueleto from './Esqueleto'
import { IconeEscudo, IconeRendimento } from './icones'

// Prazos dos planos sugeridos para completar a reserva
const PLANOS = [6, 12, 24]

const PRAZOS = [
  { meses: 12, rotulo: '1 ano' },
  { meses: 24, rotulo: '2 anos' },
  { meses: 60, rotulo: '5 anos' },
]

/** Os dois cards dividem o mesmo "guardar por mês": escolher um plano na reserva muda o simulador, e vice-versa */
type Props = {
  perfil: PerfilFinanceiro | null
  /** Patrimônio pessoal de hoje: é o ponto de partida */
  patrimonio: number
  selic: SelicPorAno
  /** Quanto guardar por mês, em centavos */
  aporte: number
  aoMudarAporte: (centavos: number) => void
  carregando: boolean
}

/** Média que sobrou nos últimos meses, arredondada para baixo em R$ 10: é o "guardar por mês" inicial */
export const sugestaoDeAporte = (perfil: PerfilFinanceiro | null) => Math.max(0, Math.floor((perfil?.sobraMedia ?? 0) / 10) * 10)

const duracao = (meses: number) => {
  const anos = Math.floor(meses / 12)
  const resto = meses % 12
  return [anos ? `${anos} ${anos === 1 ? 'ano' : 'anos'}` : '', resto ? `${resto} ${resto === 1 ? 'mês' : 'meses'}` : '']
    .filter(Boolean)
    .join(' e ')
}

const periodoDe = (perfil: PerfilFinanceiro) => `${perfil.meses} ${perfil.meses === 1 ? 'mês' : 'meses'}`

/** Reserva de emergência: quanto falta, quando chega e planos para chegar. Vem antes de qualquer outra aplicação. */
export function CardReserva({ perfil, patrimonio, selic, aporte, aoMudarAporte, carregando }: Props) {
  const icone = <IconeEscudo className="h-4 w-4" />
  if (carregando || !perfil) {
    return (
      <Card titulo="Reserva de emergência" icone={icone}>
        <Esqueleto className="h-56" />
      </Card>
    )
  }

  const meta = metaDaReserva(perfil.gastoMedio)
  const completa = meta > 0 && patrimonio >= meta
  const progresso = meta > 0 ? Math.min((patrimonio / meta) * 100, 100) : 0
  const ate = mesesAte(meta, { produto: 'cdb', inicial: patrimonio, aporteMensal: aporte / 100, selic })
  // Planos para bater a meta, arredondados para cima em R$ 10 (continua chegando no prazo)
  const planos = completa
    ? []
    : PLANOS.map((meses) => ({
        meses,
        valor: Math.ceil(aportePara(meta, meses, { produto: 'cdb', inicial: patrimonio, selic }) / 10) * 10,
      }))
  const sobra = Math.max(perfil.sobraMedia, 0)
  const periodo = periodoDe(perfil)

  return (
    <Card
      icone={icone}
      titulo={
        <>
          Reserva de emergência
          <Dica rotulo="Como a meta é calculada">
            A meta é {MESES_DE_RESERVA}× o seu gasto médio de {formatarMoeda(perfil.gastoMedio)} por mês: dinheiro para segurar{' '}
            {MESES_DE_RESERVA} meses sem renda, num lugar que dá para sacar no mesmo dia.
            {!completa && ate === null && (
              <span className="mt-2 block">Defina quanto guardar por mês para ver em quanto tempo chega.</span>
            )}
          </Dica>
        </>
      }
      acao={
        <span
          className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${completa ? 'bg-receita/15 text-receita' : 'bg-texto/[0.07]'}`}
        >
          {Math.floor(progresso)}%
        </span>
      }
    >
      <p className="flex flex-wrap items-baseline gap-x-1.5">
        <span className="numero text-2xl font-semibold">{formatarMoeda(patrimonio)}</span>
        <span className="text-sm text-texto-suave">de {formatarMoeda(meta)}</span>
      </p>
      <div
        className="mt-3 h-2 overflow-hidden rounded-full bg-texto/[0.08]"
        role="progressbar"
        aria-label="Progresso da reserva de emergência"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.floor(progresso)}
      >
        <div className="h-full rounded-full bg-primaria transition-all duration-700" style={{ width: `${progresso}%` }} />
      </div>

      {completa ? (
        <p className="mt-3 text-sm text-receita">Reserva completa. Daqui para frente, o radar libera as apostas táticas.</p>
      ) : (
        <>
          <dl className="mt-4 grid grid-cols-2 gap-3">
            <div className="rounded-xl bg-texto/[0.04] px-3 py-2.5">
              <dt className="text-xs text-texto-suave">Faltam</dt>
              <dd className="numero mt-0.5 font-semibold">{formatarMoeda(meta - patrimonio)}</dd>
            </div>
            <div className="rounded-xl bg-texto/[0.04] px-3 py-2.5">
              <dt className="text-xs text-texto-suave">Chega em</dt>
              <dd className="mt-0.5 font-semibold">{ate === null ? '—' : duracao(ate)}</dd>
              {ate !== null && <dd className="text-xs text-texto-suave">{formatarMesAno(somarMeses(inicioDoMes(), ate))}</dd>}
            </div>
          </dl>
          <p className="mt-2 text-xs text-texto-suave">
            {ate === null
              ? 'Escolha um plano abaixo ou digite quanto guardar por mês.'
              : `Guardando ${formatarMoeda(aporte / 100)} por mês num CDB 100% do CDI.`}
          </p>

          <p className="mt-4 text-sm font-medium">Para bater a meta, guarde por mês</p>
          <div className="mt-2 grid grid-cols-3 gap-2" role="group" aria-label="Planos para bater a meta">
            {planos.map((pl) => {
              const escolhido = aporte === Math.round(pl.valor * 100)
              const cabe = pl.valor <= sobra
              return (
                <button
                  key={pl.meses}
                  type="button"
                  aria-pressed={escolhido}
                  onClick={() => aoMudarAporte(Math.round(pl.valor * 100))}
                  className={`rounded-xl px-2.5 py-2.5 text-left transition ${
                    escolhido ? 'bg-texto text-fundo' : 'bg-texto/[0.04] hover:bg-texto/[0.08]'
                  }`}
                >
                  <span className={`block text-xs ${escolhido ? 'opacity-70' : 'text-texto-suave'}`}>{duracao(pl.meses)}</span>
                  <span className="numero block text-sm font-semibold">{formatarMoeda(pl.valor)}</span>
                  <span
                    className={`mt-1 block text-[11px] leading-tight font-medium ${
                      escolhido ? 'opacity-80' : cabe ? 'text-receita' : 'text-texto-suave'
                    }`}
                  >
                    {perfil.meses === 0 ? 'por mês' : cabe ? 'cabe na sobra' : 'acima da sobra'}
                  </span>
                </button>
              )
            })}
          </div>
          {perfil.meses > 0 && (
            <p className="mt-2 text-xs text-texto-suave">
              {sobra > 0
                ? `Nos últimos ${periodo} sobraram em média ${formatarMoeda(sobra)} por mês. Escolha um plano que caiba nisso.`
                : `Nos últimos ${periodo} não sobrou dinheiro. Comece revisando os gastos fixos e guarde o que der: qualquer valor encurta o prazo.`}
            </p>
          )}
        </>
      )}
    </Card>
  )
}

/** Simulador: quanto o dinheiro guardado vira em cada produto, já sem IR */
export function CardSimulador({ perfil, patrimonio, selic, aporte, aoMudarAporte, carregando }: Props) {
  const [prazo, setPrazo] = useState(24)
  const icone = <IconeRendimento className="h-4 w-4" />

  const resultados = useMemo(
    () =>
      PRODUTOS.map((p) => {
        const pontos = projetar({ produto: p.id, inicial: patrimonio, aporteMensal: aporte / 100, meses: prazo, selic })
        const fim = pontos[pontos.length - 1]
        return { ...p, liquido: fim?.liquido ?? patrimonio, aportado: fim?.aportado ?? patrimonio }
      }).sort((a, b) => b.liquido - a.liquido),
    [patrimonio, aporte, prazo, selic],
  )

  if (carregando || !perfil) {
    return (
      <Card titulo="Quanto o dinheiro rende" icone={icone}>
        <Esqueleto className="h-64" />
      </Card>
    )
  }

  const melhor = resultados[0]

  return (
    <Card titulo="Quanto o dinheiro rende" icone={icone}>
      <div className="grid gap-4 sm:grid-cols-[1fr_auto] sm:items-end">
        <Campo
          id="aporte"
          label="Guardar por mês"
          inputMode="numeric"
          autoComplete="off"
          value={formatarMoeda(aporte / 100)}
          onChange={(e) => aoMudarAporte(Number(e.target.value.replace(/\D/g, '').slice(-9) || 0))}
        />
        <div role="group" aria-label="Prazo" className="flex gap-2">
          {PRAZOS.map((p) => (
            <button
              key={p.meses}
              type="button"
              aria-pressed={prazo === p.meses}
              onClick={() => setPrazo(p.meses)}
              className={`h-12 rounded-2xl px-4 text-sm font-medium transition ${prazo === p.meses ? 'bg-texto text-fundo' : 'bg-texto/[0.05] text-texto-suave hover:text-texto'}`}
            >
              {p.rotulo}
            </button>
          ))}
        </div>
      </div>
      <p className="mt-2 flex items-center gap-1.5 text-xs text-texto-suave">
        {perfil.meses > 0 ? (
          <>
            Sugestão: <span className="numero font-semibold text-texto">{formatarMoeda(sugestaoDeAporte(perfil))}</span>
            <Dica rotulo="De onde vem a sugestão">
              É a média do que sobrou (o que entrou menos o que saiu) nos últimos {periodoDe(perfil)} fechados, arredondada para
              baixo.
            </Dica>
          </>
        ) : (
          'Ainda não há meses fechados para sugerir um valor.'
        )}
      </p>

      <p className="mt-6 text-sm font-medium">Quanto vira em {PRAZOS.find((p) => p.meses === prazo)?.rotulo}</p>
      <ul className="mt-2 divide-y divide-borda rounded-2xl border border-borda">
        {resultados.map((r) => {
          const ganho = r.liquido - r.aportado
          return (
            <li key={r.id} className="flex items-center gap-3 px-4 py-3">
              <span className="min-w-0 flex-1">
                <span className="block font-medium">{r.nome}</span>
                <span className="block text-xs text-texto-suave">{r.detalhe}</span>
                {r.id === melhor.id && (
                  <span className="mt-1 inline-block rounded-full bg-primaria/20 px-2 py-0.5 text-xs font-semibold whitespace-nowrap text-destaque">
                    Rende mais
                  </span>
                )}
              </span>
              <span className="shrink-0 text-right">
                <span className="numero block font-semibold">{formatarMoeda(r.liquido)}</span>
                <span className="numero block text-xs text-receita">+{formatarMoeda(ganho)} líquido</span>
              </span>
            </li>
          )
        })}
      </ul>
      <p className="mt-3 text-xs text-texto-suave">
        Valores líquidos se resgatar tudo no fim do prazo, com a Selic que o mercado espera (Focus) e o CDI 0,10 p.p. abaixo dela.
        Simulação, não garantia.
      </p>
    </Card>
  )
}
