// Gerado a partir do banco (Supabase generate_typescript_types). Não edite à mão: gere de novo após cada migration.

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: '14.18'
  }
  public: {
    Tables: {
      acertos_pagos: {
        Row: {
          criado_em: string
          id: string
          mes: string
          pessoa: string
          user_id: string
        }
        Insert: {
          criado_em?: string
          id?: string
          mes: string
          pessoa: string
          user_id?: string
        }
        Update: {
          criado_em?: string
          id?: string
          mes?: string
          pessoa?: string
          user_id?: string
        }
        Relationships: []
      }
      assinaturas: {
        Row: {
          ativa: boolean
          cartao_id: string | null
          categoria_id: string | null
          chave: string | null
          criado_em: string
          dia_cobranca: number
          do_banco: boolean
          id: string
          nome: string
          total_parcelas: number | null
          ultimo_lancamento: string | null
          user_id: string
          valor: number
        }
        Insert: {
          ativa?: boolean
          cartao_id?: string | null
          categoria_id?: string | null
          chave?: string | null
          criado_em?: string
          dia_cobranca: number
          do_banco?: boolean
          id?: string
          nome: string
          total_parcelas?: number | null
          ultimo_lancamento?: string | null
          user_id?: string
          valor: number
        }
        Update: {
          ativa?: boolean
          cartao_id?: string | null
          categoria_id?: string | null
          chave?: string | null
          criado_em?: string
          dia_cobranca?: number
          do_banco?: boolean
          id?: string
          nome?: string
          total_parcelas?: number | null
          ultimo_lancamento?: string | null
          user_id?: string
          valor?: number
        }
        Relationships: [
          {
            foreignKeyName: 'assinaturas_cartao_id_user_id_fkey'
            columns: ['cartao_id', 'user_id']
            isOneToOne: false
            referencedRelation: 'cartoes'
            referencedColumns: ['id', 'user_id']
          },
          {
            foreignKeyName: 'assinaturas_categoria_id_user_id_fkey'
            columns: ['categoria_id', 'user_id']
            isOneToOne: false
            referencedRelation: 'categorias'
            referencedColumns: ['id', 'user_id']
          },
        ]
      }
      caixinha_movimentos: {
        Row: {
          criado_em: string
          data: string
          id: string
          motivo: string | null
          tipo: string
          transacao_id: string | null
          user_id: string
          valor: number
        }
        Insert: {
          criado_em?: string
          data?: string
          id?: string
          motivo?: string | null
          tipo: string
          transacao_id?: string | null
          user_id?: string
          valor: number
        }
        Update: {
          criado_em?: string
          data?: string
          id?: string
          motivo?: string | null
          tipo?: string
          transacao_id?: string | null
          user_id?: string
          valor?: number
        }
        Relationships: [
          {
            foreignKeyName: 'caixinha_movimentos_transacao_id_fkey'
            columns: ['transacao_id']
            isOneToOne: true
            referencedRelation: 'transacoes'
            referencedColumns: ['id']
          },
        ]
      }
      cartoes: {
        Row: {
          bandeira: string | null
          cor: string
          criado_em: string
          dia_fechamento: number
          dia_vencimento: number
          empresarial: boolean
          id: string
          limite: number
          nome: string
          pluggy_account_id: string | null
          user_id: string
        }
        Insert: {
          bandeira?: string | null
          cor?: string
          criado_em?: string
          dia_fechamento: number
          dia_vencimento: number
          empresarial?: boolean
          id?: string
          limite: number
          nome: string
          pluggy_account_id?: string | null
          user_id?: string
        }
        Update: {
          bandeira?: string | null
          cor?: string
          criado_em?: string
          dia_fechamento?: number
          dia_vencimento?: number
          empresarial?: boolean
          id?: string
          limite?: number
          nome?: string
          pluggy_account_id?: string | null
          user_id?: string
        }
        Relationships: []
      }
      categorias: {
        Row: {
          cor: string
          criado_em: string
          icone: string
          id: string
          nome: string
          user_id: string
        }
        Insert: {
          cor: string
          criado_em?: string
          icone: string
          id?: string
          nome: string
          user_id?: string
        }
        Update: {
          cor?: string
          criado_em?: string
          icone?: string
          id?: string
          nome?: string
          user_id?: string
        }
        Relationships: []
      }
      contas: {
        Row: {
          criado_em: string
          empresarial: boolean
          id: string
          nome: string
          pluggy_account_id: string | null
          saldo_inicial: number
          user_id: string
        }
        Insert: {
          criado_em?: string
          empresarial?: boolean
          id?: string
          nome: string
          pluggy_account_id?: string | null
          saldo_inicial?: number
          user_id?: string
        }
        Update: {
          criado_em?: string
          empresarial?: boolean
          id?: string
          nome?: string
          pluggy_account_id?: string | null
          saldo_inicial?: number
          user_id?: string
        }
        Relationships: []
      }
      cotacoes: {
        Row: {
          atualizado_em: string
          cotado_em: string | null
          nome: string | null
          preco: number
          ticker: string
          variacao_dia: number | null
        }
        Insert: {
          atualizado_em?: string
          cotado_em?: string | null
          nome?: string | null
          preco: number
          ticker: string
          variacao_dia?: number | null
        }
        Update: {
          atualizado_em?: string
          cotado_em?: string | null
          nome?: string | null
          preco?: number
          ticker?: string
          variacao_dia?: number | null
        }
        Relationships: []
      }
      expectativas: {
        Row: {
          ano: number
          data_coleta: string
          indicador: string
          mediana: number
        }
        Insert: {
          ano: number
          data_coleta: string
          indicador: string
          mediana: number
        }
        Update: {
          ano?: number
          data_coleta?: string
          indicador?: string
          mediana?: number
        }
        Relationships: []
      }
      ia_uso: {
        Row: {
          atualizado_em: string
          chamadas: number
          custo_usd: number
          limite_usd: number | null
          mes: string
          tokens_entrada: number
          tokens_saida: number
        }
        Insert: {
          atualizado_em?: string
          chamadas?: number
          custo_usd?: number
          limite_usd?: number | null
          mes: string
          tokens_entrada?: number
          tokens_saida?: number
        }
        Update: {
          atualizado_em?: string
          chamadas?: number
          custo_usd?: number
          limite_usd?: number | null
          mes?: string
          tokens_entrada?: number
          tokens_saida?: number
        }
        Relationships: []
      }
      indicadores: {
        Row: {
          dia: string
          gravado_em: string
          serie: string
          valor: number
        }
        Insert: {
          dia: string
          gravado_em?: string
          serie: string
          valor: number
        }
        Update: {
          dia?: string
          gravado_em?: string
          serie?: string
          valor?: number
        }
        Relationships: []
      }
      investimentos: {
        Row: {
          atualizado_em: string
          codigo: string | null
          criado_em: string
          emissor: string | null
          empresarial: boolean
          id: string
          id_externo: string | null
          indexador: string | null
          instituicao: string | null
          nome: string
          observacao: string | null
          origem: string
          quantidade: number | null
          saldo_bruto: number
          saldo_liquido: number | null
          status: string
          subtipo: string | null
          taxa: number | null
          taxa_anual_fixa: number | null
          tipo: string
          user_id: string
          valor_aplicado: number | null
          vencimento: string | null
        }
        Insert: {
          atualizado_em?: string
          codigo?: string | null
          criado_em?: string
          emissor?: string | null
          empresarial?: boolean
          id?: string
          id_externo?: string | null
          indexador?: string | null
          instituicao?: string | null
          nome: string
          observacao?: string | null
          origem?: string
          quantidade?: number | null
          saldo_bruto?: number
          saldo_liquido?: number | null
          status?: string
          subtipo?: string | null
          taxa?: number | null
          taxa_anual_fixa?: number | null
          tipo: string
          user_id?: string
          valor_aplicado?: number | null
          vencimento?: string | null
        }
        Update: {
          atualizado_em?: string
          codigo?: string | null
          criado_em?: string
          emissor?: string | null
          empresarial?: boolean
          id?: string
          id_externo?: string | null
          indexador?: string | null
          instituicao?: string | null
          nome?: string
          observacao?: string | null
          origem?: string
          quantidade?: number | null
          saldo_bruto?: number
          saldo_liquido?: number | null
          status?: string
          subtipo?: string | null
          taxa?: number | null
          taxa_anual_fixa?: number | null
          tipo?: string
          user_id?: string
          valor_aplicado?: number | null
          vencimento?: string | null
        }
        Relationships: []
      }
      investimentos_historico: {
        Row: {
          dia: string
          investimento_id: string
          saldo_bruto: number
          saldo_liquido: number | null
          user_id: string
        }
        Insert: {
          dia: string
          investimento_id: string
          saldo_bruto: number
          saldo_liquido?: number | null
          user_id?: string
        }
        Update: {
          dia?: string
          investimento_id?: string
          saldo_bruto?: number
          saldo_liquido?: number | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: 'investimentos_historico_investimento_id_fkey'
            columns: ['investimento_id']
            isOneToOne: false
            referencedRelation: 'investimentos'
            referencedColumns: ['id']
          },
        ]
      }
      mapeamento_categorias: {
        Row: {
          categoria_id: string
          categoria_pluggy: string
          criado_em: string
          id: string
          user_id: string
        }
        Insert: {
          categoria_id: string
          categoria_pluggy: string
          criado_em?: string
          id?: string
          user_id?: string
        }
        Update: {
          categoria_id?: string
          categoria_pluggy?: string
          criado_em?: string
          id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: 'mapeamento_categorias_categoria_id_user_id_fkey'
            columns: ['categoria_id', 'user_id']
            isOneToOne: false
            referencedRelation: 'categorias'
            referencedColumns: ['id', 'user_id']
          },
        ]
      }
      noticias: {
        Row: {
          classificacao: Json | null
          criada_em: string
          fonte: string | null
          id: string
          link: string
          publicada_em: string
          relevancia: number | null
          temas: string[]
          tickers: string[]
          titulo: string
        }
        Insert: {
          classificacao?: Json | null
          criada_em?: string
          fonte?: string | null
          id: string
          link: string
          publicada_em: string
          relevancia?: number | null
          temas?: string[]
          tickers?: string[]
          titulo: string
        }
        Update: {
          classificacao?: Json | null
          criada_em?: string
          fonte?: string | null
          id?: string
          link?: string
          publicada_em?: string
          relevancia?: number | null
          temas?: string[]
          tickers?: string[]
          titulo?: string
        }
        Relationships: []
      }
      notificacoes_enviadas: {
        Row: {
          chave: string
          corpo: string
          enviada_em: string
          id: number
          tipo: string
          titulo: string
          url: string | null
          user_id: string
        }
        Insert: {
          chave: string
          corpo: string
          enviada_em?: string
          id?: never
          tipo: string
          titulo: string
          url?: string | null
          user_id: string
        }
        Update: {
          chave?: string
          corpo?: string
          enviada_em?: string
          id?: never
          tipo?: string
          titulo?: string
          url?: string | null
          user_id?: string
        }
        Relationships: []
      }
      notificacoes_preferencias: {
        Row: {
          atualizado_em: string
          desligadas: string[]
          user_id: string
        }
        Insert: {
          atualizado_em?: string
          desligadas?: string[]
          user_id?: string
        }
        Update: {
          atualizado_em?: string
          desligadas?: string[]
          user_id?: string
        }
        Relationships: []
      }
      perfis: {
        Row: {
          caixinha_contar_desde: string | null
          caixinha_saldo_inicial: number
          criado_em: string
          email: string
          id: string
          meta_caixinha: number | null
          nome: string
        }
        Insert: {
          caixinha_contar_desde?: string | null
          caixinha_saldo_inicial?: number
          criado_em?: string
          email: string
          id: string
          meta_caixinha?: number | null
          nome: string
        }
        Update: {
          caixinha_contar_desde?: string | null
          caixinha_saldo_inicial?: number
          criado_em?: string
          email?: string
          id?: string
          meta_caixinha?: number | null
          nome?: string
        }
        Relationships: []
      }
      pluggy_conexoes: {
        Row: {
          atualizado_no_banco_em: string | null
          banco: string
          consentimento_expira_em: string | null
          erro: string | null
          item_id: string
          status: string
          user_id: string
          verificado_em: string
        }
        Insert: {
          atualizado_no_banco_em?: string | null
          banco: string
          consentimento_expira_em?: string | null
          erro?: string | null
          item_id: string
          status: string
          user_id?: string
          verificado_em?: string
        }
        Update: {
          atualizado_no_banco_em?: string | null
          banco?: string
          consentimento_expira_em?: string | null
          erro?: string | null
          item_id?: string
          status?: string
          user_id?: string
          verificado_em?: string
        }
        Relationships: []
      }
      pluggy_contas: {
        Row: {
          atualizado_em: string
          banco: string | null
          bandeira: string | null
          dia_fechamento: number | null
          dia_vencimento: number | null
          id: string
          item_id: string
          limite: number | null
          nome: string
          numero: string | null
          saldo: number | null
          tipo: string
          user_id: string
        }
        Insert: {
          atualizado_em?: string
          banco?: string | null
          bandeira?: string | null
          dia_fechamento?: number | null
          dia_vencimento?: number | null
          id: string
          item_id: string
          limite?: number | null
          nome: string
          numero?: string | null
          saldo?: number | null
          tipo: string
          user_id?: string
        }
        Update: {
          atualizado_em?: string
          banco?: string | null
          bandeira?: string | null
          dia_fechamento?: number | null
          dia_vencimento?: number | null
          id?: string
          item_id?: string
          limite?: number | null
          nome?: string
          numero?: string | null
          saldo?: number | null
          tipo?: string
          user_id?: string
        }
        Relationships: []
      }
      push_inscricoes: {
        Row: {
          auth: string
          criado_em: string
          dispositivo: string | null
          endpoint: string
          id: string
          p256dh: string
          user_id: string
        }
        Insert: {
          auth: string
          criado_em?: string
          dispositivo?: string | null
          endpoint: string
          id?: string
          p256dh: string
          user_id?: string
        }
        Update: {
          auth?: string
          criado_em?: string
          dispositivo?: string | null
          endpoint?: string
          id?: string
          p256dh?: string
          user_id?: string
        }
        Relationships: []
      }
      receitas_previstas: {
        Row: {
          criado_em: string
          dia: number
          id: string
          nome: string
          user_id: string
          valor: number
        }
        Insert: {
          criado_em?: string
          dia: number
          id?: string
          nome: string
          user_id?: string
          valor: number
        }
        Update: {
          criado_em?: string
          dia?: number
          id?: string
          nome?: string
          user_id?: string
          valor?: number
        }
        Relationships: []
      }
      regras_categoria_local: {
        Row: {
          categoria_id: string
          criado_em: string
          id: string
          local: string
          terceiro: string | null
          user_id: string
        }
        Insert: {
          categoria_id: string
          criado_em?: string
          id?: string
          local: string
          terceiro?: string | null
          user_id?: string
        }
        Update: {
          categoria_id?: string
          criado_em?: string
          id?: string
          local?: string
          terceiro?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: 'regras_categoria_local_categoria_id_user_id_fkey'
            columns: ['categoria_id', 'user_id']
            isOneToOne: false
            referencedRelation: 'categorias'
            referencedColumns: ['id', 'user_id']
          },
        ]
      }
      sinais: {
        Row: {
          ativo: string | null
          classe: string
          confirma: string | null
          criado_em: string
          dia: string
          direcao: string | null
          embutido: string | null
          id: string
          invalida: string | null
          noticias: string[]
          objetivo: string | null
          origem: string
          pct_max: number | null
          perda_contraria_pct: number | null
          prazo_dias: number | null
          relevancia: number | null
          risco: string | null
          tese: string
          titulo: string
        }
        Insert: {
          ativo?: string | null
          classe: string
          confirma?: string | null
          criado_em?: string
          dia: string
          direcao?: string | null
          embutido?: string | null
          id?: string
          invalida?: string | null
          noticias?: string[]
          objetivo?: string | null
          origem: string
          pct_max?: number | null
          perda_contraria_pct?: number | null
          prazo_dias?: number | null
          relevancia?: number | null
          risco?: string | null
          tese: string
          titulo: string
        }
        Update: {
          ativo?: string | null
          classe?: string
          confirma?: string | null
          criado_em?: string
          dia?: string
          direcao?: string | null
          embutido?: string | null
          id?: string
          invalida?: string | null
          noticias?: string[]
          objetivo?: string | null
          origem?: string
          pct_max?: number | null
          perda_contraria_pct?: number | null
          prazo_dias?: number | null
          relevancia?: number | null
          risco?: string | null
          tese?: string
          titulo?: string
        }
        Relationships: []
      }
      sync_log: {
        Row: {
          atualizadas: number
          data: string
          id: string
          importadas: number
          mensagem: string | null
          status: string
          user_id: string
        }
        Insert: {
          atualizadas?: number
          data?: string
          id?: string
          importadas?: number
          mensagem?: string | null
          status: string
          user_id?: string
        }
        Update: {
          atualizadas?: number
          data?: string
          id?: string
          importadas?: number
          mensagem?: string | null
          status?: string
          user_id?: string
        }
        Relationships: []
      }
      teses: {
        Row: {
          ativo: string | null
          criada_em: string
          decisao: string
          dia: string
          direcao: string | null
          fechada_em: string | null
          id: string
          prazo_dias: number | null
          preco_entrada: number | null
          preco_final: number | null
          resultado: string | null
          sinal_id: string | null
          titulo: string
          user_id: string
          valor: number | null
        }
        Insert: {
          ativo?: string | null
          criada_em?: string
          decisao: string
          dia?: string
          direcao?: string | null
          fechada_em?: string | null
          id?: string
          prazo_dias?: number | null
          preco_entrada?: number | null
          preco_final?: number | null
          resultado?: string | null
          sinal_id?: string | null
          titulo: string
          user_id?: string
          valor?: number | null
        }
        Update: {
          ativo?: string | null
          criada_em?: string
          decisao?: string
          dia?: string
          direcao?: string | null
          fechada_em?: string | null
          id?: string
          prazo_dias?: number | null
          preco_entrada?: number | null
          preco_final?: number | null
          resultado?: string | null
          sinal_id?: string | null
          titulo?: string
          user_id?: string
          valor?: number | null
        }
        Relationships: [
          {
            foreignKeyName: 'teses_sinal_id_fkey'
            columns: ['sinal_id']
            isOneToOne: false
            referencedRelation: 'sinais'
            referencedColumns: ['id']
          },
        ]
      }
      transacoes: {
        Row: {
          movimentacao_id: number | null
          acerto_mes: string | null
          assinatura_id: string | null
          caixinha: boolean
          cartao_id: string | null
          categoria_id: string | null
          categoria_pluggy: string | null
          conta_id: string | null
          criado_em: string
          data: string
          descricao: string | null
          dividida_de: string | null
          emprestimo: boolean
          fatura: string | null
          forma: string
          grupo_parcela: string | null
          id: string
          id_externo: string | null
          local: string | null
          observacao: string | null
          origem: string
          pagamento_cartao_id: string | null
          pagamento_fatura: string | null
          parcela_atual: number | null
          terceiro: string | null
          tipo: string
          total_parcelas: number | null
          transferencia_interna: boolean
          user_id: string
          valor: number
        }
        Insert: {
          movimentacao_id?: number | null
          acerto_mes?: string | null
          assinatura_id?: string | null
          caixinha?: boolean
          cartao_id?: string | null
          categoria_id?: string | null
          categoria_pluggy?: string | null
          conta_id?: string | null
          criado_em?: string
          data?: string
          descricao?: string | null
          dividida_de?: string | null
          emprestimo?: boolean
          fatura?: string | null
          forma: string
          grupo_parcela?: string | null
          id?: string
          id_externo?: string | null
          local?: string | null
          observacao?: string | null
          origem?: string
          pagamento_cartao_id?: string | null
          pagamento_fatura?: string | null
          parcela_atual?: number | null
          terceiro?: string | null
          tipo: string
          total_parcelas?: number | null
          transferencia_interna?: boolean
          user_id?: string
          valor: number
        }
        Update: {
          movimentacao_id?: number | null
          acerto_mes?: string | null
          assinatura_id?: string | null
          caixinha?: boolean
          cartao_id?: string | null
          categoria_id?: string | null
          categoria_pluggy?: string | null
          conta_id?: string | null
          criado_em?: string
          data?: string
          descricao?: string | null
          dividida_de?: string | null
          emprestimo?: boolean
          fatura?: string | null
          forma?: string
          grupo_parcela?: string | null
          id?: string
          id_externo?: string | null
          local?: string | null
          observacao?: string | null
          origem?: string
          pagamento_cartao_id?: string | null
          pagamento_fatura?: string | null
          parcela_atual?: number | null
          terceiro?: string | null
          tipo?: string
          total_parcelas?: number | null
          transferencia_interna?: boolean
          user_id?: string
          valor?: number
        }
        Relationships: [
          {
            foreignKeyName: 'transacoes_movimentacao_id_fkey'
            columns: ['movimentacao_id']
            isOneToOne: true
            referencedRelation: 'movimentacoes'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'transacoes_assinatura_id_user_id_fkey'
            columns: ['assinatura_id', 'user_id']
            isOneToOne: false
            referencedRelation: 'assinaturas'
            referencedColumns: ['id', 'user_id']
          },
          {
            foreignKeyName: 'transacoes_cartao_id_user_id_fkey'
            columns: ['cartao_id', 'user_id']
            isOneToOne: false
            referencedRelation: 'cartoes'
            referencedColumns: ['id', 'user_id']
          },
          {
            foreignKeyName: 'transacoes_categoria_id_user_id_fkey'
            columns: ['categoria_id', 'user_id']
            isOneToOne: false
            referencedRelation: 'categorias'
            referencedColumns: ['id', 'user_id']
          },
          {
            foreignKeyName: 'transacoes_conta_id_user_id_fkey'
            columns: ['conta_id', 'user_id']
            isOneToOne: false
            referencedRelation: 'contas'
            referencedColumns: ['id', 'user_id']
          },
          {
            foreignKeyName: 'transacoes_dividida_de_fkey'
            columns: ['dividida_de']
            isOneToOne: false
            referencedRelation: 'transacoes'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'transacoes_pagamento_cartao_id_user_id_fkey'
            columns: ['pagamento_cartao_id', 'user_id']
            isOneToOne: false
            referencedRelation: 'cartoes'
            referencedColumns: ['id', 'user_id']
          },
        ]
      }
      transacoes_ignoradas: {
        Row: {
          excluida_em: string
          id_externo: string
          user_id: string
        }
        Insert: {
          excluida_em?: string
          id_externo: string
          user_id?: string
        }
        Update: {
          excluida_em?: string
          id_externo?: string
          user_id?: string
        }
        Relationships: []
      }
      ativos: {
        Row: { ticker: string; nome: string | null; classe: string; setor: string | null; validado: boolean; invalido: boolean; conferido: string | null }
        Insert: { ticker: string; nome?: string | null; classe?: string; setor?: string | null; validado?: boolean; invalido?: boolean; conferido?: string | null }
        Update: { ticker?: string; nome?: string | null; classe?: string; setor?: string | null; validado?: boolean; invalido?: boolean; conferido?: string | null }
        Relationships: []
      }
      movimentacoes: {
        Row: { id: number; tipo: string; ticker: string; shares: number; preco: number; taxas: number; data: string; origem: string; nota: string | null; criado: string }
        Insert: { id?: number; tipo: string; ticker: string; shares: number; preco: number; taxas?: number; data?: string; origem: string; nota?: string | null; criado?: string }
        Update: { id?: number; tipo?: string; ticker?: string; shares?: number; preco?: number; taxas?: number; data?: string; origem?: string; nota?: string | null; criado?: string }
        Relationships: [{ foreignKeyName: "movimentacoes_ticker_fkey"; columns: ["ticker"]; isOneToOne: false; referencedRelation: "ativos"; referencedColumns: ["ticker"] }]
      }
      posicoes: {
        Row: { ticker: string; shares: number; avg_price: number | null; custo_total: number; pnl_realizado: number; atualizado: string }
        Insert: { ticker: string; shares: number; avg_price?: number | null; custo_total?: number; pnl_realizado?: number; atualizado?: string }
        Update: { ticker?: string; shares?: number; avg_price?: number | null; custo_total?: number; pnl_realizado?: number; atualizado?: string }
        Relationships: [{ foreignKeyName: "posicoes_ticker_fkey"; columns: ["ticker"]; isOneToOne: true; referencedRelation: "ativos"; referencedColumns: ["ticker"] }]
      }
      perfil_investidor: {
        Row: { id: number; respostas: Json; derivado: Json; atualizado: string }
        Insert: { id?: number; respostas: Json; derivado: Json; atualizado?: string }
        Update: { id?: number; respostas?: Json; derivado?: Json; atualizado?: string }
        Relationships: []
      }
      snapshots: {
        Row: { id: number; gerado_em: string; payload: Json }
        Insert: { id?: number; gerado_em?: string; payload: Json }
        Update: { id?: number; gerado_em?: string; payload?: Json }
        Relationships: []
      }
      jobs: {
        Row: { id: number; tipo: string; estado: string; pedido: Json; resultado: Json | null; criado: string; fechado: string | null }
        Insert: { id?: number; tipo: string; estado?: string; pedido?: Json; resultado?: Json | null; criado?: string; fechado?: string | null }
        Update: { id?: number; tipo?: string; estado?: string; pedido?: Json; resultado?: Json | null; criado?: string; fechado?: string | null }
        Relationships: []
      }
      planos: {
        Row: { id: number; gerado_em: string; payload: Json; aceito_em: string | null }
        Insert: { id?: number; gerado_em?: string; payload: Json; aceito_em?: string | null }
        Update: { id?: number; gerado_em?: string; payload?: Json; aceito_em?: string | null }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      cadastro_disponivel: { Args: never; Returns: boolean }
      criar_categorias_padrao: {
        Args: { p_user_id: string }
        Returns: undefined
      }
      desfazer_divisao: { Args: { p_id: string }; Returns: undefined }
      dividir_transacao: {
        Args: { p_id: string; p_partes: Json }
        Returns: {
            acerto_mes: string | null
            assinatura_id: string | null
            caixinha: boolean
            cartao_id: string | null
            categoria_id: string | null
            categoria_pluggy: string | null
            conta_id: string | null
            criado_em: string
            data: string
            descricao: string | null
            dividida_de: string | null
            emprestimo: boolean
            fatura: string | null
            forma: string
            grupo_parcela: string | null
            id: string
            id_externo: string | null
            local: string | null
            observacao: string | null
            origem: string
            pagamento_cartao_id: string | null
            pagamento_fatura: string | null
            parcela_atual: number | null
            terceiro: string | null
            tipo: string
            total_parcelas: number | null
            transferencia_interna: boolean
            user_id: string
            valor: number
        }[]
        SetofOptions: {
          from: '*'
          to: 'transacoes'
          isOneToOne: false
          isSetofReturn: true
        }
      }
      lancar_assinaturas_pendentes: { Args: never; Returns: number }
      limite_usado_cartoes: {
        Args: never
        Returns: {
          cartao_id: string
          usado: number
        }[]
      }
      mes_da_fatura: {
        Args: { p_data: string; p_fechamento: number; p_vencimento: number }
        Returns: string
      }
      registrar_uso_ia: {
        Args: { p_custo: number; p_entrada: number; p_limite: number; p_saida: number }
        Returns: number
      }
      saldo_atual: { Args: never; Returns: number }
      saldo_em: {
        Args: { p_dia: string; p_empresarial?: boolean }
        Returns: number
      }
      ultimos_dias_indicadores: {
        Args: never
        Returns: {
          dia: string
          gravado_em: string
          serie: string
        }[]
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, 'public'>]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    keyof (DefaultSchema['Tables'] & DefaultSchema['Views']) | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Views'])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Views'])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema['Tables'] & DefaultSchema['Views'])
    ? (DefaultSchema['Tables'] & DefaultSchema['Views'])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables'] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
    ? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables'] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
    ? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema['Enums'] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions['schema']]['Enums']
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions['schema']]['Enums'][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema['Enums']
    ? DefaultSchema['Enums'][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends keyof DefaultSchema['CompositeTypes'] | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions['schema']]['CompositeTypes']
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions['schema']]['CompositeTypes'][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema['CompositeTypes']
    ? DefaultSchema['CompositeTypes'][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
