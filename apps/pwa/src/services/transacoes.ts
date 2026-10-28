import { deISO, intervaloDoMes, paraISO, somarMeses } from '../lib/datas'
import { dividirEmParcelas, mesDaFatura } from '../lib/fatura'
import { supabase } from '../lib/supabase'
import type { Cartao, FormaPagamento, NovaTransacao, TipoTransacao, Transacao } from '../types/financas'

/** O que o formulário de lançamento envia */
export type DadosLancamento = {
  tipo: TipoTransacao
  forma: FormaPagamento
  valorCentavos: number
  local: string
  descricao: string
  observacao: string
  categoriaId: string | null
  /** "2026-10-23" */
  data: string
  contaId: string | null
  /** Obrigatório quando forma = 'credito' */
  cartao: Cartao | null
  /** 1 a 12; só vale no crédito */
  parcelas: number
  /** Transferência entre as próprias contas (não vale no crédito) */
  transferencia: boolean
  /** Nome da pessoa, quando o lançamento é de outra pessoa (fora das minhas receitas e despesas) */
  terceiro: string | null
  /** Com terceiro: é empréstimo (nos Acertos não zera quando o mês fecha, fica em aberto até ser devolvido) */
  /** Só vale com terceiro: o dinheiro foi emprestado e volta depois */
  emprestimo?: boolean
}

const ERRO_SALVAR = 'Não foi possível salvar. Tente de novo.'

export async function listarTransacoesDoMes(mes: Date) {
  const [inicio, fim] = intervaloDoMes(mes)
  const { data, error } = await supabase
    .from('transacoes')
    .select('*')
    .gte('data', inicio)
    .lte('data', fim)
    .order('data', { ascending: false })
    .order('criado_em', { ascending: false })
  if (error) throw error
  return data as Transacao[]
}

/** Compras no crédito (de todos os cartões) da fatura que vence no mês, mesmo as feitas no mês anterior */
export async function listarComprasDaFaturaDoMes(mes: Date) {
  const { data, error } = await supabase
    .from('transacoes')
    .select('*')
    .eq('forma', 'credito')
    .eq('fatura', intervaloDoMes(mes)[0])
  if (error) throw error
  return data as Transacao[]
}

/** Pagamentos (de todos os cartões) feitos para a fatura que vence no mês */
export async function listarPagamentosDasFaturasDoMes(mes: Date) {
  const { data, error } = await supabase.from('transacoes').select('*').eq('pagamento_fatura', intervaloDoMes(mes)[0])
  if (error) throw error
  return data as Transacao[]
}

/** Saldo atual calculado no banco (função saldo_atual) */
export async function buscarSaldoAtual() {
  const { data, error } = await supabase.rpc('saldo_atual')
  if (error) throw error
  return Number(data)
}

/** Saldo das contas pessoais (ou das da empresa) no fim do dia informado ("2026-09-30") */
export async function buscarSaldoEm(dia: string, empresarial = false) {
  const { data, error } = await supabase.rpc('saldo_em', { p_dia: dia, p_empresarial: empresarial })
  if (error) throw error
  return Number(data)
}

function camposComuns(d: DadosLancamento) {
  return {
    tipo: d.tipo,
    forma: d.forma,
    local: d.local.trim() || null,
    descricao: d.descricao.trim() || null,
    observacao: d.observacao.trim() || null,
    categoria_id: d.categoriaId,
    transferencia_interna: d.forma !== 'credito' && d.transferencia,
    terceiro: d.transferencia ? null : d.terceiro?.trim() || null,
    emprestimo: !d.transferencia && Boolean(d.terceiro?.trim()) && Boolean(d.emprestimo),
    // compra no crédito não sai de nenhuma conta na hora (só o pagamento da fatura)
    conta_id: d.forma === 'credito' ? null : d.contaId,
    cartao_id: d.forma === 'credito' ? (d.cartao?.id ?? null) : null,
  }
}

/** O que a pessoa mandou só acerta um mês enquanto continuar sendo receita dela fora do crédito */
const aindaAcertaOMes = (terceiro: string | null, tipo: TipoTransacao, forma: FormaPagamento) =>
  terceiro !== null && tipo === 'receita' && forma !== 'credito'

function faturaDaCompra(d: DadosLancamento) {
  if (d.forma !== 'credito' || !d.cartao) return null
  return mesDaFatura(deISO(d.data), d.cartao.dia_fechamento, d.cartao.dia_vencimento)
}

/** Cria o lançamento; no crédito parcelado, cria uma transação por parcela, cada uma na sua fatura */
export async function criarLancamento(d: DadosLancamento) {
  const comuns = camposComuns(d)
  const fatura = faturaDaCompra(d)
  let linhas: NovaTransacao[]

  if (fatura && d.parcelas > 1) {
    const dataCompra = deISO(d.data)
    const grupo = crypto.randomUUID()
    linhas = dividirEmParcelas(d.valorCentavos, d.parcelas).map((centavos, i) => ({
      ...comuns,
      valor: centavos / 100,
      data: paraISO(somarMeses(dataCompra, i)),
      fatura: paraISO(somarMeses(fatura, i)),
      parcela_atual: i + 1,
      total_parcelas: d.parcelas,
      grupo_parcela: grupo,
    }))
  } else {
    linhas = [{ ...comuns, valor: d.valorCentavos / 100, data: d.data, fatura: fatura ? paraISO(fatura) : null }]
  }

  // Um único insert: ou entram todas as parcelas, ou nenhuma
  const { error } = await supabase.from('transacoes').insert(linhas)
  if (error) {
    console.error(error)
    throw new Error(ERRO_SALVAR)
  }
}

/**
 * Atualiza um lançamento. Numa parcela, só valor, local, descrição, observação e categoria mudam
 * (forma, cartão e datas valem para o grupo; para mudar, exclua e lance de novo).
 * Num pagamento de fatura, tipo e forma ficam como estão.
 * Numa importada do banco ou numa parte de divisão, só local, descrição, observação, categoria e de quem é mudam.
 */
export async function atualizarLancamento(original: Transacao, d: DadosLancamento) {
  const comuns = camposComuns(d)
  // Importada: o resto vem do banco e a sincronização mantém. Parte de divisão: valor e datas vêm do original
  const doUsuario = {
    local: comuns.local,
    descricao: comuns.descricao,
    observacao: comuns.observacao,
    categoria_id: comuns.categoria_id,
    ...(original.pagamento_cartao_id ? {} : { terceiro: comuns.terceiro, emprestimo: comuns.emprestimo ?? false }),
    ...(original.acerto_mes && !aindaAcertaOMes(comuns.terceiro, original.tipo, original.forma)
      ? { acerto_mes: null }
      : {}),
    ...(original.forma === 'credito' || original.pagamento_cartao_id || original.dividida_de
      ? {}
      : { transferencia_interna: d.transferencia }),
  }
  const mudancas =
    original.origem === 'pluggy' || original.dividida_de
      ? doUsuario
      : original.grupo_parcela
        ? {
            valor: d.valorCentavos / 100,
            local: comuns.local,
            descricao: comuns.descricao,
            observacao: comuns.observacao,
            categoria_id: comuns.categoria_id,
            terceiro: comuns.terceiro,
            emprestimo: comuns.emprestimo ?? false,
          }
        : original.pagamento_cartao_id
          ? {
              valor: d.valorCentavos / 100,
              local: comuns.local,
              descricao: comuns.descricao,
              observacao: comuns.observacao,
              categoria_id: comuns.categoria_id,
              conta_id: d.contaId,
              data: d.data,
            }
          : (() => {
              const fatura = faturaDaCompra(d)
              return {
                ...comuns,
                valor: d.valorCentavos / 100,
                data: d.data,
                fatura: fatura ? paraISO(fatura) : null,
                ...(original.acerto_mes && !aindaAcertaOMes(comuns.terceiro, d.tipo, d.forma) ? { acerto_mes: null } : {}),
              }
            })()

  const { error } = await supabase.from('transacoes').update(mudancas).eq('id', original.id)
  if (error) {
    console.error(error)
    throw new Error(ERRO_SALVAR)
  }
  // De quem é vale para a compra inteira: as outras parcelas acompanham
  if (original.forma === 'credito' && original.total_parcelas && 'terceiro' in mudancas && mudancas.terceiro !== original.terceiro) {
    try {
      await marcarDeTerceiro([original], mudancas.terceiro ?? null)
    } catch {
      throw new Error('Esta parcela foi salva, mas não deu para mudar as outras parcelas da compra.')
    }
  }
}

// "Jim.Com* 36827242 Eli 2/4" → "Jim.Com* 36827242 Eli"
const semNumeroDaParcela = (texto: string | null) => (texto ?? '').replace(/\s*\d+\/\d+\s*$/, '')

/**
 * Ids de todas as parcelas da compra de uma transação. Lançada aqui, as parcelas têm o mesmo grupo;
 * importada do banco, são as do mesmo cartão com a mesma descrição e número de parcelas (o valor
 * pode mudar 1 centavo entre elas). Fora do crédito parcelado, só ela mesma.
 */
async function idsDaCompra(t: Transacao) {
  if (t.grupo_parcela) {
    const { data, error } = await supabase.from('transacoes').select('id').eq('grupo_parcela', t.grupo_parcela)
    if (error) throw error
    return data.map((p) => p.id)
  }
  if (t.forma !== 'credito' || !t.total_parcelas || !t.cartao_id) return [t.id]
  const { data, error } = await supabase
    .from('transacoes')
    .select('id, descricao, valor')
    .eq('cartao_id', t.cartao_id)
    .eq('total_parcelas', t.total_parcelas)
    .eq('tipo', t.tipo)
  if (error) throw error
  const base = semNumeroDaParcela(t.descricao)
  return data
    .filter((p) => semNumeroDaParcela(p.descricao) === base && Math.abs(p.valor - t.valor) <= 0.05)
    .map((p) => p.id)
}

/** Marca (ou desmarca, com null) compras como de outra pessoa, cada uma com todas as parcelas */
export async function marcarDeTerceiro(transacoes: Transacao[], terceiro: string | null) {
  const ids = new Set<string>()
  for (const t of transacoes) for (const id of await idsDaCompra(t)) ids.add(id)
  const nome = terceiro?.trim() || null
  const { error } = await supabase.from('transacoes').update({ terceiro: nome }).in('id', [...ids])
  if (error) {
    console.error(error)
    throw new Error('Não foi possível marcar. Tente de novo.')
  }
}

/** Compras no crédito de uma fatura (dia 1 do mês de vencimento) que ainda não são de ninguém */
export async function listarComprasSemDono(fatura: Date) {
  const { data, error } = await supabase
    .from('transacoes')
    .select('*')
    .eq('fatura', paraISO(fatura))
    .eq('forma', 'credito')
    .eq('tipo', 'despesa')
    .is('terceiro', null)
    .order('data', { ascending: false })
    .order('criado_em', { ascending: false })
  if (error) throw error
  return data as Transacao[]
}

/** Compras e parcelas que caem numa fatura do cartão, da mais recente para a mais antiga */
export async function listarTransacoesDaFatura(cartaoId: string, fatura: Date) {
  const { data, error } = await supabase
    .from('transacoes')
    .select('*')
    .eq('cartao_id', cartaoId)
    .eq('fatura', paraISO(fatura))
    .order('data', { ascending: false })
    .order('criado_em', { ascending: false })
  if (error) throw error
  return data as Transacao[]
}

/** Total (em centavos) de cada fatura do cartão entre duas faturas, inclusive. Chave: "2026-11-01" */
export async function totaisDasFaturas(cartaoId: string, de: Date, ate: Date, soMinhas = false) {
  let consulta = supabase
    .from('transacoes')
    .select('fatura, valor, tipo')
    .eq('cartao_id', cartaoId)
    .gte('fatura', paraISO(de))
    .lte('fatura', paraISO(ate))
  // Só o que é meu: deixa de fora as compras (e partes) de outras pessoas
  if (soMinhas) consulta = consulta.is('terceiro', null)
  const { data, error } = await consulta
  if (error) throw error
  const totais = new Map<string, number>()
  for (const t of data) {
    if (!t.fatura) continue
    const centavos = Math.round(t.valor * 100) * (t.tipo === 'despesa' ? 1 : -1)
    totais.set(t.fatura, (totais.get(t.fatura) ?? 0) + centavos)
  }
  return totais
}

/** Pagamentos da fatura (ela pode ser paga em partes), do mais antigo para o mais recente */
export async function listarPagamentosDaFatura(cartaoId: string, fatura: Date) {
  const { data, error } = await supabase
    .from('transacoes')
    .select('*')
    .eq('pagamento_cartao_id', cartaoId)
    .eq('pagamento_fatura', paraISO(fatura))
    .order('data')
    .order('criado_em')
  if (error) throw error
  return data as Transacao[]
}

type DadosPagamento = {
  cartao: Cartao
  fatura: Date
  valorCentavos: number
  contaId: string | null
  /** "2026-10-23" */
  data: string
  descricao: string
}

/** Registra um pagamento da fatura (inteiro ou parte) como despesa no débito */
export async function pagarFatura(p: DadosPagamento) {
  const { error } = await supabase.from('transacoes').insert({
    tipo: 'despesa',
    forma: 'debito',
    valor: p.valorCentavos / 100,
    data: p.data,
    conta_id: p.contaId,
    local: `Fatura ${p.cartao.nome}`,
    descricao: p.descricao,
    pagamento_cartao_id: p.cartao.id,
    pagamento_fatura: paraISO(p.fatura),
  })
  if (error) {
    console.error(error)
    throw new Error('Não foi possível registrar o pagamento. Tente de novo.')
  }
}

type DadosPagamentoDeTerceiro = {
  pessoa: string
  /** Dia 1 do mês que o pagamento acerta */
  mes: Date
  valorCentavos: number
  /** Como o dinheiro chegou; no crédito seria estorno de uma compra, não acerto */
  forma: Exclude<FormaPagamento, 'credito'>
  contaId: string | null
  /** "2026-10-27" */
  data: string
  descricao: string
}

/**
 * Registra o dinheiro que a pessoa mandou para acertar um mês (inteiro ou parte): entra como receita
 * dela, então soma no saldo sem contar nas minhas receitas.
 */
export async function registrarPagamentoDeTerceiro(p: DadosPagamentoDeTerceiro) {
  const { error } = await supabase.from('transacoes').insert({
    tipo: 'receita',
    forma: p.forma,
    valor: p.valorCentavos / 100,
    data: p.data,
    conta_id: p.contaId,
    local: p.pessoa,
    descricao: p.descricao,
    terceiro: p.pessoa,
    acerto_mes: paraISO(p.mes),
  })
  if (error) {
    console.error(error)
    throw new Error('Não foi possível registrar o pagamento. Tente de novo.')
  }
}

export async function excluirTransacao(id: string) {
  const { error } = await supabase.from('transacoes').delete().eq('id', id)
  if (error) throw new Error('Não foi possível excluir. Tente de novo.')
}

export async function excluirGrupoDeParcelas(grupo: string) {
  const { error } = await supabase.from('transacoes').delete().eq('grupo_parcela', grupo)
  if (error) throw new Error('Não foi possível excluir. Tente de novo.')
}

/** Uma parte separada de um lançamento; herda tipo, forma, conta/cartão, data e fatura do original */
export type ParteDivisao = {
  valorCentavos: number
  categoriaId: string | null
  local: string
  terceiro: string | null
}

/** Separa uma parte do valor num lançamento novo; o original fica com o resto (função dividir_transacao) */
export async function dividirLancamento(original: Transacao, parte: ParteDivisao) {
  const { error } = await supabase.rpc('dividir_transacao', {
    p_id: original.id,
    p_partes: [
      {
        valor: parte.valorCentavos / 100,
        categoria_id: parte.categoriaId,
        local: parte.local.trim(),
        terceiro: parte.terceiro?.trim() || null,
      },
    ],
  })
  if (error) {
    console.error(error)
    if (error.hint === 'divisao_invalida') throw new Error('A parte precisa ser menor que o valor do lançamento.')
    if (error.hint === 'nao_divisivel') throw new Error(error.message)
    throw new Error('Não foi possível dividir. Tente de novo.')
  }
}

/** Junta uma parte de volta ao lançamento original (o valor volta para ele) */
export async function desfazerDivisao(parte: Transacao) {
  const { error } = await supabase.rpc('desfazer_divisao', { p_id: parte.id })
  if (error) {
    console.error(error)
    throw new Error('Não foi possível juntar de volta. Tente de novo.')
  }
}

/** Nomes já usados em lançamentos de outras pessoas, para sugerir no formulário */
export async function listarTerceiros() {
  const { data, error } = await supabase.from('transacoes').select('terceiro').not('terceiro', 'is', null)
  if (error) throw error
  return [...new Set(data.map((t) => t.terceiro!))].sort((a, b) => a.localeCompare(b, 'pt-BR'))
}

/** Todos os lançamentos de outras pessoas, do mais recente para o mais antigo (tela de Acertos) */
export async function listarLancamentosDeTerceiros() {
  const { data, error } = await supabase
    .from('transacoes')
    .select('*')
    .not('terceiro', 'is', null)
    .order('data', { ascending: false })
    .order('criado_em', { ascending: false })
  if (error) throw error
  return data as Transacao[]
}
