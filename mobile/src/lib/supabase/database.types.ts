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
      admin_audit_logs: {
        Row: {
          action: string
          actor_user_id: string | null
          created_at: string
          entity_id: string
          entity_type: string
          id: string
          summary: Json
        }
        Insert: {
          action: string
          actor_user_id?: string | null
          created_at?: string
          entity_id: string
          entity_type: string
          id?: string
          summary?: Json
        }
        Update: {
          action?: string
          actor_user_id?: string | null
          created_at?: string
          entity_id?: string
          entity_type?: string
          id?: string
          summary?: Json
        }
        Relationships: []
      }
      brands: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          logo_url: string | null
          name: string
          normalized_name: string
          slug: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          logo_url?: string | null
          name: string
          normalized_name: string
          slug?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          logo_url?: string | null
          name?: string
          normalized_name?: string
          slug?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      categories: {
        Row: {
          created_at: string
          id: string
          image_url: string | null
          is_pickable: boolean
          is_visible: boolean
          name: string
          parent_id: string | null
          ranking_min_sample: number
          slug: string
          sort_order: number
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          image_url?: string | null
          is_pickable?: boolean
          is_visible?: boolean
          name: string
          parent_id?: string | null
          ranking_min_sample?: number
          slug: string
          sort_order?: number
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          image_url?: string | null
          is_pickable?: boolean
          is_visible?: boolean
          name?: string
          parent_id?: string | null
          ranking_min_sample?: number
          slug?: string
          sort_order?: number
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "categories_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
        ]
      }
      client_error_events: {
        Row: {
          app_version: string | null
          context: string
          created_at: string
          error_code: string
          id: string
          platform: string | null
          user_id: string | null
        }
        Insert: {
          app_version?: string | null
          context: string
          created_at?: string
          error_code: string
          id?: string
          platform?: string | null
          user_id?: string | null
        }
        Update: {
          app_version?: string | null
          context?: string
          created_at?: string
          error_code?: string
          id?: string
          platform?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      comments: {
        Row: {
          body: string
          created_at: string
          id: string
          pick_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          body: string
          created_at?: string
          id?: string
          pick_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          body?: string
          created_at?: string
          id?: string
          pick_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "comments_pick_id_fkey"
            columns: ["pick_id"]
            isOneToOne: false
            referencedRelation: "picks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "comments_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      content_reports: {
        Row: {
          created_at: string
          details: string | null
          id: string
          reason: string
          reporter_user_id: string | null
          resolved_at: string | null
          resolved_by: string | null
          status: string
          target_id: string
          target_type: string
          target_user_id: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          details?: string | null
          id?: string
          reason: string
          reporter_user_id?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          status?: string
          target_id: string
          target_type: string
          target_user_id?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          details?: string | null
          id?: string
          reason?: string
          reporter_user_id?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          status?: string
          target_id?: string
          target_type?: string
          target_user_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "content_reports_reporter_user_id_fkey"
            columns: ["reporter_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "content_reports_resolved_by_fkey"
            columns: ["resolved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "content_reports_target_user_id_fkey"
            columns: ["target_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      item_aliases: {
        Row: {
          alias: string
          created_at: string
          id: string
          item_id: string
          normalized_alias: string
          updated_at: string
        }
        Insert: {
          alias: string
          created_at?: string
          id?: string
          item_id: string
          normalized_alias: string
          updated_at?: string
        }
        Update: {
          alias?: string
          created_at?: string
          id?: string
          item_id?: string
          normalized_alias?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "item_aliases_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "items"
            referencedColumns: ["id"]
          },
        ]
      }
      items: {
        Row: {
          brand_id: string | null
          category_id: string
          created_at: string
          created_by: string | null
          id: string
          image_path: string | null
          image_source_url: string | null
          merged_into_item_id: string | null
          model_code: string | null
          name: string
          normalized_name: string
          official_url: string | null
          status: string
          thumbnail_path: string | null
          updated_at: string
        }
        Insert: {
          brand_id?: string | null
          category_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          image_path?: string | null
          image_source_url?: string | null
          merged_into_item_id?: string | null
          model_code?: string | null
          name: string
          normalized_name: string
          official_url?: string | null
          status?: string
          thumbnail_path?: string | null
          updated_at?: string
        }
        Update: {
          brand_id?: string | null
          category_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          image_path?: string | null
          image_source_url?: string | null
          merged_into_item_id?: string | null
          model_code?: string | null
          name?: string
          normalized_name?: string
          official_url?: string | null
          status?: string
          thumbnail_path?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "items_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "items_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "items_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "items_merged_into_item_id_fkey"
            columns: ["merged_into_item_id"]
            isOneToOne: false
            referencedRelation: "items"
            referencedColumns: ["id"]
          },
        ]
      }
      picks: {
        Row: {
          category_id: string
          created_at: string
          ended_at: string | null
          id: string
          item_id: string
          one_line_review: string
          replaced_by_pick_id: string | null
          started_at: string
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          category_id: string
          created_at?: string
          ended_at?: string | null
          id?: string
          item_id: string
          one_line_review: string
          replaced_by_pick_id?: string | null
          started_at?: string
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          category_id?: string
          created_at?: string
          ended_at?: string | null
          id?: string
          item_id?: string
          one_line_review?: string
          replaced_by_pick_id?: string | null
          started_at?: string
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "picks_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "picks_item_category_fk"
            columns: ["item_id", "category_id"]
            isOneToOne: false
            referencedRelation: "items"
            referencedColumns: ["id", "category_id"]
          },
          {
            foreignKeyName: "picks_replaced_by_pick_id_fkey"
            columns: ["replaced_by_pick_id"]
            isOneToOne: false
            referencedRelation: "picks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "picks_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          bio: string | null
          created_at: string
          id: string
          onboarding_completed: boolean
          profile_image_url: string | null
          updated_at: string
          username: string
        }
        Insert: {
          bio?: string | null
          created_at?: string
          id: string
          onboarding_completed?: boolean
          profile_image_url?: string | null
          updated_at?: string
          username: string
        }
        Update: {
          bio?: string | null
          created_at?: string
          id?: string
          onboarding_completed?: boolean
          profile_image_url?: string | null
          updated_at?: string
          username?: string
        }
        Relationships: []
      }
      user_blocks: {
        Row: {
          blocked_user_id: string
          blocked_username_snapshot: string
          blocker_user_id: string
          created_at: string
        }
        Insert: {
          blocked_user_id: string
          blocked_username_snapshot: string
          blocker_user_id: string
          created_at?: string
        }
        Update: {
          blocked_user_id?: string
          blocked_username_snapshot?: string
          blocker_user_id?: string
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_blocks_blocked_user_id_fkey"
            columns: ["blocked_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_blocks_blocker_user_id_fkey"
            columns: ["blocker_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      attach_item_photo: {
        Args: {
          p_image_path: string
          p_image_source_url?: string
          p_item_id: string
          p_thumbnail_path: string
        }
        Returns: {
          brand_id: string | null
          category_id: string
          created_at: string
          created_by: string | null
          id: string
          image_path: string | null
          image_source_url: string | null
          merged_into_item_id: string | null
          model_code: string | null
          name: string
          normalized_name: string
          official_url: string | null
          status: string
          thumbnail_path: string | null
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "items"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      change_pick: {
        Args: {
          p_category_id: string
          p_item_id: string
          p_one_line_review: string
        }
        Returns: {
          category_id: string
          created_at: string
          ended_at: string | null
          id: string
          item_id: string
          one_line_review: string
          replaced_by_pick_id: string | null
          started_at: string
          status: string
          updated_at: string
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "picks"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      consume_image_import: { Args: never; Returns: undefined }
      current_user_is_admin: { Args: never; Returns: boolean }
      register_pick: {
        Args: {
          p_category_id: string
          p_image_path?: string
          p_image_source_url?: string
          p_item_id: string
          p_item_name: string
          p_one_line_review: string
          p_thumbnail_path?: string
        }
        Returns: {
          category_id: string
          created_at: string
          ended_at: string | null
          id: string
          item_id: string
          one_line_review: string
          replaced_by_pick_id: string | null
          started_at: string
          status: string
          updated_at: string
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "picks"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      remove_pick: { Args: { p_category_id: string }; Returns: boolean }
      search_items: {
        Args: { p_category_ids?: string[]; p_limit?: number; p_query: string }
        Returns: {
          brand_id: string | null
          category_id: string
          created_at: string
          created_by: string | null
          id: string
          image_path: string | null
          image_source_url: string | null
          merged_into_item_id: string | null
          model_code: string | null
          name: string
          normalized_name: string
          official_url: string | null
          status: string
          thumbnail_path: string | null
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "items"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      submit_item: {
        Args: {
          p_category_id: string
          p_image_path?: string
          p_image_source_url?: string
          p_item_name: string
          p_thumbnail_path?: string
        }
        Returns: {
          brand_id: string | null
          category_id: string
          created_at: string
          created_by: string | null
          id: string
          image_path: string | null
          image_source_url: string | null
          merged_into_item_id: string | null
          model_code: string | null
          name: string
          normalized_name: string
          official_url: string | null
          status: string
          thumbnail_path: string | null
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "items"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      update_pick_review: {
        Args: { p_one_line_review: string; p_pick_id: string }
        Returns: {
          category_id: string
          created_at: string
          ended_at: string | null
          id: string
          item_id: string
          one_line_review: string
          replaced_by_pick_id: string | null
          started_at: string
          status: string
          updated_at: string
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "picks"
          isOneToOne: true
          isSetofReturn: false
        }
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
