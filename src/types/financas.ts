import type { Tables, TablesInsert } from './database'

// Os campos com lista fechada de valores são "check constraints" no banco, então o gerador
// os traz como string; aqui eles ficam restritos às opções válidas.
export type TipoTransacao = 'receita' | 'despesa'
export type FormaPagamento = 'debito' | 'pix' | 'dinheiro' | 'credito'
export type OrigemTransacao = 'manual' | 'pluggy'
export type TipoMovimentoCaixinha = 'deposito' | 'retirada'

export type Categoria = Tables<'categorias'>
export type Conta = Tables<'contas'>
export type Cartao = Tables<'cartoes'>
export type Assinatura = Tables<'assinaturas'>

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

export type MovimentoCaixinha = Omit<Tables<'caixinha_movimentos'>, 'tipo'> & { tipo: TipoMovimentoCaixinha }
export type NovoMovimentoCaixinha = Omit<TablesInsert<'caixinha_movimentos'>, 'tipo'> & { tipo: TipoMovimentoCaixinha }
