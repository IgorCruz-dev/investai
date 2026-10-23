import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link } from 'react-router'
import Alerta from '../../components/Alerta'
import Card from '../../components/Card'
import GraficoGastosDiarios from '../../components/GraficoGastosDiarios'
import ListaLancamentos from '../../components/ListaLancamentos'
import SeletorMes from '../../components/SeletorMes'
import { IconeLista, IconeSetaBaixo, IconeSetaCima } from '../../components/icones'
import { useAuth } from '../../hooks/useAuth'
import { useLancamentos } from '../../hooks/useLancamentos'
import { inicioDoMes, mesAnterior, paraMesISO } from '../../lib/datas'
import { formatarMoeda, formatarNomeDoMes } from '../../lib/formatar'
import { ehGasto, gastosAcumuladosPorDia, gastosPorCategoria, variacaoPercentual } from '../../lib/resumos'
import { listarCartoes } from '../../services/cartoes'
import { listarCategorias } from '../../services/categorias'
import { buscarPerfil } from '../../services/perfis'
import { buscarSaldoAtual, listarTransacoesDoMes } from '../../services/transacoes'
import type { Cartao, Categoria, Transacao } from '../../types/financas'

const QUANTAS_CATEGORIAS = 5
const QUANTOS_ULTIMOS = 5

/** Aba "Início" (a rota continua /dashboard) */
export default function Dashboard() {
  const { usuario } = useAuth()
  const { versao, editarLancamento } = useLancamentos()
  const [nome, setNome] = useState('')
  const [mes, setMes] = useState(() => inicioDoMes())

  const [transacoes, setTransacoes] = useState<Transacao[]>([])
  const [anteriores, setAnteriores] = useState<Transacao[]>([])
  const [categorias, setCategorias] = useState<Categoria[]>([])
  const [cartoes, setCartoes] = useState<Cartao[]>([])
  const [saldo, setSaldo] = useState<number | null>(null)
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState('')

  useEffect(() => {
    if (!usuario) return
    setNome(usuario.user_metadata.nome ?? '')
    buscarPerfil(usuario.id)
      .then((perfil) => setNome(perfil.nome))
      .catch(() => {}) // sem perfil, fica o nome do cadastro
  }, [usuario])

  // Recarrega ao trocar de mês e sempre que um lançamento é salvo/excluído (versao)
  useEffect(() => {
    let ativo = true
    setCarregando(true)
    Promise.all([
      listarTransacoesDoMes(mes),
      listarTransacoesDoMes(mesAnterior(mes)),
      listarCategorias(),
      listarCartoes(),
      buscarSaldoAtual(),
    ])
      .then(([doMes, doAnterior, cats, crts, s]) => {
        if (!ativo) return
        setTransacoes(doMes)
        setAnteriores(doAnterior)
        setCategorias(cats)
        setCartoes(crts)
        setSaldo(s)
        setErro('')
      })
      .catch(() => ativo && setErro('Não foi possível carregar seus lançamentos.'))
      .finally(() => ativo && setCarregando(false))
    return () => {
      ativo = false
    }
  }, [mes, versao])

  // Somas em centavos para não acumular erro de arredondamento
  const totais = useMemo(() => {
    let receitas = 0
    let despesas = 0
    let noCredito = 0
    for (const t of transacoes) {
      const centavos = Math.round(t.valor * 100)
      if (t.tipo === 'receita') receitas += centavos
      else if (ehGasto(t)) {
        despesas += centavos
        if (t.forma === 'credito') noCredito += centavos
      }
    }
    return { receitas: receitas / 100, despesas: despesas / 100, noCredito: noCredito / 100 }
  }, [transacoes])

  const pontos = useMemo(() => gastosAcumuladosPorDia(transacoes, anteriores, mes), [transacoes, anteriores, mes])
  const porCategoria = useMemo(() => gastosPorCategoria(transacoes, anteriores), [transacoes, anteriores])
  const categoriaPorId = useMemo(() => new Map(categorias.map((c) => [c.id, c])), [categorias])

  const nomeMes = formatarNomeDoMes(mes)
  const nomeMesAnterior = formatarNomeDoMes(mesAnterior(mes))
  const linkDoMes = `/lancamentos?mes=${paraMesISO(mes)}`
  const primeiroNome = nome.split(' ')[0]
  // Na primeira carga mostra o indicador; nas seguintes mantém o conteúdo meio apagado
  const recarregando = carregando ? 'opacity-60 transition' : 'transition'

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Olá{primeiroNome && `, ${primeiroNome}`}</h1>
        <SeletorMes mes={mes} aoMudar={setMes} />
      </div>

      {erro && (
        <div className="mt-4">
          <Alerta>{erro}</Alerta>
        </div>
      )}

      <div className={`mt-6 grid gap-4 sm:grid-cols-3 ${recarregando}`}>
        <div className="rounded-2xl bg-linear-to-br from-emerald-600 to-emerald-800 p-5 text-white shadow-lg shadow-emerald-900/15">
          <p className="text-sm text-emerald-100">Saldo atual da conta</p>
          <p className="mt-2 text-3xl font-bold tracking-tight">{saldo === null ? '—' : formatarMoeda(saldo)}</p>
          <p className="mt-1 text-xs text-emerald-100/80">Compras no crédito só descontam quando a fatura é paga</p>
        </div>
        <CartaoResumo
          titulo="Receitas do mês"
          valor={totais.receitas}
          cor="text-receita"
          fundo="bg-emerald-50"
          icone={<IconeSetaCima className="h-4 w-4" />}
        />
        <CartaoResumo
          titulo="Despesas do mês"
          valor={totais.despesas}
          cor="text-despesa"
          fundo="bg-red-50"
          icone={<IconeSetaBaixo className="h-4 w-4" />}
          detalhe={totais.noCredito > 0 ? `inclui ${formatarMoeda(totais.noCredito)} no crédito` : 'inclui compras no crédito'}
        />
      </div>

      <div className={`mt-6 grid gap-6 lg:grid-cols-5 ${recarregando}`}>
        <Card titulo="Gastos acumulados no mês" className="lg:col-span-3">
          <GraficoGastosDiarios pontos={pontos} nomeMes={nomeMes} nomeMesAnterior={nomeMesAnterior} />
        </Card>

        <Card titulo="Principais categorias" className="lg:col-span-2" semEspaco>
          {porCategoria.length === 0 ? (
            <p className="px-5 py-10 text-center text-sm text-texto-suave">Nenhum gasto neste mês.</p>
          ) : (
            <ul className="divide-y divide-borda">
              {porCategoria.slice(0, QUANTAS_CATEGORIAS).map((g) => {
                const categoria = g.chave === 'sem' ? undefined : categoriaPorId.get(g.chave)
                const fatia = totais.despesas > 0 ? Math.round((g.atual / totais.despesas) * 100) : 0
                return (
                  <li key={g.chave}>
                    <Link
                      to={`${linkDoMes}&categoria=${g.chave}`}
                      className="block px-5 py-3.5 transition hover:bg-slate-50"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <span className="flex min-w-0 items-center gap-2">
                          <span
                            className="h-2.5 w-2.5 shrink-0 rounded-full"
                            style={{ backgroundColor: categoria?.cor ?? '#94a3b8' }}
                          />
                          <span className="truncate font-medium">{categoria?.nome ?? 'Sem categoria'}</span>
                        </span>
                        <span className="shrink-0 font-semibold">{formatarMoeda(g.atual)}</span>
                      </div>
                      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100">
                        <div
                          className="h-full rounded-full"
                          style={{ width: `${fatia}%`, backgroundColor: categoria?.cor ?? '#94a3b8' }}
                        />
                      </div>
                      <div className="mt-1.5 flex items-center justify-between gap-3 text-xs text-texto-suave">
                        <span>{fatia}% do total</span>
                        <Variacao atual={g.atual} anterior={g.anterior} nomeMesAnterior={nomeMesAnterior} />
                      </div>
                    </Link>
                  </li>
                )
              })}
            </ul>
          )}
        </Card>
      </div>

      <Card
        titulo="Últimos lançamentos"
        className="mt-6"
        semEspaco
        acao={
          transacoes.length > 0 && (
            <Link to={linkDoMes} className="text-sm font-semibold text-primaria hover:underline">
              Ver todos
            </Link>
          )
        }
      >
        {carregando && transacoes.length === 0 ? (
          <div className="flex justify-center py-14">
            <span className="h-7 w-7 animate-spin rounded-full border-3 border-emerald-100 border-t-primaria" />
          </div>
        ) : transacoes.length === 0 ? (
          <div className="flex flex-col items-center px-5 py-14 text-center">
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-texto-suave">
              <IconeLista className="h-6 w-6" />
            </span>
            <p className="mt-4 font-medium">Nenhum lançamento neste mês</p>
            <p className="mt-1 max-w-xs text-sm text-texto-suave">Toque no botão + para registrar uma receita ou despesa.</p>
          </div>
        ) : (
          <div className={recarregando}>
            <ListaLancamentos
              transacoes={transacoes.slice(0, QUANTOS_ULTIMOS)}
              categorias={categorias}
              cartoes={cartoes}
              aoEscolher={editarLancamento}
            />
          </div>
        )}
      </Card>
    </>
  )
}

/** Seta vermelha se o gasto subiu, verde se caiu, comparando com o mês anterior */
function Variacao({ atual, anterior, nomeMesAnterior }: { atual: number; anterior: number; nomeMesAnterior: string }) {
  const variacao = variacaoPercentual(atual, anterior)
  if (variacao === null) return <span>sem gasto em {nomeMesAnterior}</span>

  const valorAnterior = `${formatarMoeda(anterior)} em ${nomeMesAnterior}`
  if (variacao === 0) return <span>igual · {valorAnterior}</span>

  const subiu = variacao > 0
  return (
    <span className="flex items-center gap-1">
      <span className={`flex items-center gap-0.5 font-semibold ${subiu ? 'text-despesa' : 'text-receita'}`}>
        {subiu ? <IconeSetaCima className="h-3.5 w-3.5" /> : <IconeSetaBaixo className="h-3.5 w-3.5" />}
        {subiu ? '+' : '−'}
        {Math.abs(variacao)}%
      </span>
      <span>· {valorAnterior}</span>
    </span>
  )
}

type CartaoResumoProps = {
  titulo: string
  valor: number
  cor: string
  fundo: string
  icone: ReactNode
  detalhe?: string
}

function CartaoResumo({ titulo, valor, cor, fundo, icone, detalhe }: CartaoResumoProps) {
  return (
    <div className="rounded-2xl border border-borda bg-white p-5">
      <div className="flex items-center gap-2">
        <span className={`flex h-7 w-7 items-center justify-center rounded-lg ${fundo} ${cor}`}>{icone}</span>
        <p className="text-sm text-texto-suave">{titulo}</p>
      </div>
      <p className={`mt-2 text-2xl font-bold tracking-tight ${cor}`}>{formatarMoeda(valor)}</p>
      {detalhe && <p className="mt-1 text-xs text-texto-suave">{detalhe}</p>}
    </div>
  )
}
