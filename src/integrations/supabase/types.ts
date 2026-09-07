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
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      channel_counters: {
        Row: {
          channel: string
          daily_limit: number
          date: string
          id: string
          last_updated: string
          sent_count: number
        }
        Insert: {
          channel: string
          daily_limit?: number
          date?: string
          id?: string
          last_updated?: string
          sent_count?: number
        }
        Update: {
          channel?: string
          daily_limit?: number
          date?: string
          id?: string
          last_updated?: string
          sent_count?: number
        }
        Relationships: []
      }
      clients: {
        Row: {
          ar_owner: string | null
          branches: string | null
          client_name: string
          collection_amount: number
          created_at: string
          credit_limit: number | null
          credit_terms: string | null
          due_date: string | null
          email: string | null
          external_id: string | null
          gmail_available: boolean
          id: string
          invoice_numbers: string | null
          messenger_available: boolean
          parent_name: string | null
          phone: string | null
          sms_available: boolean
          source: string | null
          status: string
          suppression_reason: string | null
          updated_at: string
          viber_available: boolean
          voice_available: boolean
          whatsapp_available: boolean
        }
        Insert: {
          ar_owner?: string | null
          branches?: string | null
          client_name: string
          collection_amount?: number
          created_at?: string
          credit_limit?: number | null
          credit_terms?: string | null
          due_date?: string | null
          email?: string | null
          external_id?: string | null
          gmail_available?: boolean
          id?: string
          invoice_numbers?: string | null
          messenger_available?: boolean
          parent_name?: string | null
          phone?: string | null
          sms_available?: boolean
          source?: string | null
          status?: string
          suppression_reason?: string | null
          updated_at?: string
          viber_available?: boolean
          voice_available?: boolean
          whatsapp_available?: boolean
        }
        Update: {
          ar_owner?: string | null
          branches?: string | null
          client_name?: string
          collection_amount?: number
          created_at?: string
          credit_limit?: number | null
          credit_terms?: string | null
          due_date?: string | null
          email?: string | null
          external_id?: string | null
          gmail_available?: boolean
          id?: string
          invoice_numbers?: string | null
          messenger_available?: boolean
          parent_name?: string | null
          phone?: string | null
          sms_available?: boolean
          source?: string | null
          status?: string
          suppression_reason?: string | null
          updated_at?: string
          viber_available?: boolean
          voice_available?: boolean
          whatsapp_available?: boolean
        }
        Relationships: []
      }
      daily_run_logs: {
        Row: {
          email_only_amount: number
          email_only_count: number
          email_queued: number
          id: string
          no_contact_amount: number
          no_contact_count: number
          run_date: string
          run_timestamp: string
          skipped_cooldown: number
          sms_queued: number
          summary_text: string | null
          total_outstanding: number
          total_processed: number
          viber_queued: number
          voice_queued: number
          whatsapp_queued: number
        }
        Insert: {
          email_only_amount?: number
          email_only_count?: number
          email_queued?: number
          id?: string
          no_contact_amount?: number
          no_contact_count?: number
          run_date: string
          run_timestamp?: string
          skipped_cooldown?: number
          sms_queued?: number
          summary_text?: string | null
          total_outstanding?: number
          total_processed?: number
          viber_queued?: number
          voice_queued?: number
          whatsapp_queued?: number
        }
        Update: {
          email_only_amount?: number
          email_only_count?: number
          email_queued?: number
          id?: string
          no_contact_amount?: number
          no_contact_count?: number
          run_date?: string
          run_timestamp?: string
          skipped_cooldown?: number
          sms_queued?: number
          summary_text?: string | null
          total_outstanding?: number
          total_processed?: number
          viber_queued?: number
          voice_queued?: number
          whatsapp_queued?: number
        }
        Relationships: []
      }
      messages: {
        Row: {
          agent_name: string | null
          assistant_id: string | null
          body: string | null
          channel: string
          client_id: string | null
          created_at: string
          direction: string
          duration_seconds: number | null
          error_message: string | null
          has_attachment: boolean
          id: string
          is_fallback: boolean
          notified_ar: boolean
          occurred_at: string
          promise_recorded: boolean
          provider: string | null
          provider_message_id: string | null
          recording_url: string | null
          status: string
          subject: string | null
          transcript: string | null
          turn_id: string | null
        }
        Insert: {
          agent_name?: string | null
          assistant_id?: string | null
          body?: string | null
          channel: string
          client_id?: string | null
          created_at?: string
          direction?: string
          duration_seconds?: number | null
          error_message?: string | null
          has_attachment?: boolean
          id?: string
          is_fallback?: boolean
          notified_ar?: boolean
          occurred_at?: string
          promise_recorded?: boolean
          provider?: string | null
          provider_message_id?: string | null
          recording_url?: string | null
          status?: string
          subject?: string | null
          transcript?: string | null
          turn_id?: string | null
        }
        Update: {
          agent_name?: string | null
          assistant_id?: string | null
          body?: string | null
          channel?: string
          client_id?: string | null
          created_at?: string
          direction?: string
          duration_seconds?: number | null
          error_message?: string | null
          has_attachment?: boolean
          id?: string
          is_fallback?: boolean
          notified_ar?: boolean
          occurred_at?: string
          promise_recorded?: boolean
          provider?: string | null
          provider_message_id?: string | null
          recording_url?: string | null
          status?: string
          subject?: string | null
          transcript?: string | null
          turn_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "messages_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      reminder_queue: {
        Row: {
          attempted_date: string | null
          client_id: string | null
          client_name: string | null
          collection_amount: number
          created_at: string
          created_date: string
          due_date: string | null
          external_id: string | null
          fallback_channel: string | null
          fallback_status: string | null
          id: string
          invoice_numbers: string | null
          preferred_channel: string
          queue_status: string
          sent_date: string | null
          source: string | null
        }
        Insert: {
          attempted_date?: string | null
          client_id?: string | null
          client_name?: string | null
          collection_amount?: number
          created_at?: string
          created_date?: string
          due_date?: string | null
          external_id?: string | null
          fallback_channel?: string | null
          fallback_status?: string | null
          id?: string
          invoice_numbers?: string | null
          preferred_channel: string
          queue_status?: string
          sent_date?: string | null
          source?: string | null
        }
        Update: {
          attempted_date?: string | null
          client_id?: string | null
          client_name?: string | null
          collection_amount?: number
          created_at?: string
          created_date?: string
          due_date?: string | null
          external_id?: string | null
          fallback_channel?: string | null
          fallback_status?: string | null
          id?: string
          invoice_numbers?: string | null
          preferred_channel?: string
          queue_status?: string
          sent_date?: string | null
          source?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "reminder_queue_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
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
