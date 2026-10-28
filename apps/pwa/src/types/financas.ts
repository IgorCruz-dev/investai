import type { Tables, TablesInsert } from './database'

// Os campos com lista fechada de valores são "check constraints" no banco, então o gerador
// os traz como string; aqui eles ficam restritos às opções válidas.
export type TipoTransacao = 'receita' | 'despesa'
export type FormaPagamento = 'debito' | 'pix' | 'dinheiro' | 'credito'
export type OrigemTransacao = 'manual' | 'pluggy' | 'investimento'
export type TipoMovimentoCaixinha = 'deposito' | 'retirada'

export type Categoria = Tables<'categorias'>
export type Conta = Tables<'contas'>
export type Cartao = Tables<'cartoes'>
export type NovoCartao = Pick<
  TablesInsert<'cartoes'>,
  'nome' | 'bandeira' | 'limite' | 'dia_fechamento' | 'dia_vencimento' | 'cor'
>
export type Assinatura = Tables<'assinaturas'>
export type NovaAssinatura = Pick<
  TablesInsert<'assinaturas'>,
  'nome' | 'valor' | 'dia_cobranca' | 'cartao_id' | 'ultimo_lancamento' | 'total_parcelas'
>
export type ReceitaPrevista = Tables<'receitas_previstas'>
export type NovaReceitaPrevista = Pick<TablesInsert<'receitas_previstas'>, 'nome' | 'valor' | 'dia'>

export type Transacao = Omit<Tables<'transacoes'>, 'tipo' | 'forma' | 'origem'> & {
  tipo: TipoTransacao
  forma: FormaPagamento
  origem: OrigemTransacao
}
export type NovaTransacao = Omit<TablesInsert<'transacoes'>, 'tipo' | 'forma' | 'origem'> & {
  tipo: TipoTransacao
  forma: FormaPagamento
  origem?: OrigemTransacao
}

/** Mês de acerto que a pessoa pagou por fora, marcado à mão na tela de Acertos */
export type AcertoPago = Tables<'acertos_pagos'>

export type MovimentoCaixinha = Omit<Tables<'caixinha_movimentos'>, 'tipo'> & { tipo: TipoMovimentoCaixinha }

// Open Finance (Meu Pluggy)
export type ConexaoPluggy = Tables<'pluggy_conexoes'>
export type ContaPluggy = Omit<Tables<'pluggy_contas'>, 'tipo'> & { tipo: 'BANK' | 'CREDIT' }
export type MapeamentoCategoria = Tables<'mapeamento_categorias'>
export type RegraLocal = Tables<'regras_categoria_local'>
export type SyncLog = Omit<Tables<'sync_log'>, 'status'> & { status: 'sucesso' | 'parcial' | 'erro' }
