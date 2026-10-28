import { FunctionsHttpError } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import type { ConexaoPluggy, ContaPluggy, MapeamentoCategoria, RegraLocal, SyncLog } from '../types/financas'

/** Recusa da função sync-pluggy: "nao_liberado" (outro usuário) ou "sem_conexoes" (falta configurar) */
export class ErroOpenFinance extends Error {
  constructor(
    mensagem: string,
    readonly codigo?: string,
  ) {
    super(mensagem)
  }
}

async function chamarSync<T>(acao: 'contas' | 'sincronizar' | 'reimportar') {
  const { data, error } = await supabase.functions.invoke<T>('sync-pluggy', { body: { acao } })
  if (!error) return data as T
  if (error instanceof FunctionsHttpError) {
    const corpo = (await error.context.json().catch(() => ({}))) as { erro?: string; codigo?: string }
    throw new ErroOpenFinance(corpo.erro ?? 'Não foi possível falar com o Open Finance.', corpo.codigo)
  }
  throw new ErroOpenFinance('Sem conexão com o servidor. Tente de novo.')
}

export type ResultadoSync = { status: SyncLog['status']; mensagem: string; importadas: number; atualizadas: number }

/** Busca as novidades dos bancos e importa as transações das contas vinculadas */
export const sincronizar = () => chamarSync<ResultadoSync>('sincronizar')

/** Busca de novo os últimos 90 dias e corrige o que já foi importado (valor, data, fatura, parcelas) */
export const reimportar = () => chamarSync<ResultadoSync>('reimportar')

/** Atualiza status das conexões e a lista de contas/cartões que a Pluggy enxerga */
export const atualizarContasDoBanco = () => chamarSync<{ conexoes: ConexaoPluggy[] }>('contas')

export async function ultimaSincronizacao() {
  const { data, error } = await supabase.from('sync_log').select('*').order('data', { ascending: false }).limit(1).maybeSingle()
  if (error) throw error
  return data as SyncLog | null
}

export async function listarConexoes() {
  const { data, error } = await supabase.from('pluggy_conexoes').select('*').order('banco')
  if (error) throw error
  return data
}

export async function listarContasDoBanco() {
  const { data, error } = await supabase.from('pluggy_contas').select('*').order('banco').order('tipo').order('nome')
  if (error) throw error
  return data as ContaPluggy[]
}

const ERRO_VINCULO = 'Não foi possível salvar o vínculo. Tente de novo.'

/** Liga uma conta da Pluggy a uma conta do app (ou desliga, com contaId null) */
export async function vincularConta(pluggyId: string, contaId: string | null) {
  const { error: e1 } = await supabase.from('contas').update({ pluggy_account_id: null }).eq('pluggy_account_id', pluggyId)
  if (e1) throw new Error(ERRO_VINCULO)
  if (!contaId) return
  const { error } = await supabase.from('contas').update({ pluggy_account_id: pluggyId }).eq('id', contaId)
  if (error) throw new Error(ERRO_VINCULO)
}

/** Liga um cartão da Pluggy a um cartão do app (ou desliga, com cartaoId null) */
export async function vincularCartao(pluggyId: string, cartaoId: string | null) {
  const { error: e1 } = await supabase.from('cartoes').update({ pluggy_account_id: null }).eq('pluggy_account_id', pluggyId)
  if (e1) throw new Error(ERRO_VINCULO)
  if (!cartaoId) return
  const { error } = await supabase.from('cartoes').update({ pluggy_account_id: pluggyId }).eq('id', cartaoId)
  if (error) throw new Error(ERRO_VINCULO)
}

/** Cria no app a conta (ou o cartão) da Pluggy, já vinculada */
export async function criarDoBanco(c: ContaPluggy) {
  const nome = c.numero ? `${c.nome} ${c.numero.slice(-4)}` : c.nome
  if (c.tipo === 'BANK') {
    const { error } = await supabase.from('contas').insert({ nome, pluggy_account_id: c.id })
    if (error) throw new Error('Não foi possível criar a conta.')
    return
  }
  const { error } = await supabase.from('cartoes').insert({
    nome,
    bandeira: c.bandeira,
    limite: c.limite ?? 0,
    // Sem a informação do banco, fica um palpite; dá para corrigir em Cartões
    dia_fechamento: c.dia_fechamento ?? 1,
    dia_vencimento: c.dia_vencimento ?? 10,
    pluggy_account_id: c.id,
  })
  if (error) throw new Error('Não foi possível criar o cartão.')
}

/**
 * Faz o saldo da conta no app bater com o do banco: saldo inicial =
 * saldo do banco − (entradas − saídas fora do crédito lançadas nessa conta até hoje).
 */
export async function ajustarSaldoDaConta(contaId: string, saldoDoBanco: number, hoje: string) {
  const { data, error } = await supabase
    .from('transacoes')
    .select('tipo, valor')
    .eq('conta_id', contaId)
    .neq('forma', 'credito')
    .lte('data', hoje)
  if (error) throw new Error('Não foi possível ajustar o saldo.')
  const movimento = data.reduce((soma, t) => soma + (t.tipo === 'receita' ? 1 : -1) * Math.round(t.valor * 100), 0)
  const saldoInicial = (Math.round(saldoDoBanco * 100) - movimento) / 100
  const { error: e2 } = await supabase.from('contas').update({ saldo_inicial: saldoInicial }).eq('id', contaId)
  if (e2) throw new Error('Não foi possível ajustar o saldo.')
}

// ===================== Categorias =====================

/** Categorias da Pluggy que já apareceram nas importadas, com quantas transações cada */
export async function categoriasDoBanco() {
  const { data, error } = await supabase.from('transacoes').select('categoria_pluggy').not('categoria_pluggy', 'is', null)
  if (error) throw error
  const contagem = new Map<string, number>()
  for (const t of data) contagem.set(t.categoria_pluggy!, (contagem.get(t.categoria_pluggy!) ?? 0) + 1)
  return contagem
}

export async function listarMapeamentos() {
  const { data, error } = await supabase.from('mapeamento_categorias').select('*')
  if (error) throw error
  return data as MapeamentoCategoria[]
}

/**
 * Define (ou remove, com categoriaId null) para qual categoria vai uma categoria da Pluggy.
 * As importadas dessa categoria que ainda estão em "Outros" (ou sem categoria) passam para a nova.
 */
export async function mapearCategoria(categoriaPluggy: string, categoriaId: string | null, outrosId: string | null) {
  if (!categoriaId) {
    const { error } = await supabase.from('mapeamento_categorias').delete().eq('categoria_pluggy', categoriaPluggy)
    if (error) throw new Error('Não foi possível salvar.')
    return
  }
  const { error } = await supabase
    .from('mapeamento_categorias')
    .upsert({ categoria_pluggy: categoriaPluggy, categoria_id: categoriaId }, { onConflict: 'user_id,categoria_pluggy' })
  if (error) throw new Error('Não foi possível salvar.')

  const filtro = outrosId ? `categoria_id.is.null,categoria_id.eq.${outrosId}` : 'categoria_id.is.null'
  const { error: e2 } = await supabase
    .from('transacoes')
    .update({ categoria_id: categoriaId })
    .eq('origem', 'pluggy')
    .eq('categoria_pluggy', categoriaPluggy)
    .is('pagamento_cartao_id', null)
    .or(filtro)
  if (e2) throw new Error('A regra foi salva, mas não deu para atualizar as já importadas.')
}

export async function listarRegrasDeLocal() {
  const { data, error } = await supabase.from('regras_categoria_local').select('*').order('local')
  if (error) throw error
  return data as RegraLocal[]
}

// Mesmo formato da função sync-pluggy: espaços repetidos viram um, tudo minúsculo
export const normalizarLocal = (local: string) => local.replace(/\s+/g, ' ').trim().toLowerCase()

/** "As próximas importadas deste local vão para esta categoria" (e, com terceiro, entram como dessa pessoa) */
export async function salvarRegraDeLocal(local: string, categoriaId: string, terceiro: string | null = null) {
  const { error } = await supabase
    .from('regras_categoria_local')
    .upsert(
      { local: normalizarLocal(local), categoria_id: categoriaId, terceiro: terceiro?.trim() || null },
      { onConflict: 'user_id,local' },
    )
  if (error) throw new Error('Não foi possível salvar a regra.')
}

export async function excluirRegraDeLocal(id: string) {
  const { error } = await supabase.from('regras_categoria_local').delete().eq('id', id)
  if (error) throw new Error('Não foi possível excluir a regra.')
}
