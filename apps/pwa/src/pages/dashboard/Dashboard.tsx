import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router'
import Alerta from '../../components/Alerta'
import Card from '../../components/Card'
import Esqueleto, { EsqueletoLista } from '../../components/Esqueleto'
import LinkAcao from '../../components/LinkAcao'
import GraficoGastosDiarios from '../../components/GraficoGastosDiarios'
import IconeCategoria, { COR_SEM_CATEGORIA } from '../../components/IconeCategoria'
import ListaLancamentos from '../../components/ListaLancamentos'
import ModalReceitasPrevistas from '../../components/ModalReceitasPrevistas'
import SeletorMes from '../../components/SeletorMes'
import Sincronizar from '../../components/Sincronizar'
import { IconeCartao, IconeChevronBaixo, IconeEmpresa, IconeInfo, IconeLista } from '../../components/icones'
import { useAuth } from '../../hooks/useAuth'
import { useLancamentos } from '../../hooks/useLancamentos'
import { acertosPorPessoa, frasesDoSaldo, type AcertoPessoa } from '../../lib/acertos'
import { cobrancasPlanejadasDoMes, cobrancasPrevistasDoMes } from '../../lib/assinaturas'
import {
  deISO,
  diasNoMes,
  hojeISO,
  inicioDoMes,
  intervaloDoMes,
  mesAnterior,
  paraISO,
  paraMesISO,
  somarMeses,
} from '../../lib/datas'
import { EMPRESA, separarDaEmpresa } from '../../lib/empresa'
import { datasDaFatura, mesDaFatura } from '../../lib/fatura'
import { formatarMoeda, formatarNomeDoMes } from '../../lib/formatar'
import {
  gastoEmCentavos,
  gastosAcumuladosPorDia,
  gastosPorCategoria,
  receitaEmCentavos,
  variacaoPercentual,
} from '../../lib/resumos'
import { datasDasCobrancas, listarAssinaturas } from '../../services/assinaturas'
import { listarAcertosPagos } from '../../services/acertos'
import { listarCartoes } from '../../services/cartoes'
import { listarCategorias } from '../../services/categorias'
import { listarContas } from '../../services/contas'
import { buscarPerfil } from '../../services/perfis'
import { listarReceitasPrevistas } from '../../services/receitasPrevistas'
import {
  buscarSaldoAtual,
  buscarSaldoEm,
  listarComprasDaFaturaDoMes,
  listarPagamentosDasFaturasDoMes,
  listarLancamentosDeTerceiros,
  listarTransacoesDoMes,
  totaisDasFaturas,
} from '../../services/transacoes'
import type { Assinatura, Cartao, Categoria, Conta, ReceitaPrevista, Transacao } from '../../types/financas'

const QUANTAS_CATEGORIAS = 5
const QUANTOS_ULTIMOS = 5

/** Aba "Início" (a rota continua /dashboard) */
export default function Dashboard() {
  const { usuario } = useAuth()
  const { versao, editarLancamento } = useLancamentos()
  const [nome, setNome] = useState('')
  const [mes, setMes] = useState(() => inicioDoMes())

  // Todos os lançamentos (pessoais e da empresa); o resumo pessoal usa só os pessoais
  const [todasDoMes, setTodasDoMes] = useState<Transacao[]>([])
  const [todasAnteriores, setTodasAnteriores] = useState<Transacao[]>([])
  const [todasDaFatura, setTodasDaFatura] = useState<Transacao[]>([])
  const [categorias, setCategorias] = useState<Categoria[]>([])
  const [cartoes, setCartoes] = useState<Cartao[]>([])
  const [contas, setContas] = useState<Conta[]>([])
  const [saldo, setSaldo] = useState<number | null>(null)
  const [saldoEmpresa, setSaldoEmpresa] = useState<number | null>(null)
  // Mês que já terminou: quanto tinha nas contas no último dia dele
  const mesPassado = mes < inicioDoMes()
  const mesFuturo = mes > inicioDoMes()
  const [saldoNoFim, setSaldoNoFim] = useState<number | null>(null)
  // Quanto tinha nas contas pessoais no último dia do mês anterior (ponto de partida do resultado)
  const [saldoNoInicio, setSaldoNoInicio] = useState<number | null>(null)
  const [pagamentosDaFatura, setPagamentosDaFatura] = useState<Transacao[]>([])
  const [saldoEmpresaNoFim, setSaldoEmpresaNoFim] = useState<number | null>(null)
  const [acertos, setAcertos] = useState<AcertoPessoa[]>([])
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState('')
  const [verTodas, setVerTodas] = useState(false)
  const [previstas, setPrevistas] = useState<ReceitaPrevista[]>([])
  const [editandoPrevistas, setEditandoPrevistas] = useState(false)
  const [recarregar, setRecarregar] = useState(0)
  const [assinaturas, setAssinaturas] = useState<Assinatura[]>([])
  const [datasCobrancas, setDatasCobrancas] = useState<Map<string, string[]>>(new Map())
  // Total (minha parte) de cada fatura recente, por cartão pessoal: pinta o dia do fechamento no mapa
  const [faturasPorCartao, setFaturasPorCartao] = useState<Map<string, Map<string, number>>>(new Map())

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
      mesPassado ? buscarSaldoEm(intervaloDoMes(mes)[1]) : Promise.resolve(null),
      listarLancamentosDeTerceiros(),
      listarContas(),
      buscarSaldoEm(hojeISO(), true),
      mesPassado ? buscarSaldoEm(intervaloDoMes(mes)[1], true) : Promise.resolve(null),
      listarComprasDaFaturaDoMes(mes),
      buscarSaldoEm(intervaloDoMes(mesAnterior(mes))[1]),
      listarPagamentosDasFaturasDoMes(mes),
      listarReceitasPrevistas(),
      listarAssinaturas(),
      datasDasCobrancas(),
      listarAcertosPagos(),
    ])
      .then(
        ([
          doMes,
          doAnterior,
          cats,
          crts,
          s,
          noFim,
          deTerceiros,
          cts,
          sEmpresa,
          empresaNoFim,
          daFatura,
          noInicio,
          pagos,
          prev,
          ass,
          cont,
          acertosPagos,
        ]) => {
          if (!ativo) return
          setPrevistas(prev)
          setAssinaturas(ass)
          setDatasCobrancas(cont)
          setAcertos(acertosPorPessoa(deTerceiros, crts, acertosPagos))
          setTodasDoMes(doMes)
          setTodasAnteriores(doAnterior)
          setTodasDaFatura(daFatura)
          setSaldoNoInicio(noInicio)
          setPagamentosDaFatura(pagos)
          setCategorias(cats)
          setCartoes(crts)
          setContas(cts)
          setSaldo(s)
          setSaldoNoFim(noFim)
          setSaldoEmpresa(sEmpresa)
          setSaldoEmpresaNoFim(empresaNoFim)
          setErro('')
        },
      )
      .catch(() => ativo && setErro('Não foi possível carregar seus lançamentos.'))
      .finally(() => ativo && setCarregando(false))
    return () => {
      ativo = false
    }
  }, [mes, mesPassado, versao, recarregar])

  useEffect(() => {
    const pessoais = cartoes.filter((c) => !c.empresarial)
    if (pessoais.length === 0) return
    let ativo = true
    Promise.all(pessoais.map((c) => totaisDasFaturas(c.id, somarMeses(mes, -6), somarMeses(mes, 2), true)))
      .then((lista) => ativo && setFaturasPorCartao(new Map(pessoais.map((c, i) => [c.id, lista[i]]))))
      .catch(() => {}) // sem isso o mapa só não mostra o fechamento
    return () => {
      ativo = false
    }
  }, [cartoes, mes, versao])

  const { pessoais: transacoes, daEmpresa } = useMemo(
    () => separarDaEmpresa(todasDoMes, contas, cartoes),
    [todasDoMes, contas, cartoes],
  )
  const anteriores = useMemo(
    () => separarDaEmpresa(todasAnteriores, contas, cartoes).pessoais,
    [todasAnteriores, contas, cartoes],
  )
  const fatura = useMemo(() => separarDaEmpresa(todasDaFatura, contas, cartoes), [todasDaFatura, contas, cartoes])
  const totaisEmpresa = useMemo(() => somarMes(daEmpresa, fatura.daEmpresa), [daEmpresa, fatura])
  const contasDaEmpresa = [...contas.filter((c) => c.empresarial), ...cartoes.filter((c) => c.empresarial)]
  const temEmpresa = contasDaEmpresa.length > 0
  const nomesPessoais = [...new Set(contas.filter((c) => !c.empresarial).map((c) => c.nome.split(' ')[0]))].join(', ')

  // Lançamento com data depois de hoje (ex.: parcela que o banco já mandou) ainda não aconteceu: entra como previsto,
  // igual às assinaturas, e não como gasto confirmado
  const hoje = hojeISO()
  const confirmadas = useMemo(() => transacoes.filter((t) => t.data <= hoje), [transacoes, hoje])
  const futuras = useMemo(() => transacoes.filter((t) => t.data > hoje && gastoEmCentavos(t) > 0), [transacoes, hoje])
  const anterioresConfirmadas = useMemo(() => anteriores.filter((t) => t.data <= hoje), [anteriores, hoje])
  const pontosFeitos = useMemo(
    () => gastosAcumuladosPorDia(confirmadas, anterioresConfirmadas, mes),
    [confirmadas, anterioresConfirmadas, mes],
  )
  const gastosFeitos = useMemo(() => gastosPorCategoria(confirmadas, anterioresConfirmadas), [confirmadas, anterioresConfirmadas])
  const categoriaPorId = useMemo(() => new Map(categorias.map((c) => [c.id, c])), [categorias])

  const nomeMes = formatarNomeDoMes(mes)
  const nomeMesAnterior = formatarNomeDoMes(mesAnterior(mes))
  const linkDoMes = `/lancamentos?mes=${paraMesISO(mes)}`
  const primeiroNome = nome.split(' ')[0]
  // Na primeira carga mostra o esqueleto; nas seguintes mantém o conteúdo meio apagado
  const primeiraCarga = carregando && saldo === null
  const recarregando = carregando ? 'opacity-60 transition' : 'transition'

  // Resultado = quanto as contas pessoais mudaram no mês. No mês atual e nos que vêm, também o que ainda vai mexer no
  // saldo: sai o que falta pagar da fatura que vence nele (inteira, é o que sai da conta) e as assinaturas; entra o que
  // outras pessoas ainda vão mandar pela parte delas nessa fatura e as receitas previstas. Depois de pago/recebido, já
  // está no saldo (não conta duas vezes). Mês que já passou é só a variação do saldo.
  const faturaAPagar = useMemo(
    () => (mesPassado ? 0 : faltaPagarDasFaturas(todasDaFatura, pagamentosDaFatura, cartoes)),
    [mesPassado, todasDaFatura, pagamentosDaFatura, cartoes],
  )
  const aReceber = useMemo(
    () => (mesPassado ? [] : aReceberDasFaturas(todasDaFatura, [...anteriores, ...transacoes], cartoes, mes)),
    [mesPassado, todasDaFatura, anteriores, transacoes, cartoes, mes],
  )
  const totalAReceber = aReceber.reduce((soma, r) => soma + r.centavos, 0) / 100
  const recebidas = useMemo(() => previstasRecebidas(previstas, transacoes), [previstas, transacoes])
  // Carro, conta de celular... e as de cartão que caem na fatura deste mês: pesam até serem pagas
  const cobrancas = useMemo(() => new Map([...datasCobrancas].map(([id, datas]) => [id, datas.length])), [datasCobrancas])
  const assinaturasAPagar = useMemo(
    () => (mesPassado ? [] : cobrancasPrevistasDoMes(assinaturas, cobrancas, cartoes, mes)),
    [mesPassado, assinaturas, cobrancas, cartoes, mes],
  )
  const totalAssinaturasAPagar = assinaturasAPagar.reduce((soma, c) => soma + Math.round(c.assinatura.valor * 100), 0) / 100
  // Mês que já passou fica com o que aconteceu de verdade
  const previsto = mesPassado
    ? 0
    : previstas.reduce((soma, p) => (recebidas.has(p.id) ? soma : soma + Math.round(p.valor * 100)), 0) / 100
  const saldoDoMes = mesPassado ? saldoNoFim : saldo
  // Lançamentos com data depois de hoje (Pix agendado, gasto que já sei que vou ter...): o saldo só conta até hoje,
  // então entram aqui; no crédito já estão na fatura
  const agendados = useMemo(
    () =>
      mesPassado
        ? 0
        : transacoes.reduce(
            (soma, t) =>
              t.data > hoje && t.forma !== 'credito' ? soma + Math.round(t.valor * 100) * (t.tipo === 'receita' ? 1 : -1) : soma,
            0,
          ) / 100,
    [mesPassado, transacoes, hoje],
  )
  const resultado =
    saldoDoMes !== null && saldoNoInicio !== null
      ? saldoDoMes - saldoNoInicio + agendados - faturaAPagar + totalAReceber - totalAssinaturasAPagar + previsto
      : 0
  // Entrou e saiu: só o meu dinheiro. O de outras pessoas (o que mandaram, o que paguei por elas, a parte delas na
  // fatura e o que ainda vão mandar) fica de fora dos dois; aparece no mapa e nos Acertos.
  // Entrou: minhas receitas, o que veio da conta da empresa e o previsto que ainda vai chegar.
  // Saiu: o resto da conta, para que entrou − saiu dê o resultado sem o dinheiro de outras pessoas.
  // Quando o mês fecha, o que sobrou de outras pessoas comigo virou meu (e o que faltou, perdi): entra na conta e
  // entrou − saiu volta a dar o resultado.
  const delesNaFatura = useMemo(() => parteDeOutrosNasFaturas(todasDaFatura, cartoes), [todasDaFatura, cartoes])
  const dinheiroDeOutros = useMemo(() => {
    let centavos = Math.round((totalAReceber - delesNaFatura) * 100)
    for (const t of transacoes)
      if (t.terceiro && t.forma !== 'credito' && !t.transferencia_interna)
        centavos += Math.round(t.valor * 100) * (t.tipo === 'receita' ? 1 : -1)
    return centavos / 100
  }, [transacoes, totalAReceber, delesNaFatura])
  // Empréstimo não vira meu quando o mês fecha: continua sendo de outra pessoa até ser devolvido
  const deEmprestimos = useMemo(
    () =>
      transacoes.reduce(
        (soma, t) =>
          t.terceiro && t.emprestimo && t.forma !== 'credito' && !t.transferencia_interna
            ? soma + Math.round(t.valor * 100) * (t.tipo === 'receita' ? 1 : -1)
            : soma,
        0,
      ) / 100,
    [transacoes],
  )
  const entrou = useMemo(() => {
    let minhas = Math.round(previsto * 100)
    let daEmpresa = 0
    for (const t of transacoes) {
      if (t.forma === 'credito' || t.terceiro || (t.tipo !== 'receita' && !t.transferencia_interna)) continue
      if (t.transferencia_interna) daEmpresa += Math.round(t.valor * 100) * (t.tipo === 'receita' ? 1 : -1)
      else minhas += Math.round(t.valor * 100)
    }
    const sobrouDeOutros = mesPassado ? Math.max(Math.round((dinheiroDeOutros - deEmprestimos) * 100), 0) : 0
    return (minhas + Math.max(daEmpresa, 0) + sobrouDeOutros) / 100
  }, [transacoes, previsto, mesPassado, dinheiroDeOutros, deEmprestimos])
  const saiu = entrou - (mesPassado ? resultado - deEmprestimos : resultado - dinheiroDeOutros)
  // Minha parte do que falta pagar da fatura (o pagamento abate primeiro a parte de outras pessoas)
  const minhaFaturaAPagar = Math.min(faturaAPagar, Math.max(somaDaFatura(todasDaFatura, cartoes) - delesNaFatura, 0))
  // Cobranças de assinatura que ainda vão acontecer neste mês aparecem no calendário como previstas
  const cobrancasNoCalendario = useMemo(
    () => (mesPassado ? [] : cobrancasPrevistasDoMes(assinaturas, cobrancas, cartoes, mes, { porData: true })),
    [mesPassado, assinaturas, cobrancas, cartoes, mes],
  )
  // "Para onde foi/vai" também mostra o que ainda vai acontecer neste mês, pela data do gasto (como os confirmados):
  // assinaturas que ainda vão ser cobradas e lançamentos com data futura
  const porCategoria = useMemo(() => {
    const previstoPorCategoria = new Map<string, number>()
    const somarPrevisto = (chave: string, centavos: number) =>
      previstoPorCategoria.set(chave, (previstoPorCategoria.get(chave) ?? 0) + centavos)
    if (mesFuturo) {
      // Mês que vem: o que vai sair da conta nele, igual ao "Vai sair". O cartão entra pela fatura que vence no mês
      // (só a minha parte); assinaturas de cartão ainda não cobradas que caem nela; o resto, no dia
      for (const t of fatura.pessoais) somarPrevisto(t.categoria_id ?? 'sem', gastoEmCentavos(t))
      for (const c of assinaturasAPagar)
        if (c.assinatura.cartao_id) somarPrevisto(c.assinatura.categoria_id ?? 'sem', Math.round(c.assinatura.valor * 100))
      for (const c of cobrancasNoCalendario)
        if (!c.assinatura.cartao_id) somarPrevisto(c.assinatura.categoria_id ?? 'sem', Math.round(c.assinatura.valor * 100))
      for (const t of futuras) if (!t.cartao_id) somarPrevisto(t.categoria_id ?? 'sem', gastoEmCentavos(t))
      for (const [chave, centavos] of previstoPorCategoria) if (centavos <= 0) previstoPorCategoria.delete(chave)
    } else {
      for (const c of cobrancasNoCalendario)
        somarPrevisto(c.assinatura.categoria_id ?? 'sem', Math.round(c.assinatura.valor * 100))
      for (const t of futuras) somarPrevisto(t.categoria_id ?? 'sem', gastoEmCentavos(t))
    }
    const lista = gastosFeitos.map((g) => {
      const previsto = previstoPorCategoria.get(g.chave) ?? 0
      previstoPorCategoria.delete(g.chave)
      return { ...g, atual: (Math.round(g.atual * 100) + previsto) / 100, previsto: previsto / 100 }
    })
    for (const [chave, previsto] of previstoPorCategoria)
      lista.push({ chave, atual: previsto / 100, anterior: 0, previsto: previsto / 100 })
    return lista.sort((a, b) => b.atual - a.atual)
  }, [gastosFeitos, cobrancasNoCalendario, futuras, mesFuturo, fatura, assinaturasAPagar])
  const totalPrevistoNasCategorias = porCategoria.reduce((soma, g) => soma + Math.round(g.previsto * 100), 0) / 100
  // Gráfico: verde = confirmado (num mês que não começou não há nada); previsto = o que estava previsto sair do meu
  // dinheiro no mês, igual ao "Vai sair" (o de outras pessoas fica de fora). O cartão entra inteiro no dia em que vence
  // a fatura (só a minha parte): o que já está nela mais as assinaturas de cartão que ainda vão cair nela. O resto entra
  // no dia: assinaturas de conta (Carro, Claro...), parcelas e lançamentos com data futura.
  const planejadas = useMemo(
    () =>
      cobrancasPlanejadasDoMes(assinaturas, datasCobrancas, cartoes, mes)
        .filter((c) => !c.assinatura.cartao_id)
        .map((c) => ({ dia: c.data.getDate(), centavos: Math.round(c.assinatura.valor * 100) })),
    [assinaturas, datasCobrancas, cartoes, mes],
  )
  const pontos = useMemo(() => {
    const base = pontosFeitos.map((p) => ({ ...p, atual: mesFuturo ? null : p.atual }))
    const porDia = new Map<number, number>()
    const somar = (dia: number, centavos: number) => centavos > 0 && porDia.set(dia, (porDia.get(dia) ?? 0) + centavos)
    for (const c of planejadas) somar(c.dia, c.centavos)
    for (const t of transacoes)
      if (!t.cartao_id && !t.assinatura_id && (t.data > hoje || (t.parcela_atual ?? 0) > 1))
        somar(Number(t.data.slice(8, 10)), gastoEmCentavos(t))
    const cartaoPorId = new Map(cartoes.filter((c) => !c.empresarial).map((c) => [c.id, c]))
    const vencimentoDo = (cartao: Cartao) => datasDaFatura(mes, cartao.dia_fechamento, cartao.dia_vencimento).vencimento.getDate()
    const daFatura = new Map<string, number>()
    for (const t of fatura.pessoais)
      if (t.cartao_id && cartaoPorId.has(t.cartao_id))
        daFatura.set(t.cartao_id, (daFatura.get(t.cartao_id) ?? 0) + gastoEmCentavos(t))
    for (const c of assinaturasAPagar)
      if (c.assinatura.cartao_id && cartaoPorId.has(c.assinatura.cartao_id))
        daFatura.set(c.assinatura.cartao_id, (daFatura.get(c.assinatura.cartao_id) ?? 0) + Math.round(c.assinatura.valor * 100))
    for (const [id, centavos] of daFatura) somar(vencimentoDo(cartaoPorId.get(id)!), centavos)
    if (porDia.size === 0) return base
    let soma = 0
    return base.map((p) => {
      soma += porDia.get(p.dia) ?? 0
      return { ...p, previsto: soma / 100 }
    })
  }, [pontosFeitos, mesFuturo, planejadas, transacoes, fatura, assinaturasAPagar, cartoes, mes, hoje])
  const semGastos = pontos.every((p) => !p.atual && !p.anterior && !p.previsto)

  // No mapa, o que é de cartão aparece no dia em que vence a fatura em que cai (é quando o dinheiro sai):
  // a assinatura de 21/10 aparece no vencimento de novembro; a de 21/11, no de dezembro. Conta e Pix ficam no dia.
  const previstosNoMapa = useMemo(() => {
    if (mesPassado) return []
    const lista: { data: Date; centavos: number; nome: string }[] = []
    const cartaoPorId = new Map(cartoes.filter((c) => !c.empresarial).map((c) => [c.id, c]))
    const vencimentoDo = (cartao: Cartao) => datasDaFatura(mes, cartao.dia_fechamento, cartao.dia_vencimento).vencimento
    for (const c of cobrancasNoCalendario)
      if (!c.assinatura.cartao_id)
        lista.push({ data: c.data, centavos: Math.round(c.assinatura.valor * 100), nome: c.assinatura.nome })
    // De cartão: as que ainda vão ser cobradas nesta fatura e as que já foram
    for (const c of assinaturasAPagar) {
      const cartao = c.assinatura.cartao_id ? cartaoPorId.get(c.assinatura.cartao_id) : undefined
      if (cartao)
        lista.push({ data: vencimentoDo(cartao), centavos: Math.round(c.assinatura.valor * 100), nome: c.assinatura.nome })
    }
    for (const a of assinaturas) {
      const cartao = a.cartao_id ? cartaoPorId.get(a.cartao_id) : undefined
      if (!cartao) continue
      for (const d of datasCobrancas.get(a.id) ?? [])
        if (mesDaFatura(deISO(d), cartao.dia_fechamento, cartao.dia_vencimento).getTime() === mes.getTime())
          lista.push({ data: vencimentoDo(cartao), centavos: Math.round(a.valor * 100), nome: a.nome })
    }
    // Lançamentos com data futura: os de cartão desta fatura no vencimento, os outros no dia deles
    for (const t of fatura.pessoais) {
      const cartao = t.cartao_id ? cartaoPorId.get(t.cartao_id) : undefined
      if (cartao && t.data > hoje && !t.assinatura_id && gastoEmCentavos(t) > 0)
        lista.push({ data: vencimentoDo(cartao), centavos: gastoEmCentavos(t), nome: t.local ?? t.descricao ?? 'Lançamento' })
    }
    for (const t of futuras)
      if (!t.cartao_id)
        lista.push({ data: deISO(t.data), centavos: gastoEmCentavos(t), nome: t.local ?? t.descricao ?? 'Lançamento' })
    // O que vence num dia que já passou já saiu (ou está atrasado na fatura): não é mais previsto
    const inicioDeHoje = deISO(hoje)
    return lista.filter((p) => p.data >= inicioDeHoje && p.data.getMonth() === mes.getMonth())
  }, [mesPassado, cartoes, mes, cobrancasNoCalendario, assinaturasAPagar, assinaturas, datasCobrancas, fatura, futuras, hoje])

  const diasDoMes = useMemo(() => {
    const dias = gastoPorDia(confirmadas, mes)
    const marcarPrevisto = (dia: number, centavos: number, nome: string) => {
      const d = dias[dia - 1]
      if (!d) return
      d.previsto += centavos
      if (!d.previstas.includes(nome)) d.previstas.push(nome)
    }
    for (const p of previstosNoMapa) marcarPrevisto(p.data.getDate(), p.centavos, p.nome)
    // A parte de outras pessoas na fatura: esperada até a véspera do vencimento; se já passou e não veio, fica em hoje
    const hojeData = deISO(hoje)
    const mesDeHoje = hojeData.getFullYear() === mes.getFullYear() && hojeData.getMonth() === mes.getMonth()
    for (const r of aReceber) {
      const d = dias[(mesDeHoje ? Math.max(r.dia, hojeData.getDate()) : r.dia) - 1]
      if (!d) continue
      d.aReceber += r.centavos
      if (!d.aReceberDe.includes(r.pessoa)) d.aReceberDe.push(r.pessoa)
    }
    return dias
  }, [confirmadas, mes, previstosNoMapa, aReceber, hoje])
  // Dia em que cada cartão pessoal fecha a fatura neste mês; quanto maior a fatura (perto das maiores recentes), mais vermelho
  const fechamentos = useMemo<Fechamento[]>(
    () =>
      cartoes
        .filter((c) => !c.empresarial)
        .flatMap((c) => {
          const totais = faturasPorCartao.get(c.id)
          if (!totais) return []
          const dia = Math.min(c.dia_fechamento, diasNoMes(mes))
          // A que fecha neste dia é a das compras até a véspera
          const fatura = paraISO(
            mesDaFatura(new Date(mes.getFullYear(), mes.getMonth(), dia - 1), c.dia_fechamento, c.dia_vencimento),
          )
          const centavos = Math.max(totais.get(fatura) ?? 0, 0)
          const maior = Math.max(...totais.values(), centavos, 1)
          return [{ dia, cartao: c.nome, centavos, forca: centavos > 0 ? 0.16 + 0.84 * Math.sqrt(centavos / maior) : 0 }]
        }),
    [cartoes, faturasPorCartao, mes],
  )
  const totalCategorias = porCategoria.reduce((s, g) => s + g.atual, 0)
  // Cada pedaço da barra é uma categoria de verdade; a lista mostra as maiores e abre o resto
  const listadas = verTodas ? porCategoria : porCategoria.slice(0, QUANTAS_CATEGORIAS)
  const escondidas = porCategoria.length - listadas.length
  const hojeEscrito = new Intl.DateTimeFormat('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date())

  return (
    <>
      {/* Topo: data de hoje, sincronização e o mês */}
      {/* No celular: data e sincronização na mesma linha, o mês embaixo */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-3">
        <div className="flex w-full min-w-0 items-center justify-between gap-2 sm:w-auto sm:flex-1">
          <p className="shrink-0 text-xs text-texto-suave first-letter:uppercase sm:text-sm">{hojeEscrito}</p>
          <div className="flex min-w-0 justify-end">
            <Sincronizar compacto />
          </div>
        </div>
        <SeletorMes mes={mes} aoMudar={setMes} />
      </div>

      {erro && (
        <div className="mt-4">
          <Alerta>{erro}</Alerta>
        </div>
      )}

      <div className={`mt-5 grid grid-cols-1 gap-4 lg:grid-cols-12 *:min-w-0 ${recarregando}`}>
        {/* Saudação + resultado do mês + gasto de cada dia */}
        <section className="vidro animate-surgir rounded-[28px] p-6 lg:col-span-7">
          <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
            <div>
              <h1 className="text-4xl font-semibold sm:text-5xl">
                Olá
                {primeiroNome && (
                  <>
                    , <span className="text-destaque">{primeiroNome}</span>
                  </>
                )}
              </h1>
              <p className="mt-1.5 text-texto-suave">
                Seu <span className="text-texto">{nomeMes}</span> em um olhar.
              </p>
            </div>
            <div className="relative sm:text-right">
              <div className="flex items-center gap-1 sm:justify-end">
                <p className="text-xs text-texto-suave">Resultado do mês</p>
                {!primeiraCarga && (
                  <ContaDoResultado
                    linhas={[
                      { rotulo: `Saldo no fim de ${nomeMesAnterior}`, valor: saldoNoInicio ?? 0 },
                      { rotulo: mesPassado ? `Saldo no fim de ${nomeMes}` : 'Saldo agora', valor: saldoDoMes ?? 0 },
                      { rotulo: 'Variação do saldo', valor: (saldoDoMes ?? 0) - (saldoNoInicio ?? 0), sinal: true },
                      ...(agendados !== 0 ? [{ rotulo: 'Lançamentos com data futura', valor: agendados, sinal: true }] : []),
                      ...(faturaAPagar > 0 ? [{ rotulo: 'Fatura a pagar', valor: -faturaAPagar, sinal: true }] : []),
                      ...(totalAReceber > 0
                        ? [
                            {
                              rotulo: 'A receber de outras pessoas',
                              valor: totalAReceber,
                              sinal: true,
                              detalhe: aReceber.map((r) => r.pessoa).join(', ') + ' · parte delas na fatura',
                            },
                          ]
                        : []),
                      ...(totalAssinaturasAPagar > 0
                        ? [
                            {
                              rotulo: 'Assinaturas a pagar',
                              valor: -totalAssinaturasAPagar,
                              sinal: true,
                              detalhe: assinaturasAPagar.map((c) => c.assinatura.nome).join(', '),
                            },
                          ]
                        : []),
                      ...(previsto > 0 ? [{ rotulo: 'Receitas previstas', valor: previsto, sinal: true }] : []),
                    ]}
                    resultado={resultado}
                    aoEditarPrevistas={mesPassado ? undefined : () => setEditandoPrevistas(true)}
                  />
                )}
              </div>
              {primeiraCarga ? (
                <Esqueleto className="mt-2 h-9 w-36" />
              ) : (
                <p className={`cifra mt-1 text-3xl font-semibold sm:text-4xl ${resultado < 0 ? 'text-despesa' : 'text-texto'}`}>
                  {resultado > 0 ? '+' : ''}
                  {formatarMoeda(resultado)}
                </p>
              )}
            </div>
          </div>
          <MapaDoMes dias={diasDoMes} mes={mes} carregando={primeiraCarga} fechamentos={fechamentos} />
        </section>

        {/* Protagonista: saldo pessoal (limão agora, lilás num mês que passou, azul numa previsão de mês que vem) */}
        <section
          className={`animate-surgir relative flex flex-col overflow-hidden rounded-[28px] p-6 text-white lg:col-span-5 ${mesPassado ? 'destaque destaque-violeta' : mesFuturo ? 'destaque destaque-azul' : 'destaque destaque-ouro'}`}

        >
          <div
            className="pointer-events-none absolute -top-24 -right-16 h-64 w-64 rounded-full bg-primaria/10 blur-3xl"
            aria-hidden="true"
          />
          <div className="relative flex items-center justify-between gap-3">
            <p className="text-sm font-medium opacity-75">
              {mesPassado
                ? `Saldo no fim de ${nomeMes}`
                : mesFuturo
                  ? `Saldo previsto no fim de ${nomeMes}`
                  : temEmpresa
                    ? 'Saldo pessoal'
                    : 'Saldo atual'}
            </p>
            <span className="rounded-full bg-black/10 px-2.5 py-1 text-[11px] font-semibold">
              {mesPassado ? 'Fechado' : mesFuturo ? 'Previsão' : '● Agora'}
            </span>
          </div>
          {primeiraCarga || (mesPassado && saldoNoFim === null) ? (
            <Esqueleto className="relative mt-4 h-14 w-56 bg-black/10" />
          ) : (
            <p className="cifra relative mt-3 text-5xl font-semibold sm:text-6xl">
              {formatarMoeda((mesPassado ? saldoNoFim : mesFuturo ? (saldoNoInicio ?? 0) + resultado : saldo) ?? 0)}
            </p>
          )}
          <p className="relative mt-1 text-sm opacity-70">
            {(mesPassado || mesFuturo) && saldo !== null ? `Hoje: ${formatarMoeda(saldo)}` : nomesPessoais || 'Suas contas'}
          </p>

          {/* Entrou num bloco claro, saiu num escuro: dá para saber qual é qual sem ler o rótulo */}
          <div className="relative mt-6 grid grid-cols-2 gap-2 lg:mt-auto">
            <div className="rounded-2xl bg-white/10 p-3.5">
              <p className="flex items-center gap-1.5 text-xs font-medium opacity-75">
                <IconeSeta para="cima" />
                {mesFuturo ? 'Vai entrar' : 'Entrou'}
              </p>
              <p className="numero mt-1 text-lg font-semibold">+{formatarMoeda(entrou)}</p>
            </div>
            <div className="rounded-2xl bg-sobre-primaria p-3.5 text-white">
              <p className="flex items-center gap-1.5 text-xs font-medium text-white/70">
                <IconeSeta para="baixo" />
                {mesFuturo ? 'Vai sair' : 'Saiu'}
              </p>
              <p className="numero mt-1 text-lg font-semibold">−{formatarMoeda(saiu)}</p>
            </div>
          </div>
          <div className="relative mt-3">
            <div className="h-2 overflow-hidden rounded-full bg-black/10">
              <div
                className="h-full rounded-full bg-sobre-primaria transition-all duration-700"
                style={{
                  width: `${entrou > 0 ? Math.min(Math.max((saiu / entrou) * 100, 0), 100) : saiu > 0 ? 100 : 0}%`,
                }}
              />
            </div>
            <p className="mt-2 text-xs opacity-70">
              {mesFuturo ? (
                entrou > 0 ? (
                  `${Math.round((saiu / entrou) * 100)}% da receita prevista está comprometida`
                ) : (
                  'Nenhuma receita prevista neste mês'
                )
              ) : (
                <>
                  {entrou > 0 ? `Saiu ${Math.round((saiu / entrou) * 100)}% do que entrou` : 'Nada entrou ainda neste mês'}
                  {minhaFaturaAPagar + totalAssinaturasAPagar > 0 &&
                    ` · inclui ${formatarMoeda(minhaFaturaAPagar + totalAssinaturasAPagar)} ainda a pagar`}
                </>
              )}
            </p>
            {/* Salário, vale... o que costuma entrar: conta como entrada até chegar */}
            {!mesPassado && (
              <button
                type="button"
                onClick={() => setEditandoPrevistas(true)}
                className="mt-1 text-xs font-medium underline-offset-2 opacity-70 transition hover:underline hover:opacity-100"
              >
                {previsto > 0
                  ? `Previsto entrar ${formatarMoeda(previsto)}`
                  : previstas.length
                    ? 'Receitas previstas: todas já chegaram'
                    : 'Adicionar receitas previstas'}
              </button>
            )}
          </div>
        </section>

        {/* Gastos acumulados no mês */}
        <Card titulo="Gastos acumulados" className="lg:col-span-7">
          {primeiraCarga ? (
            <Esqueleto className="h-64" />
          ) : semGastos ? (
            <p className="py-16 text-center text-sm text-texto-suave">
              Nenhum gasto em {nomeMes} nem em {nomeMesAnterior}.
            </p>
          ) : (
            <GraficoGastosDiarios pontos={pontos} nomeMes={nomeMes} nomeMesAnterior={nomeMesAnterior} />
          )}
        </Card>

        {/* Para onde foi o dinheiro: barra dividida por categoria + legenda */}
        <Card
          titulo={mesFuturo ? 'Para onde vai' : 'Para onde foi'}
          className="lg:col-span-5"
          acao={<LinkAcao to={linkDoMes}>Lançamentos</LinkAcao>}
        >
          {primeiraCarga ? (
            <Esqueleto className="h-48" />
          ) : porCategoria.length === 0 ? (
            <p className="py-12 text-center text-sm text-texto-suave">Nenhum gasto neste mês.</p>
          ) : (
            <>
              <p className="cifra text-3xl font-semibold">{formatarMoeda(totalCategorias)}</p>
              {totalPrevistoNasCategorias > 0 && (
                <p className="mt-1 text-xs text-texto-suave">Inclui {formatarMoeda(totalPrevistoNasCategorias)} ainda previsto</p>
              )}
              <div className="mt-4 flex h-11 gap-1">
                {porCategoria.map((g) => {
                  const categoria = g.chave === 'sem' ? undefined : categoriaPorId.get(g.chave)
                  return (
                    <Link
                      key={g.chave}
                      to={`${linkDoMes}&categoria=${g.chave}`}
                      title={`${categoria?.nome ?? 'Sem categoria'}: ${formatarMoeda(g.atual)}`}
                      className="min-w-1.5 rounded-lg transition hover:brightness-125"
                      style={{
                        flexGrow: g.atual,
                        backgroundColor: categoria?.cor ?? COR_SEM_CATEGORIA,
                        opacity: g.previsto >= g.atual ? 0.5 : undefined,
                      }}
                    />
                  )
                })}
              </div>
              <ul className="mt-4 -mx-2 divide-y divide-borda">
                {listadas.map((g) => {
                  const categoria = g.chave === 'sem' ? undefined : categoriaPorId.get(g.chave)
                  const fatia = totalCategorias > 0 ? Math.round((g.atual / totalCategorias) * 100) : 0
                  return (
                    <li key={g.chave}>
                      <Link
                        to={`${linkDoMes}&categoria=${g.chave}`}
                        className="flex items-center gap-3 rounded-2xl px-2 py-2 text-sm transition hover:bg-texto/[0.05]"
                        title={variacaoTexto(g.atual, g.anterior, nomeMesAnterior)}
                      >
                        <IconeCategoria icone={categoria?.icone} cor={categoria?.cor} tamanho="pequeno" />
                        <span className="min-w-0 flex-1 truncate font-medium">
                          {categoria?.nome ?? 'Sem categoria'}
                          {g.previsto > 0 && (
                            <span className="ml-1.5 text-xs font-normal text-texto-suave">
                              {g.previsto >= g.atual ? 'previsto' : `inclui ${formatarMoeda(g.previsto)} previsto`}
                            </span>
                          )}
                        </span>
                        <span className="numero shrink-0">{formatarMoeda(g.atual)}</span>
                        <span className="numero w-10 shrink-0 text-right text-xs text-texto-suave">{fatia}%</span>
                      </Link>
                    </li>
                  )
                })}
              </ul>
              {porCategoria.length > QUANTAS_CATEGORIAS && (
                <button
                  type="button"
                  aria-expanded={verTodas}
                  onClick={() => setVerTodas((v) => !v)}
                  className="mt-2 flex h-10 w-full items-center justify-center gap-1.5 rounded-full bg-texto/[0.07] text-sm font-medium transition hover:bg-texto/[0.11]"
                >
                  {verTodas ? 'Mostrar menos' : `Mais ${escondidas} ${escondidas === 1 ? 'categoria' : 'categorias'}`}
                  <IconeChevronBaixo className={`h-4 w-4 transition ${verTodas ? 'rotate-180' : ''}`} />
                </button>
              )}
            </>
          )}
        </Card>

        {/* Coluna da empresa e dos acertos */}
        <div className="flex flex-col gap-4 lg:col-span-5">
          {temEmpresa && (
            <section
              aria-label={EMPRESA.nome}
              className="escuro animate-surgir relative overflow-hidden rounded-[28px] p-6"
              style={{
                backgroundImage: `radial-gradient(120% 90% at 0% 0%, ${EMPRESA.de}99, transparent 60%), radial-gradient(90% 90% at 100% 100%, ${EMPRESA.para}80, transparent 60%)`,
              }}
            >
              <div className="flex items-center justify-between gap-3">
                <h2 className="flex items-center gap-2.5 text-lg font-semibold">
                  <IconeEmpresa className="h-7 w-7 text-white" />
                  {EMPRESA.nome}
                </h2>
                <span className="truncate text-[11px] text-white/60">
                  {contasDaEmpresa.map((c) => c.nome.split(' ').slice(0, 2).join(' ')).join(' · ')}
                </span>
              </div>
              <p className="mt-4 text-xs text-white/70">{mesPassado ? `Saldo no fim de ${nomeMes}` : 'Saldo da empresa'}</p>
              {primeiraCarga ? (
                <Esqueleto className="mt-2 h-10 w-40 bg-white/20" />
              ) : (
                <p className="cifra mt-1 text-4xl font-semibold">
                  {formatarMoeda((mesPassado ? saldoEmpresaNoFim : saldoEmpresa) ?? 0)}
                </p>
              )}
              <dl className="mt-5 grid grid-cols-3 gap-2">
                {[
                  { titulo: 'Entrou', valor: totaisEmpresa.receitas },
                  { titulo: 'Saiu', valor: totaisEmpresa.despesas },
                  { titulo: 'Resultado', valor: totaisEmpresa.receitas - totaisEmpresa.despesas },
                ].map((v) => (
                  <div key={v.titulo} className="rounded-2xl bg-black/20 p-3 shadow-[inset_0_1px_0_rgb(255_255_255/0.08)]">
                    <dt className="text-[11px] text-white/65">{v.titulo}</dt>
                    <dd className="numero mt-1 truncate text-sm font-semibold">{formatarMoeda(v.valor)}</dd>
                  </div>
                ))}
              </dl>
            </section>
          )}

          {acertos.length > 0 && (
            <Card titulo="Acertos" semEspaco acao={<LinkAcao to="/acertos">Ver tudo</LinkAcao>}>
              <ul className="px-2">
                {acertos.map((a) => {
                  const frase = frasesDoSaldo(a)
                  return (
                    <li key={a.pessoa}>
                      <Link
                        to={`/acertos?pessoa=${encodeURIComponent(a.pessoa)}`}
                        className="flex items-center gap-3 rounded-2xl px-3 py-2.5 transition hover:bg-texto/[0.05]"
                      >
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[14px] bg-lilas/15 font-display font-semibold text-lilas">
                          {a.pessoa.charAt(0)}
                        </span>
                        <span className="min-w-0 flex-1 truncate text-sm">{frase.titulo}</span>
                        <span className={`numero shrink-0 text-sm font-medium ${frase.cor}`}>
                          {formatarMoeda(Math.abs(a.saldoCentavos) / 100)}
                        </span>
                      </Link>
                    </li>
                  )
                })}
              </ul>
            </Card>
          )}
        </div>

        {/* Últimos lançamentos */}
        <Card
          titulo="Últimos lançamentos"

          className={temEmpresa || acertos.length > 0 ? 'lg:col-span-7' : 'lg:col-span-12'}
          semEspaco
          acao={transacoes.length > 0 && <LinkAcao to={linkDoMes}>Ver todos</LinkAcao>}
        >
          {primeiraCarga ? (
            <EsqueletoLista linhas={QUANTOS_ULTIMOS} />
          ) : transacoes.length === 0 ? (
            <div className="flex flex-col items-center px-5 py-14 text-center">
              <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-texto/[0.06] text-texto-suave">
                <IconeLista className="h-6 w-6" />
              </span>
              <p className="mt-4 font-medium">Nenhum lançamento neste mês</p>
              <p className="mt-1 max-w-xs text-sm text-texto-suave">Use o botão + para registrar uma receita ou despesa.</p>
            </div>
          ) : (
            <ListaLancamentos
              transacoes={transacoes.slice(0, QUANTOS_ULTIMOS)}
              categorias={categorias}
              cartoes={cartoes}
              aoEscolher={editarLancamento}
            />
          )}
        </Card>
      </div>

      {editandoPrevistas && (
        <ModalReceitasPrevistas
          previstas={previstas}
          recebidas={recebidas}
          aoFechar={() => setEditandoPrevistas(false)}
          aoSalvar={() => setRecarregar((n) => n + 1)}
        />
      )}
    </>
  )
}

type LinhaDaConta = { rotulo: string; valor: number; sinal?: boolean; detalhe?: string }

/** Botão (i) ao lado do resultado: abre a conta que chega nele, linha por linha */
function ContaDoResultado({
  linhas,
  resultado,
  aoEditarPrevistas,
}: {
  linhas: LinhaDaConta[]
  resultado: number
  aoEditarPrevistas?: () => void
}) {
  const [aberto, setAberto] = useState(false)
  const caixa = useRef<HTMLDivElement>(null)

  // Fecha ao clicar fora ou apertar Esc
  useEffect(() => {
    if (!aberto) return
    function aoClicarFora(e: MouseEvent) {
      if (!caixa.current?.contains(e.target as Node)) setAberto(false)
    }
    function aoTeclar(e: KeyboardEvent) {
      if (e.key === 'Escape') setAberto(false)
    }
    document.addEventListener('mousedown', aoClicarFora)
    document.addEventListener('keydown', aoTeclar)
    return () => {
      document.removeEventListener('mousedown', aoClicarFora)
      document.removeEventListener('keydown', aoTeclar)
    }
  }, [aberto])

  const comSinal = (v: number) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${formatarMoeda(Math.abs(v))}`

  return (
    <div ref={caixa}>
      <button
        type="button"
        onClick={() => setAberto((a) => !a)}
        aria-label="Como o resultado é calculado"
        aria-expanded={aberto}
        className={`flex h-6 w-6 items-center justify-center rounded-full transition ${aberto ? 'bg-texto/10 text-texto' : 'text-texto-suave hover:bg-texto/[0.06] hover:text-texto'}`}
      >
        <IconeInfo className="h-4 w-4" />
      </button>
      {aberto && (
        <div className="animate-surgir absolute top-7 left-0 z-20 w-80 max-w-[calc(100vw-2rem)] rounded-2xl border border-borda bg-fundo p-4 text-left shadow-xl sm:right-0 sm:left-auto">
          <p className="text-sm font-semibold">Como chegamos no resultado</p>
          <dl className="mt-3 flex flex-col gap-2 text-sm">
            {linhas.map((l) => (
              <div key={l.rotulo} className="flex items-baseline justify-between gap-3">
                <dt className="min-w-0 text-texto-suave">
                  {l.rotulo}
                  {l.detalhe && <span className="block truncate text-xs">{l.detalhe}</span>}
                </dt>
                <dd
                  className={`numero shrink-0 ${l.sinal && l.valor < 0 ? 'text-despesa' : l.sinal && l.valor > 0 ? 'text-receita' : ''}`}
                >
                  {l.sinal ? comSinal(l.valor) : formatarMoeda(l.valor)}
                </dd>
              </div>
            ))}
            <div className="mt-1 flex items-baseline justify-between gap-3 border-t border-borda pt-2.5 font-semibold">
              <dt>Resultado</dt>
              <dd className={`numero ${resultado < 0 ? 'text-despesa' : ''}`}>{comSinal(resultado)}</dd>
            </div>
          </dl>
          <p className="mt-3 text-xs text-texto-suave">
            A fatura que vence no mês pesa até ser paga; as receitas previstas contam até chegarem.
          </p>
          {aoEditarPrevistas && (
            <button
              type="button"
              onClick={() => {
                setAberto(false)
                aoEditarPrevistas()
              }}
              className="mt-2 text-xs font-medium text-destaque underline-offset-2 hover:underline"
            >
              Editar receitas previstas
            </button>
          )}
        </div>
      )}
    </div>
  )
}

/**
 * O que falta pagar das faturas (dos cartões pessoais) que vencem no mês, inteiras: é o que vai sair da conta.
 * A parte de outras pessoas volta pelo que elas mandam (aReceberDasFaturas).
 */
function faltaPagarDasFaturas(compras: Transacao[], pagamentos: Transacao[], cartoes: Cartao[]) {
  const pessoais = new Set(cartoes.filter((c) => !c.empresarial).map((c) => c.id))
  const porCartao = new Map<string, { total: number }>()
  for (const t of compras) {
    if (!t.cartao_id || !pessoais.has(t.cartao_id)) continue
    const cartao = porCartao.get(t.cartao_id) ?? { total: 0 }
    cartao.total += Math.round(t.valor * 100) * (t.tipo === 'despesa' ? 1 : -1)
    porCartao.set(t.cartao_id, cartao)
  }
  for (const t of pagamentos) {
    const cartao = t.pagamento_cartao_id ? porCartao.get(t.pagamento_cartao_id) : undefined
    if (cartao) cartao.total -= Math.round(t.valor * 100)
  }
  let falta = 0
  for (const c of porCartao.values()) falta += Math.max(c.total, 0)
  return falta / 100
}

/** Total das faturas (dos cartões pessoais) que vencem no mês */
function somaDaFatura(compras: Transacao[], cartoes: Cartao[], soDeOutros = false) {
  const pessoais = new Set(cartoes.filter((c) => !c.empresarial).map((c) => c.id))
  let centavos = 0
  for (const t of compras)
    if (t.cartao_id && pessoais.has(t.cartao_id) && (!soDeOutros || t.terceiro))
      centavos += Math.round(t.valor * 100) * (t.tipo === 'despesa' ? 1 : -1)
  return centavos / 100
}

/** Parte de outras pessoas nas faturas (dos cartões pessoais) que vencem no mês */
function parteDeOutrosNasFaturas(compras: Transacao[], cartoes: Cartao[]) {
  return somaDaFatura(compras, cartoes, true)
}

/**
 * Quanto cada pessoa ainda deve mandar pela parte dela nas faturas (dos cartões pessoais) que vencem no mês, esperado
 * até a véspera do vencimento. Abate o que ela mandou desde o vencimento anterior, descontado o que eu paguei por
 * ela fora do cartão nesse tempo (o Pix que veio para pagar outra coisa dela não paga a fatura).
 */
function aReceberDasFaturas(compras: Transacao[], recentes: Transacao[], cartoes: Cartao[], mes: Date) {
  const pessoais = new Map(cartoes.filter((c) => !c.empresarial).map((c) => [c.id, c]))
  const porPessoa = new Map<string, { parte: number; dia: number; desde: string }>()
  for (const t of compras) {
    const cartao = t.cartao_id ? pessoais.get(t.cartao_id) : undefined
    if (!cartao || !t.terceiro) continue
    const vencimento = datasDaFatura(mes, cartao.dia_fechamento, cartao.dia_vencimento).vencimento
    const anterior = datasDaFatura(somarMeses(mes, -1), cartao.dia_fechamento, cartao.dia_vencimento).vencimento
    const desde = paraISO(new Date(anterior.getFullYear(), anterior.getMonth(), anterior.getDate() + 1))
    const dia = Math.max(vencimento.getDate() - 1, 1)
    const p = porPessoa.get(t.terceiro) ?? { parte: 0, dia, desde }
    p.parte += Math.round(t.valor * 100) * (t.tipo === 'despesa' ? 1 : -1)
    p.dia = Math.min(p.dia, dia)
    if (desde < p.desde) p.desde = desde
    porPessoa.set(t.terceiro, p)
  }
  const lista: { pessoa: string; centavos: number; dia: number }[] = []
  for (const [pessoa, p] of porPessoa) {
    let mandou = 0
    for (const t of recentes) {
      if (t.terceiro !== pessoa || t.forma === 'credito' || t.transferencia_interna || t.data < p.desde) continue
      mandou += Math.round(t.valor * 100) * (t.tipo === 'receita' ? 1 : -1)
    }
    const falta = p.parte - Math.max(mandou, 0)
    if (falta > 0) lista.push({ pessoa, centavos: falta, dia: p.dia })
  }
  return lista.sort((a, b) => b.centavos - a.centavos)
}

/**
 * Quais receitas previstas já chegaram no mês: uma receita minha (fora transferências e cartão) de pelo menos 90% do
 * valor, a partir de 5 dias antes do dia. Cada receita só vale para uma prevista; as maiores escolhem primeiro.
 */
function previstasRecebidas(previstas: ReceitaPrevista[], transacoes: Transacao[]) {
  const candidatas = transacoes.filter(
    (t) => t.tipo === 'receita' && t.forma !== 'credito' && !t.transferencia_interna && !t.terceiro,
  )
  const usadas = new Set<string>()
  const recebidas = new Set<string>()
  for (const p of [...previstas].sort((a, b) => b.valor - a.valor)) {
    const achada = candidatas
      .filter((t) => !usadas.has(t.id) && t.valor >= p.valor * 0.9 && Number(t.data.slice(8, 10)) >= p.dia - 5)
      .sort((a, b) => Math.abs(Number(a.data.slice(8, 10)) - p.dia) - Math.abs(Number(b.data.slice(8, 10)) - p.dia))[0]
    if (!achada) continue
    usadas.add(achada.id)
    recebidas.add(p.id)
  }
  return recebidas
}

/**
 * Receitas e despesas do resultado do mês; somas em centavos para não acumular erro de arredondamento.
 * O cartão conta no mês em que a fatura vence: as compras no crédito feitas no mês ficam para a fatura
 * delas, e entram as da fatura deste mês (mesmo as feitas no mês anterior).
 */
function somarMes(transacoes: Transacao[], daFatura: Transacao[]) {
  let receitas = 0
  let despesas = 0
  let noCredito = 0
  for (const t of transacoes) {
    receitas += receitaEmCentavos(t)
    if (t.forma !== 'credito') despesas += gastoEmCentavos(t)
  }
  for (const t of daFatura) noCredito += gastoEmCentavos(t)
  despesas += noCredito
  return { receitas: receitas / 100, despesas: despesas / 100, noCredito: noCredito / 100 }
}

type Dia = {
  dia: number
  centavos: number
  futuro: boolean
  hoje: boolean
  previsto: number
  previstas: string[]
  aReceber: number
  aReceberDe: string[]
}
type Fechamento = { dia: number; cartao: string; centavos: number; forca: number }

/** Gasto de cada dia do mês (dias que ainda não chegaram ficam marcados como futuros) */
function gastoPorDia(transacoes: Transacao[], mes: Date): Dia[] {
  const total = diasNoMes(mes)
  const centavos = new Array<number>(total).fill(0)
  for (const t of transacoes) {
    const d = Number(t.data.slice(8, 10))
    if (d >= 1 && d <= total) centavos[d - 1] += gastoEmCentavos(t)
  }
  const agora = new Date()
  const mesAtual = mes.getFullYear() === agora.getFullYear() && mes.getMonth() === agora.getMonth()
  const futuroDoMes = mes > agora
  return centavos.map((c, i) => ({
    dia: i + 1,
    centavos: Math.max(c, 0),
    futuro: futuroDoMes || (mesAtual && i + 1 > agora.getDate()),
    hoje: mesAtual && i + 1 === agora.getDate(),
    previsto: 0,
    previstas: [],
    aReceber: 0,
    aReceberDe: [],
  }))
}

function IconeSeta({ para }: { para: 'cima' | 'baixo' }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-3.5 w-3.5"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={para === 'cima' ? 'M7 17 17 7M9 7h8v8' : 'M7 7l10 10M17 9v8H9'} />
    </svg>
  )
}

const SEMANA = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S']

/**
 * Mapa de calor do mês: um quadradinho por dia, montado como calendário (domingo primeiro).
 * Quanto mais gastou no dia, mais vermelho; raiz quadrada na escala para os dias pequenos não sumirem.
 */
function MapaDoMes({
  dias,
  mes,
  carregando,
  fechamentos,
}: {
  dias: Dia[]
  mes: Date
  carregando: boolean
  fechamentos: Fechamento[]
}) {
  const maior = Math.max(...dias.map((d) => Math.max(d.centavos, d.previsto)), 1)
  const temPrevisto = dias.some((d) => d.previsto > 0)
  const temAReceber = dias.some((d) => d.aReceber > 0)
  const vazios = new Date(mes.getFullYear(), mes.getMonth(), 1).getDay()
  const passados = dias.filter((d) => !d.futuro)
  const total = passados.reduce((s, d) => s + d.centavos, 0)
  const pico = passados.reduce<Dia | null>((m, d) => (d.centavos > (m?.centavos ?? 0) ? d : m), null)
  const semGasto = passados.filter((d) => d.centavos === 0).length
  const nomeDoDia = (dia: number) =>
    new Date(mes.getFullYear(), mes.getMonth(), dia).toLocaleDateString('pt-BR', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
    })
  // No celular não tem hover: tocar no dia abre o mesmo balão (tocar de novo ou fora fecha)
  const [aberto, setAberto] = useState<number | null>(null)
  const grade = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (aberto === null) return
    const fora = (e: PointerEvent) => {
      if (!grade.current?.contains(e.target as Node)) setAberto(null)
    }
    document.addEventListener('pointerdown', fora)
    return () => document.removeEventListener('pointerdown', fora)
  }, [aberto])

  return (
    <div className="mt-7 flex flex-col gap-6 sm:flex-row sm:items-start">
      <div className="w-full min-w-0 flex-1 sm:max-w-[30rem]">
        <div className="grid grid-cols-7 gap-1.5 text-center text-[11px] font-medium text-texto-suave">
          {SEMANA.map((l, i) => (
            <span key={i}>{l}</span>
          ))}
        </div>
        <div ref={grade} className="mt-1.5 grid grid-cols-7 gap-1.5" role="list" aria-label="Gasto de cada dia do mês">
          {Array.from({ length: vazios }, (_, i) => (
            <span key={`v${i}`} aria-hidden="true" />
          ))}
          {dias.map((d) => {
            const forca = d.centavos > 0 ? 0.16 + 0.84 * Math.sqrt(d.centavos / maior) : 0
            const valor = formatarMoeda(d.centavos / 100)
            const fecha = carregando ? [] : fechamentos.filter((f) => f.dia === d.dia)
            const forcaFatura = Math.max(0, ...fecha.map((f) => f.forca))
            const textoFecha = fecha.map((f) => `fecha a fatura ${f.cartao}: ${formatarMoeda(f.centavos / 100)}`).join('; ')
            // Assinatura que ainda vai ser cobrada: listrado, na mesma escala de vermelho
            const forcaPrevista = !carregando && d.previsto > 0 ? 0.16 + 0.84 * Math.sqrt(d.previsto / maior) : 0
            const textoPrevisto = d.previsto > 0 ? `previsto ${d.previstas.join(', ')}: ${formatarMoeda(d.previsto / 100)}` : ''
            // Dinheiro de outras pessoas que deve chegar: listrado em azul (junto com o vermelho, se o dia tiver os dois)
            const textoAReceber =
              d.aReceber > 0 ? `a receber de ${d.aReceberDe.join(', ')}: ${formatarMoeda(d.aReceber / 100)}` : ''
            const listras = [
              forcaPrevista > 0
                ? `color-mix(in oklab, var(--color-despesa) ${Math.round(forcaPrevista * 100)}%, transparent)`
                : null,
              !carregando && d.aReceber > 0 ? 'color-mix(in oklab, var(--color-a-receber) 70%, transparent)' : null,
            ].filter((c): c is string => c !== null)
            const fundoListrado =
              listras.length === 2
                ? `repeating-linear-gradient(135deg, ${listras[0]} 0 4px, transparent 4px 6px, ${listras[1]} 6px 10px, transparent 10px 12px)`
                : listras.length === 1
                  ? `repeating-linear-gradient(135deg, ${listras[0]} 0 5px, transparent 5px 9px)`
                  : null
            const detalhes = [textoFecha, textoPrevisto, textoAReceber].filter(Boolean).join('; ')
            // Balão das colunas da ponta encosta na borda do dia em vez de centralizar, para não sair da tela
            const coluna = (vazios + d.dia - 1) % 7
            const lado = coluna <= 1 ? 'left-0' : coluna >= 5 ? 'right-0' : 'left-1/2 -translate-x-1/2'
            return (
              <span
                key={d.dia}
                role="listitem"
                tabIndex={0}
                onClick={() => setAberto((a) => (a === d.dia ? null : d.dia))}
                aria-label={`${nomeDoDia(d.dia)}: ${d.futuro ? 'ainda não chegou' : valor}${detalhes ? `; ${detalhes}` : ''}`}
                className={`group relative flex aspect-square items-center justify-center rounded-[10px] text-[11px] font-medium outline-none transition focus-visible:ring-2 focus-visible:ring-texto/40 ${
                  carregando
                    ? 'animate-pulse bg-texto/[0.07] text-transparent'
                    : d.futuro
                      ? 'border border-dashed border-texto/15 text-texto-suave/50'
                      : forca === 0
                        ? 'bg-texto/[0.06] text-texto-suave hover:bg-texto/[0.1]'
                        : `hover:scale-110 ${forca > 0.55 ? 'font-semibold text-(--calor-texto)' : 'text-texto'}`
                } ${d.hoje ? 'ring-2 ring-texto/70 ring-offset-2 ring-offset-fundo' : ''}`}
                style={{
                  ...(!carregando && forca > 0
                    ? { backgroundColor: `color-mix(in oklab, var(--color-despesa) ${Math.round(forca * 100)}%, transparent)` }
                    : {}),
                  ...(fundoListrado ? { backgroundImage: fundoListrado } : {}),
                  // Dia do fechamento: borda grossa, mais vermelha quanto maior a fatura
                  ...(fecha.length
                    ? {
                        outline: `2.5px solid color-mix(in oklab, var(--color-despesa) ${Math.round(Math.max(forcaFatura, 0.35) * 100)}%, transparent)`,
                        outlineOffset: '-2.5px',
                      }
                    : {}),
                }}
              >
                {fundoListrado ? <span className="rounded-md bg-fundo/85 px-1 font-semibold text-texto">{d.dia}</span> : d.dia}
                {fecha.length > 0 && <IconeCartao className="absolute top-1 right-1 h-2.5 w-2.5 text-despesa" />}
                {!carregando && (
                  <span
                    className={`pointer-events-none absolute bottom-full z-20 mb-2 rounded-xl bg-texto px-3 py-2 text-left whitespace-nowrap text-fundo shadow-lg transition group-hover:translate-y-0 group-hover:opacity-100 group-focus-visible:translate-y-0 group-focus-visible:opacity-100 ${lado} ${aberto === d.dia ? 'translate-y-0 opacity-100' : 'translate-y-1 opacity-0'}`}
                    aria-hidden="true"
                  >
                    <span className="block text-[11px] capitalize opacity-70">{nomeDoDia(d.dia)}</span>
                    {!d.futuro && (
                      <span className="numero block text-sm font-semibold">{d.centavos > 0 ? `−${valor}` : 'Nada gasto'}</span>
                    )}
                    {/* Dia que ainda não chegou e sem nada marcado: diz isso em vez de não mostrar nada */}
                    {d.futuro && d.previsto === 0 && d.aReceber === 0 && fecha.length === 0 && (
                      <span className="block text-sm font-semibold">Nada previsto</span>
                    )}
                    {d.previsto > 0 && (
                      <span className="block text-[11px]">
                        Previsto {d.previstas.join(', ')} ·{' '}
                        <span className="numero font-semibold">−{formatarMoeda(d.previsto / 100)}</span>
                      </span>
                    )}
                    {d.aReceber > 0 && (
                      <span className="block text-[11px]">
                        A receber de {d.aReceberDe.join(', ')} ·{' '}
                        <span className="numero font-semibold">+{formatarMoeda(d.aReceber / 100)}</span>
                      </span>
                    )}
                    {fecha.map((f) => (
                      <span key={f.cartao} className="block text-[11px]">
                        Fecha a fatura · <span className="numero font-semibold">{formatarMoeda(f.centavos / 100)}</span>
                      </span>
                    ))}
                  </span>
                )}
              </span>
            )
          })}
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-end gap-1.5 text-[11px] text-texto-suave">
          Menos
          {[0, 0.3, 0.55, 0.8, 1].map((f) => (
            <span
              key={f}
              className="h-3 w-3 rounded-[4px] bg-texto/[0.06]"
              style={f ? { backgroundColor: `color-mix(in oklab, var(--color-despesa) ${f * 100}%, transparent)` } : undefined}
            />
          ))}
          Mais
          {temPrevisto && (
            <>
              <span className="mx-1 h-3 w-px bg-borda" aria-hidden="true" />
              <span
                className="h-3 w-3 rounded-[4px]"
                style={{
                  backgroundImage: 'repeating-linear-gradient(135deg, var(--color-despesa) 0 2px, transparent 2px 4px)',
                }}
                aria-hidden="true"
              />
              Previsto
            </>
          )}
          {temAReceber && (
            <>
              <span className="mx-1 h-3 w-px bg-borda" aria-hidden="true" />
              <span
                className="h-3 w-3 rounded-[4px]"
                style={{
                  backgroundImage: 'repeating-linear-gradient(135deg, var(--color-a-receber) 0 2px, transparent 2px 4px)',
                }}
                aria-hidden="true"
              />
              A receber
            </>
          )}
          {fechamentos.length > 0 && (
            <>
              <span className="mx-1 h-3 w-px bg-borda" aria-hidden="true" />
              <span
                className="h-3 w-3 rounded-[4px]"
                style={{ outline: '2px solid var(--color-despesa)', outlineOffset: '-2px' }}
                aria-hidden="true"
              />
              Fecha a fatura
            </>
          )}
        </div>
      </div>

      {/* No celular o maior gasto ocupa a linha toda: valor e dia não cabem num terço do card */}
      <dl className="grid grid-cols-2 gap-3 sm:w-40 sm:shrink-0 sm:grid-cols-1">
        <div className="col-span-2 min-w-0 rounded-2xl bg-texto/[0.05] p-3.5 sm:col-span-1">
          <dt className="text-xs text-texto-suave">Maior gasto</dt>
          <dd className="numero mt-1 font-semibold text-despesa">{pico ? formatarMoeda(pico.centavos / 100) : '—'}</dd>
          {pico && <dd className="text-xs text-texto-suave capitalize">{nomeDoDia(pico.dia)}</dd>}
        </div>
        <div className="min-w-0 rounded-2xl bg-texto/[0.05] p-3.5">
          <dt className="text-xs text-texto-suave">Média/dia</dt>
          <dd className="numero mt-1 font-semibold">{formatarMoeda(passados.length ? total / passados.length / 100 : 0)}</dd>
        </div>
        <div className="min-w-0 rounded-2xl bg-texto/[0.05] p-3.5">
          <dt className="text-xs text-texto-suave">Sem gastar</dt>
          <dd className="numero mt-1 font-semibold">
            {semGasto} <span className="text-xs font-normal text-texto-suave">de {passados.length}</span>
          </dd>
        </div>
      </dl>
    </div>
  )
}

/** "+12% · R$ 80,00 em setembro" para o título da categoria */
function variacaoTexto(atual: number, anterior: number, nomeMesAnterior: string) {
  const variacao = variacaoPercentual(atual, anterior)
  if (variacao === null) return `Sem gasto em ${nomeMesAnterior}`
  return `${variacao > 0 ? '+' : ''}${variacao}% · ${formatarMoeda(anterior)} em ${nomeMesAnterior}`
}
