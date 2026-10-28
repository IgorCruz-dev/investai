import { useEffect, useMemo, useState } from 'react'
import Alerta from '../../components/Alerta'
import Card from '../../components/Card'
import Esqueleto, { EsqueletoLista } from '../../components/Esqueleto'
import ModalAssinatura from '../../components/ModalAssinatura'
import { IconeEmpresa, IconeMais, IconeRepetir } from '../../components/icones'
import { useLancamentos } from '../../hooks/useLancamentos'
import { andamentoDasParcelas, diasAte, proximaCobranca, textoDiasAte } from '../../lib/assinaturas'
import { EMPRESA } from '../../lib/empresa'
import { formatarDiaMes, formatarMoeda } from '../../lib/formatar'
import { contarCobrancas, definirAtiva, listarAssinaturas } from '../../services/assinaturas'
import { listarCartoes } from '../../services/cartoes'
import { listarCategorias } from '../../services/categorias'
import type { Assinatura, Cartao, Categoria } from '../../types/financas'

/** Cobranças em até 5 dias ganham destaque */
const DIAS_DESTAQUE = 5

export default function Assinaturas() {
  const { versao } = useLancamentos()
  const [assinaturas, setAssinaturas] = useState<Assinatura[]>([])
  const [cartoes, setCartoes] = useState<Cartao[]>([])
  const [categorias, setCategorias] = useState<Categoria[]>([])
  const [cobrancas, setCobrancas] = useState<Map<string, number>>(new Map())
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState('')
  // undefined = fechado; null = nova
  const [editando, setEditando] = useState<Assinatura | null | undefined>(undefined)
  const [recarregar, setRecarregar] = useState(0)

  useEffect(() => {
    let ativo = true
    Promise.all([listarAssinaturas(), listarCartoes(), contarCobrancas(), listarCategorias()])
      .then(([ass, crts, cont, cats]) => {
        if (!ativo) return
        setAssinaturas(ass)
        setCartoes(crts)
        setCategorias(cats)
        setCobrancas(cont)
        setErro('')
      })
      .catch(() => ativo && setErro('Não foi possível carregar suas assinaturas.'))
      .finally(() => ativo && setCarregando(false))
    return () => {
      ativo = false
    }
  }, [versao, recarregar])

  const cartaoPorId = useMemo(() => new Map(cartoes.map((c) => [c.id, c])), [cartoes])
  const andamento = (a: Assinatura) => andamentoDasParcelas(a, cobrancas.get(a.id) ?? 0)
  // Parcelado que já terminou sai das ativas sozinho, mesmo sem pausar
  const ativas = assinaturas.filter((a) => a.ativa && !andamento(a)?.quitada)
  const pausadas = assinaturas.filter((a) => !a.ativa || andamento(a)?.quitada)
  // Cobrada num cartão da empresa: despesa da empresa, fora do total pessoal
  const daEmpresa = (a: Assinatura) => (a.cartao_id ? (cartaoPorId.get(a.cartao_id)?.empresarial ?? false) : false)
  const ativasPessoais = ativas.filter((a) => !daEmpresa(a))
  const ativasEmpresa = ativas.filter(daEmpresa)
  // Conta fixa: recorrente que não é assinatura (carro, faculdade, celular...): tudo que não está na categoria Assinaturas
  const iconePorCategoria = useMemo(() => new Map(categorias.map((c) => [c.id, c.icone])), [categorias])
  const ehContaFixa = (a: Assinatura) => Boolean(a.categoria_id) && iconePorCategoria.get(a.categoria_id!) !== 'assinaturas'
  const assinaturasPessoais = ativasPessoais.filter((a) => !ehContaFixa(a))
  const contasFixas = ativasPessoais.filter(ehContaFixa)
  const somar = (lista: Assinatura[]) => lista.reduce((soma, a) => soma + Math.round(a.valor * 100), 0) / 100
  const totalPessoal = somar(ativasPessoais)
  const totalEmpresa = somar(ativasEmpresa)

  const proximas = ativas
    .map((a) => ({ assinatura: a, data: proximaCobranca(a) }))
    .map((p) => ({ ...p, dias: diasAte(p.data) }))
    .filter((p) => p.dias <= DIAS_DESTAQUE)
  const totalProximas = proximas.reduce((soma, p) => soma + Math.round(p.assinatura.valor * 100), 0) / 100
  const diasPorId = new Map(proximas.map((p) => [p.assinatura.id, p.dias]))

  async function retomar(a: Assinatura) {
    try {
      await definirAtiva(a.id, true)
      setRecarregar((n) => n + 1)
    } catch (err) {
      setErro((err as Error).message)
    }
  }

  function linha(a: Assinatura, pausada = false) {
    const cartao = a.cartao_id ? cartaoPorId.get(a.cartao_id) : undefined
    const dias = diasPorId.get(a.id)
    const destaque = !pausada && dias !== undefined
    const parcelas = andamento(a)
    return (
      <li key={a.id} className={destaque ? 'bg-aviso-fundo' : ''}>
        <div className="flex items-center gap-3 px-5 py-3.5">
          <button onClick={() => setEditando(a)} className="flex min-w-0 flex-1 items-center gap-3 text-left">
            <span
              className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${pausada ? 'bg-texto/[0.07] text-texto-suave' : 'bg-lilas/12 text-lilas'}`}
            >
              <IconeRepetir className="h-[18px] w-[18px]" />
            </span>
            <span className="min-w-0 flex-1">
              <span className={`block truncate font-medium ${pausada ? 'text-texto-suave' : ''}`}>{a.nome}</span>
              <span className="flex items-center gap-1.5 truncate text-xs text-texto-suave">
                Todo dia {a.dia_cobranca} ·
                {cartao ? (
                  <>
                    <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: cartao.cor }} />
                    {cartao.nome}
                  </>
                ) : (
                  ` ${a.do_banco ? 'Conta' : 'Débito'}`
                )}
              </span>
              {parcelas && (
                <span className="block text-xs text-texto-suave">
                  {parcelas.quitada
                    ? `Quitado · ${parcelas.total} de ${parcelas.total}`
                    : `${parcelas.pagas} de ${parcelas.total} pagas · termina em ${parcelas.fimTexto}`}
                </span>
              )}
              {destaque && (
                <span className="mt-1 inline-block rounded-full bg-alerta/15 px-2 py-0.5 text-xs font-semibold text-alerta">
                  {textoDiasAte(dias)}
                </span>
              )}
            </span>
            <span className={`shrink-0 font-semibold ${pausada ? 'text-texto-suave' : ''}`}>{formatarMoeda(a.valor)}</span>
          </button>
          {pausada && a.ativa === false && (
            <button
              onClick={() => retomar(a)}
              className="shrink-0 rounded-lg border border-borda px-3 py-1.5 text-xs font-semibold transition hover:bg-texto/[0.05]"
            >
              Retomar
            </button>
          )}
        </div>
      </li>
    )
  }

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Fixos</h1>
        <button
          onClick={() => setEditando(null)}
          className="flex h-10 items-center gap-1.5 rounded-xl border border-borda vidro px-3.5 text-sm font-semibold transition hover:bg-texto/[0.05]"
        >
          <IconeMais className="h-4 w-4" />
          Nova assinatura
        </button>
      </div>

      {erro && (
        <div className="mt-4">
          <Alerta>{erro}</Alerta>
        </div>
      )}

      {/* xl: total mensal numa coluna, listas nas outras duas */}
      <div className="xl:grid xl:grid-cols-3 xl:items-start xl:gap-6">
        <div>
          {/* Total mensal */}
          <div
            className="destaque destaque-violeta animate-surgir mt-6 p-6 text-white"

          >
            <p className="text-sm text-white/70">Total mensal pessoal</p>
            {carregando ? (
              <Esqueleto className="mt-3 h-11 w-44" />
            ) : (
              <p className="cifra mt-2 text-5xl font-semibold">{formatarMoeda(totalPessoal)}</p>
            )}
            <p className={`mt-1 text-sm text-texto-suave ${carregando ? 'invisible' : ''}`}>
              {formatarMoeda(somar(assinaturasPessoais))} em assinaturas · {formatarMoeda(somar(contasFixas))} em contas fixas
              {proximas.length > 0 && (
                <>
                  {' '}
                  · {formatarMoeda(totalProximas)} nos próximos {DIAS_DESTAQUE} dias
                </>
              )}
            </p>
          </div>

          {/* Total da empresa: só o que é cobrado nos cartões dela */}
          {!carregando && ativasEmpresa.length > 0 && (
            <section
              aria-label={`Assinaturas da ${EMPRESA.nome}`}
              className="escuro animate-surgir mt-4 overflow-hidden rounded-[28px] p-6"
              style={{
                backgroundImage: `radial-gradient(120% 90% at 0% 0%, ${EMPRESA.de}99, transparent 60%), radial-gradient(90% 90% at 100% 100%, ${EMPRESA.para}80, transparent 60%)`,
              }}
            >
              <p className="flex items-center gap-2 text-sm text-white/70">
                <IconeEmpresa className="h-5 w-5 text-white" />
                Total mensal da {EMPRESA.nome}
              </p>
              <p className="cifra mt-2 text-4xl font-semibold text-white">{formatarMoeda(totalEmpresa)}</p>
              <p className="mt-1 text-sm text-white/60">
                {ativasEmpresa.length} {ativasEmpresa.length === 1 ? 'assinatura' : 'assinaturas'} · fora das suas despesas
              </p>
            </section>
          )}
        </div>

        <div className="min-w-0 xl:col-span-2">
          {carregando ? (
            <Card titulo="Ativas" className="mt-6" semEspaco>
              <EsqueletoLista linhas={3} />
            </Card>
          ) : assinaturas.length === 0 ? (
            <div className="mt-6 flex flex-col items-center rounded-[28px] solido px-5 py-14 text-center">
              <span className="flex h-12 w-12 items-center justify-center rounded-full bg-texto/[0.07] text-texto-suave">
                <IconeRepetir className="h-6 w-6" />
              </span>
              <p className="mt-4 font-medium">Nenhuma assinatura cadastrada</p>
              <p className="mt-1 max-w-xs text-sm text-texto-suave">
                Cadastre Netflix, Spotify, academia... e o app lança a cobrança sozinho todo mês. O que vem do banco na categoria
                Assinaturas aparece aqui sozinho.
              </p>
            </div>
          ) : (
            <>
              {proximas.length > 0 && (
                <p className="mt-6 text-sm text-texto-suave">
                  <span className="font-semibold text-alerta">Próximas cobranças: </span>
                  {proximas
                    .sort((a, b) => a.dias - b.dias)
                    .map((p) => `${p.assinatura.nome} (${formatarDiaMes(p.data)})`)
                    .join(', ')}
                </p>
              )}

              <div className="mt-4 grid gap-6 *:min-w-0 xl:grid-cols-2 xl:items-start">
                <Card titulo="Assinaturas pessoais" semEspaco>
                  {assinaturasPessoais.length === 0 ? (
                    <p className="px-5 py-8 text-center text-sm text-texto-suave">Nenhuma assinatura pessoal ativa.</p>
                  ) : (
                    <ul className="divide-y divide-borda">{assinaturasPessoais.map((a) => linha(a))}</ul>
                  )}
                </Card>

                {/* Recorrentes que não são assinatura: entram igual no previsto do mês */}
                {contasFixas.length > 0 && (
                  <Card titulo="Contas fixas" semEspaco>
                    <ul className="divide-y divide-borda">{contasFixas.map((a) => linha(a))}</ul>
                  </Card>
                )}

                {ativasEmpresa.length > 0 && (
                  <Card titulo={EMPRESA.nome} semEspaco>
                    <ul className="divide-y divide-borda">{ativasEmpresa.map((a) => linha(a))}</ul>
                  </Card>
                )}

                {pausadas.length > 0 && (
                  <Card titulo={pausadas.some((a) => a.ativa) ? 'Pausadas e encerradas' : 'Pausadas'} semEspaco>
                    <ul className="divide-y divide-borda">{pausadas.map((a) => linha(a, true))}</ul>
                  </Card>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {editando !== undefined && (
        <ModalAssinatura
          assinatura={editando}
          cartoes={cartoes}
          aoFechar={() => setEditando(undefined)}
          aoMudar={() => setRecarregar((n) => n + 1)}
        />
      )}
    </>
  )
}
