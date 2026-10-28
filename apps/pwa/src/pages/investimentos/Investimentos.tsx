import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router'
import Alerta from '../../components/Alerta'
import Card from '../../components/Card'
import CardCarteira from '../../components/CardCarteira'
import CardNoticias from '../../components/CardNoticias'
import { CardReserva, CardSimulador, sugestaoDeAporte } from '../../components/CardProjecoes'
import CardRadar from '../../components/CardRadar'
import DiarioDeTeses from '../../components/CardTeses'
import Esqueleto, { EsqueletoLista } from '../../components/Esqueleto'
import FaixaIndicadores from '../../components/FaixaIndicadores'
import GraficoDolar from '../../components/GraficoDolar'
import GraficoRendimentos, { type RendimentoDoMes } from '../../components/GraficoRendimentos'
import LogoBanco from '../../components/LogoBanco'
import TituloSecao from '../../components/TituloSecao'
import {
  IconeAlvo,
  IconeCarteira,
  IconeDolar,
  IconeEmpresa,
  IconeGrafico,
  IconeRendimento,
  IconeSetaDireita,
} from '../../components/icones'
import { useAuth } from '../../hooks/useAuth'
import { useLancamentos } from '../../hooks/useLancamentos'
import { deISO, inicioDoMes, mesAnterior, paraMesISO, somarMeses } from '../../lib/datas'
import { formatarDia, formatarMoeda, formatarNomeDoMes } from '../../lib/formatar'
import type { SelicPorAno } from '../../lib/projecoes'
import { listarCarteira, valorAtual, type Cotacao, type Investimento } from '../../services/carteira'
import { buscarInvestimentos, type ContaQueRende } from '../../services/rendimentos'
import CarteiraDeclarada from './CarteiraDeclarada'
import { atualizarMercado, buscarMercado, mercadoEstaVelho, type Mercado } from '../../services/mercado'
import { buscarPerfilFinanceiro, type PerfilFinanceiro } from '../../services/perfilFinanceiro'
import {
  buscarGastoIA,
  listarNoticias,
  listarSinais,
  listarTeses,
  registrarTese,
  type GastoIA,
  type Noticia,
  type Sinal,
  type Tese,
} from '../../services/radar'
import type { Transacao } from '../../types/financas'

const ULTIMOS = 5

/**
 * Central de investimentos: indicadores de mercado, carteira pessoal (Pluggy + cadastrados à mão) e, separado, o que é
 * da empresa (rendimento automático da conta do Mercado Pago e posições da empresa).
 */
export default function Investimentos() {
  const { usuario } = useAuth()
  const { versao } = useLancamentos()
  const [rendimentos, setRendimentos] = useState<Transacao[]>([])
  const [contas, setContas] = useState<ContaQueRende[]>([])
  // Guardar por mês (centavos), dividido entre a reserva e o simulador; null = usa a sugestão
  const [aporteDigitado, setAporteDigitado] = useState<number | null>(null)
  const [categoriaId, setCategoriaId] = useState<string | null>(null)
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState('')
  const [mercado, setMercado] = useState<Mercado | null>(null)
  const [carregandoMercado, setCarregandoMercado] = useState(true)
  const [carteira, setCarteira] = useState<Investimento[]>([])
  const [cotacoes, setCotacoes] = useState<Map<string, Cotacao>>(new Map())
  const [carregandoCarteira, setCarregandoCarteira] = useState(true)
  const [perfil, setPerfil] = useState<PerfilFinanceiro | null>(null)
  const [sinais, setSinais] = useState<Sinal[]>([])
  const [noticias, setNoticias] = useState<Noticia[]>([])
  const [teses, setTeses] = useState<Tese[]>([])
  const [gastoIA, setGastoIA] = useState<GastoIA | null>(null)
  const [carregandoRadar, setCarregandoRadar] = useState(true)

  useEffect(() => {
    if (!usuario) return
    let ativo = true
    buscarInvestimentos()
      .then((r) => {
        if (!ativo) return
        setRendimentos(r.rendimentos)
        setContas(r.contas)
        setCategoriaId(r.categoriaId)
        setErro('')
      })
      .catch(() => ativo && setErro('Não foi possível carregar seus investimentos.'))
      .finally(() => ativo && setCarregando(false))
    return () => {
      ativo = false
    }
  }, [usuario, versao])

  useEffect(() => {
    if (!usuario) return
    let ativo = true
    listarCarteira()
      .then((r) => {
        if (!ativo) return
        setCarteira(r.investimentos)
        setCotacoes(r.cotacoes)
      })
      .catch(() => ativo && setErro('Não foi possível carregar sua carteira.'))
      .finally(() => ativo && setCarregandoCarteira(false))
    return () => {
      ativo = false
    }
  }, [usuario, versao])

  useEffect(() => {
    if (!usuario) return
    let ativo = true
    buscarPerfilFinanceiro()
      .then((p) => ativo && setPerfil(p))
      .catch(() => ativo && setPerfil({ meses: 0, gastoMedio: 0, sobraMedia: 0 }))
    return () => {
      ativo = false
    }
  }, [usuario, versao])

  // Radar: sinais e notícias são iguais para todo mundo (gravados pelo servidor); o diário é do usuário
  useEffect(() => {
    if (!usuario) return
    let ativo = true
    Promise.all([listarSinais(), listarNoticias(), listarTeses(), buscarGastoIA()])
      .then(([s, n, t, g]) => {
        if (!ativo) return
        setSinais(s)
        setNoticias(n)
        setTeses(t)
        setGastoIA(g)
      })
      .catch(() => ativo && setErro('Não foi possível carregar o radar.'))
      .finally(() => ativo && setCarregandoRadar(false))
    return () => {
      ativo = false
    }
  }, [usuario])

  async function decidirSinal(sinal: Sinal, decisao: 'entrei' | 'passei', valor: number | null) {
    try {
      await registrarTese(sinal, decisao, valor)
      setTeses(await listarTeses())
    } catch {
      setErro('Não foi possível registrar no diário.')
    }
  }

  // Indicadores: mostra o que tem gravado; se estiver velho, pede para atualizar e mostra de novo
  useEffect(() => {
    if (!usuario) return
    let ativo = true
    buscarMercado()
      .then(async (m) => {
        if (!ativo) return
        setMercado(m)
        setCarregandoMercado(false)
        if (!mercadoEstaVelho(m)) return
        await atualizarMercado()
        const novo = await buscarMercado()
        if (ativo) setMercado(novo)
      })
      .catch(() => ativo && setCarregandoMercado(false))
    return () => {
      ativo = false
    }
  }, [usuario])

  // Do primeiro mês com rendimento até o mês atual (no máximo 12)
  const porMes = useMemo<RendimentoDoMes[]>(() => {
    const atual = inicioDoMes()
    const soma = new Map<string, number>()
    for (const t of rendimentos) {
      const chave = t.data.slice(0, 7)
      soma.set(chave, (soma.get(chave) ?? 0) + Math.round(t.valor * 100))
    }
    const primeiro = rendimentos.length ? inicioDoMes(deISO(rendimentos[rendimentos.length - 1].data)) : atual
    const pontos: RendimentoDoMes[] = []
    for (let mes = primeiro; mes <= atual; mes = somarMeses(mes, 1)) {
      pontos.push({ mes, total: (soma.get(paraMesISO(mes)) ?? 0) / 100 })
    }
    return pontos.slice(-12)
  }, [rendimentos])

  const saldo = contas.reduce((s, c) => s + Math.round((c.saldo ?? 0) * 100), 0) / 100
  const bancos = [...new Set(contas.map((c) => c.banco ?? c.nome))]
  const ondeRende = bancos.join(' e ')
  const daEmpresa = contas.length > 0 && contas.every((c) => c.empresarial)
  const esteMes = porMes[porMes.length - 1]?.total ?? 0
  const passado = porMes.find((p) => paraMesISO(p.mes) === paraMesISO(mesAnterior(inicioDoMes())))?.total
  const pessoais = carteira.filter((i) => !i.empresarial && i.origem === 'pluggy')
  const daEmpresaNaCarteira = carteira.filter((i) => i.empresarial && i.origem === 'pluggy')
  const patrimonio = pessoais.reduce((s, i) => s + Math.round(valorAtual(i) * 100), 0) / 100
  // Selic esperada por ano (Focus); sem Focus, a meta de hoje para sempre
  const selic = useMemo<SelicPorAno>(() => {
    const porAno: SelicPorAno = {}
    for (const e of mercado?.expectativas ?? []) if (e.indicador === 'Selic') porAno[e.ano] = e.mediana
    const hoje = mercado?.indicadores.selic_meta?.atual.valor
    if (Object.keys(porAno).length === 0 && hoje) porAno[new Date().getFullYear()] = hoje
    return porAno
  }, [mercado])
  const projecoes = {
    perfil,
    patrimonio,
    selic,
    aporte: aporteDigitado ?? Math.round(sugestaoDeAporte(perfil) * 100),
    aoMudarAporte: setAporteDigitado,
    carregando: carregandoCarteira || carregandoMercado || Object.keys(selic).length === 0,
  }
  const linkDoMes = (mes: string) => `/lancamentos?mes=${mes}${categoriaId ? `&categoria=${categoriaId}` : ''}`

  return (
    <>
      <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Investimentos</h1>

      {erro && (
        <div className="mt-4">
          <Alerta>{erro}</Alerta>
        </div>
      )}

      <FaixaIndicadores mercado={mercado} carregando={carregandoMercado} />

      <p className="mt-1 text-sm text-texto-suave">Dados do banco e carteira declarada, com origens separadas.</p>

      <TituloSecao
        primeira
        icone={<IconeCarteira className="h-5 w-5" />}
        titulo="Sua carteira"
        descricao="Investimentos reportados pela Pluggy e lançamentos financeiros, sem posições da bolsa declarada"
      />
      <div className="mt-4 lg:grid lg:grid-cols-2 lg:items-start lg:gap-6">
        {/* Esquerda: o que você tem e a reserva; direita: o simulador. O dólar vem embaixo, na largura toda. */}
        <div className="space-y-6">
          <CardCarteira
            titulo="Patrimônio pessoal"
            icone={<IconeCarteira className="h-4 w-4" />}
            investimentos={pessoais}
            cotacoes={cotacoes}
            carregando={carregandoCarteira}
            aoAbrir={() => {}}
            vazio="Nenhum investimento reportado pelo banco ainda."
          />
          <CardReserva {...projecoes} />
        </div>
        <div className="mt-6 lg:mt-0">
          <CardSimulador {...projecoes} />
        </div>
      </div>
      {mercado && mercado.dolar.length > 0 && (
        <Card titulo="Dólar em 12 meses" icone={<IconeDolar className="h-4 w-4" />} className="mt-6">
          <GraficoDolar pontos={mercado.dolar} />
        </Card>
      )}

      <TituloSecao
        icone={<IconeAlvo className="h-5 w-5" />}
        titulo="Oportunidades"
        descricao="Sinais do dia, notícias e o diário do que você decidiu"
        acao={<DiarioDeTeses teses={teses} carregando={carregandoRadar} />}
      />
      <div className="mt-4">
        <CardRadar
          sinais={sinais}
          teses={teses}
          gasto={gastoIA}
          perfil={perfil}
          patrimonio={patrimonio}
          carregando={carregandoRadar || carregandoCarteira}
          aoDecidir={decidirSinal}
        />
      </div>
      <div className="mt-6">
        <CardNoticias noticias={noticias} carregando={carregandoRadar} />
      </div>

      <TituloSecao
        icone={<IconeEmpresa className="h-5 w-5" />}
        titulo="Da empresa"
        descricao="Dinheiro do CNPJ, separado do seu patrimônio"
      />

      {/* xl: saldo numa coluna, gráfico e últimos rendimentos nas outras duas */}
      <div className="xl:grid xl:grid-cols-3 xl:items-start xl:gap-6">
        <div className="animate-surgir relative mt-4 overflow-hidden rounded-[28px] bg-[#141519] bg-[radial-gradient(120%_90%_at_100%_0%,rgb(212_175_55/0.22),transparent_55%)] p-6 text-white shadow-[inset_0_1px_0_rgb(255_255_255/0.08),0_24px_60px_-28px_rgb(0_0_0/0.6)] ring-1 ring-white/5">
          {/* Dinheiro da empresa fica separado do patrimônio pessoal */}
          <div className="flex items-center justify-between gap-2 text-sm font-medium">
            <span className="flex min-w-0 items-center gap-2.5">
              {bancos.length > 0 && (
                <span className="flex shrink-0 -space-x-2">
                  {bancos.map((b) => (
                    <LogoBanco key={b} banco={b} className="h-8 w-8" />
                  ))}
                </span>
              )}
              <span className="opacity-75">{ondeRende ? `Saldo no ${ondeRende}` : 'Saldo rendendo'}</span>
            </span>
            {daEmpresa && (
              <span className="flex shrink-0 items-center gap-1 rounded-full bg-white/10 px-2.5 py-1 text-xs font-semibold">
                <IconeEmpresa className="h-3.5 w-3.5" />
                Da empresa
              </span>
            )}
          </div>
          {carregando ? (
            <Esqueleto className="mt-3 h-12 w-48 bg-white/10" />
          ) : (
            <p className="cifra mt-2 text-5xl font-semibold">{formatarMoeda(saldo)}</p>
          )}
          {!carregando && (
            <p className="mt-3 text-sm">
              Rendeu <span className="font-semibold text-primaria">+{formatarMoeda(esteMes)}</span> em {formatarNomeDoMes(inicioDoMes())}
              {passado !== undefined && (
                <span className="opacity-75">
                  {' '}
                  · {formatarMoeda(passado)} em {formatarNomeDoMes(mesAnterior(inicioDoMes()))}
                </span>
              )}
            </p>
          )}
          <p className="mt-1 text-xs opacity-75">Rendimento automático da conta, informado pelo banco a cada dia útil.</p>
        </div>

        <div className="xl:col-span-2">
          {!carregando && rendimentos.length === 0 ? (
            <div className="mt-6 flex flex-col items-center rounded-[28px] solido px-5 py-14 text-center">
              <span className="flex h-12 w-12 items-center justify-center rounded-full bg-texto/[0.07] text-texto-suave">
                <IconeRendimento className="h-6 w-6" />
              </span>
              <p className="mt-4 font-medium">Nenhum rendimento ainda</p>
              <p className="mt-1 max-w-xs text-sm text-texto-suave">
                Os rendimentos aparecem aqui quando entram na categoria Rendimentos.
              </p>
            </div>
          ) : (
            <div className="lg:mt-6 lg:grid lg:grid-cols-2 lg:items-start lg:gap-6">
              <Card titulo="Rendimento por mês" icone={<IconeGrafico className="h-4 w-4" />} className="mt-6 lg:mt-0">
                {carregando ? <Esqueleto className="h-52" /> : <GraficoRendimentos pontos={porMes} />}
              </Card>

              <Card
                titulo="Últimos rendimentos"
                icone={<IconeRendimento className="h-4 w-4" />}
                className="mt-6 lg:mt-0"
                semEspaco
                acao={
                  <Link
                    to={linkDoMes(paraMesISO(inicioDoMes()))}
                    className="text-sm font-medium text-texto-suave transition hover:text-texto"
                  >
                    Ver todos
                  </Link>
                }
              >
                {carregando ? (
                  <EsqueletoLista linhas={ULTIMOS} />
                ) : (
                  <ul className="divide-y divide-borda">
                    {rendimentos.slice(0, ULTIMOS).map((t) => (
                      <li key={t.id}>
                        {/* Abre os lançamentos do mês dele, só com rendimentos */}
                        <Link
                          to={linkDoMes(t.data.slice(0, 7))}
                          className="flex items-center gap-3 px-5 py-3.5 transition hover:bg-texto/[0.04]"
                        >
                          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-receita/15 text-receita">
                            <IconeRendimento className="h-4 w-4" />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block font-medium">{t.local ?? 'Rendimento'}</span>
                            <span className="block truncate text-xs text-texto-suave">{formatarDia(t.data)}</span>
                          </span>
                          <span className="numero shrink-0 font-semibold text-receita">+{formatarMoeda(t.valor)}</span>
                          <IconeSetaDireita className="h-4 w-4 shrink-0 text-texto-suave" />
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            </div>
          )}
        </div>
      </div>

      {daEmpresaNaCarteira.length > 0 && (
        <div className="mt-6 lg:grid lg:grid-cols-2 lg:gap-6">
          <CardCarteira
            titulo="Investimentos da empresa"
            investimentos={daEmpresaNaCarteira}
            cotacoes={cotacoes}
            carregando={false}
            aoAbrir={() => {}}
          />
        </div>
      )}

      <CarteiraDeclarada />


    </>
  )
}
