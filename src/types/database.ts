// Gerado a partir do banco (Supabase generate_typescript_types). Não edite à mão: gere de novo após cada migration.

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.18"
  }
  public: {
    Tables: {
      assinaturas: {
        Row: {
          ativa: boolean
          cartao_id: string | null
          categoria_id: string | null
          criado_em: string
          dia_cobranca: number
          id: string
          nome: string
          ultimo_lancamento: string | null
          user_id: string
          valor: number
        }
        Insert: {
          ativa?: boolean
          cartao_id?: string | null
          categoria_id?: string | null
          criado_em?: string
          dia_cobranca: number
          id?: string
          nome: string
          ultimo_lancamento?: string | null
          user_id?: string
          valor: number
        }
        Update: {
          ativa?: boolean
          cartao_id?: string | null
          categoria_id?: string | null
          criado_em?: string
          dia_cobranca?: number
          id?: string
          nome?: string
          ultimo_lancamento?: string | null
          user_id?: string
          valor?: number
        }
        Relationships: [
          {
            foreignKeyName: "assinaturas_cartao_id_user_id_fkey"
            columns: ["cartao_id", "user_id"]
            isOneToOne: false
            referencedRelation: "cartoes"
            referencedColumns: ["id", "user_id"]
          },
          {
            foreignKeyName: "assinaturas_categoria_id_user_id_fkey"
            columns: ["categoria_id", "user_id"]
            isOneToOne: false
            referencedRelation: "categorias"
            referencedColumns: ["id", "user_id"]
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
          user_id: string
          valor: number
        }
        Insert: {
          criado_em?: string
          data?: string
          id?: string
          motivo?: string | null
          tipo: string
          user_id?: string
          valor: number
        }
        Update: {
          criado_em?: string
          data?: string
          id?: string
          motivo?: string | null
          tipo?: string
          user_id?: string
          valor?: number
        }
        Relationships: []
      }
      cartoes: {
        Row: {
          bandeira: string | null
          cor: string
          criado_em: string
          dia_fechamento: number
          dia_vencimento: number
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
          id: string
          nome: string
          pluggy_account_id: string | null
          saldo_inicial: number
          user_id: string
        }
        Insert: {
          criado_em?: string
          id?: string
          nome: string
          pluggy_account_id?: string | null
          saldo_inicial?: number
          user_id?: string
        }
        Update: {
          criado_em?: string
          id?: string
          nome?: string
          pluggy_account_id?: string | null
          saldo_inicial?: number
          user_id?: string
        }
        Relationships: []
      }
      perfis: {
        Row: {
          criado_em: string
          email: string
          id: string
          nome: string
        }
        Insert: {
          criado_em?: string
          email: string
          id: string
          nome: string
        }
        Update: {
          criado_em?: string
          email?: string
          id?: string
          nome?: string
        }
        Relationships: []
      }
      transacoes: {
        Row: {
          assinatura_id: string | null
          cartao_id: string | null
          categoria_id: string | null
          conta_id: string | null
          criado_em: string
          data: string
          descricao: string | null
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
          tipo: string
          total_parcelas: number | null
          user_id: string
          valor: number
        }
        Insert: {
          assinatura_id?: string | null
          cartao_id?: string | null
          categoria_id?: string | null
          conta_id?: string | null
          criado_em?: string
          data?: string
          descricao?: string | null
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
          tipo: string
          total_parcelas?: number | null
          user_id?: string
          valor: number
        }
        Update: {
          assinatura_id?: string | null
          cartao_id?: string | null
          categoria_id?: string | null
          conta_id?: string | null
          criado_em?: string
          data?: string
          descricao?: string | null
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
          tipo?: string
          total_parcelas?: number | null
          user_id?: string
          valor?: number
        }
        Relationships: [
          {
            foreignKeyName: "transacoes_assinatura_id_user_id_fkey"
            columns: ["assinatura_id", "user_id"]
            isOneToOne: false
            referencedRelation: "assinaturas"
            referencedColumns: ["id", "user_id"]
          },
          {
            foreignKeyName: "transacoes_cartao_id_user_id_fkey"
            columns: ["cartao_id", "user_id"]
            isOneToOne: false
            referencedRelation: "cartoes"
            referencedColumns: ["id", "user_id"]
          },
          {
            foreignKeyName: "transacoes_categoria_id_user_id_fkey"
            columns: ["categoria_id", "user_id"]
            isOneToOne: false
            referencedRelation: "categorias"
            referencedColumns: ["id", "user_id"]
          },
          {
            foreignKeyName: "transacoes_conta_id_user_id_fkey"
            columns: ["conta_id", "user_id"]
            isOneToOne: false
            referencedRelation: "contas"
            referencedColumns: ["id", "user_id"]
          },
          {
            foreignKeyName: "transacoes_pagamento_cartao_id_user_id_fkey"
            columns: ["pagamento_cartao_id", "user_id"]
            isOneToOne: false
            referencedRelation: "cartoes"
            referencedColumns: ["id", "user_id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      criar_categorias_padrao: {
        Args: { p_user_id: string }
        Returns: undefined
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
      saldo_atual: { Args: never; Returns: number }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
