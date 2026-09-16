export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  __InternalSupabase: {
    PostgrestVersion: "14.5";
  };
  public: {
    Tables: {
      brands: {
        Row: {
          created_at: string;
          id: string;
          is_active: boolean;
          logo_url: string | null;
          name: string;
          normalized_name: string;
          slug: string | null;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          is_active?: boolean;
          logo_url?: string | null;
          name: string;
          normalized_name: string;
          slug?: string | null;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          is_active?: boolean;
          logo_url?: string | null;
          name?: string;
          normalized_name?: string;
          slug?: string | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      categories: {
        Row: {
          created_at: string;
          id: string;
          image_url: string | null;
          is_pickable: boolean;
          is_visible: boolean;
          name: string;
          parent_id: string | null;
          ranking_min_sample: number;
          slug: string;
          sort_order: number;
          status: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          image_url?: string | null;
          is_pickable?: boolean;
          is_visible?: boolean;
          name: string;
          parent_id?: string | null;
          ranking_min_sample?: number;
          slug: string;
          sort_order?: number;
          status?: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          image_url?: string | null;
          is_pickable?: boolean;
          is_visible?: boolean;
          name?: string;
          parent_id?: string | null;
          ranking_min_sample?: number;
          slug?: string;
          sort_order?: number;
          status?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "categories_parent_id_fkey";
            columns: ["parent_id"];
            isOneToOne: false;
            referencedRelation: "categories";
            referencedColumns: ["id"];
          },
        ];
      };
      picks: {
        Row: {
          category_id: string;
          created_at: string;
          ended_at: string | null;
          id: string;
          one_line_review: string;
          product_id: string;
          replaced_by_pick_id: string | null;
          started_at: string;
          status: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          category_id: string;
          created_at?: string;
          ended_at?: string | null;
          id?: string;
          one_line_review: string;
          product_id: string;
          replaced_by_pick_id?: string | null;
          started_at?: string;
          status?: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          category_id?: string;
          created_at?: string;
          ended_at?: string | null;
          id?: string;
          one_line_review?: string;
          product_id?: string;
          replaced_by_pick_id?: string | null;
          started_at?: string;
          status?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "picks_category_id_fkey";
            columns: ["category_id"];
            isOneToOne: false;
            referencedRelation: "categories";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "picks_product_category_fk";
            columns: ["product_id", "category_id"];
            isOneToOne: false;
            referencedRelation: "products";
            referencedColumns: ["id", "category_id"];
          },
          {
            foreignKeyName: "picks_replaced_by_pick_id_fkey";
            columns: ["replaced_by_pick_id"];
            isOneToOne: false;
            referencedRelation: "picks";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "picks_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      products: {
        Row: {
          brand_id: string | null;
          category_id: string;
          created_at: string;
          created_by: string | null;
          id: string;
          merged_into_product_id: string | null;
          model_code: string | null;
          name: string;
          normalized_name: string;
          official_url: string | null;
          status: string;
          updated_at: string;
        };
        Insert: {
          brand_id?: string | null;
          category_id: string;
          created_at?: string;
          created_by?: string | null;
          id?: string;
          merged_into_product_id?: string | null;
          model_code?: string | null;
          name: string;
          normalized_name: string;
          official_url?: string | null;
          status?: string;
          updated_at?: string;
        };
        Update: {
          brand_id?: string | null;
          category_id?: string;
          created_at?: string;
          created_by?: string | null;
          id?: string;
          merged_into_product_id?: string | null;
          model_code?: string | null;
          name?: string;
          normalized_name?: string;
          official_url?: string | null;
          status?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "products_brand_id_fkey";
            columns: ["brand_id"];
            isOneToOne: false;
            referencedRelation: "brands";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "products_category_id_fkey";
            columns: ["category_id"];
            isOneToOne: false;
            referencedRelation: "categories";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "products_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "products_merged_into_product_id_fkey";
            columns: ["merged_into_product_id"];
            isOneToOne: false;
            referencedRelation: "products";
            referencedColumns: ["id"];
          },
        ];
      };
      profiles: {
        Row: {
          bio: string | null;
          created_at: string;
          id: string;
          onboarding_completed: boolean;
          profile_image_url: string | null;
          updated_at: string;
          username: string;
        };
        Insert: {
          bio?: string | null;
          created_at?: string;
          id: string;
          onboarding_completed?: boolean;
          profile_image_url?: string | null;
          updated_at?: string;
          username: string;
        };
        Update: {
          bio?: string | null;
          created_at?: string;
          id?: string;
          onboarding_completed?: boolean;
          profile_image_url?: string | null;
          updated_at?: string;
          username?: string;
        };
        Relationships: [];
      };
    };
    Views: { [_ in never]: never };
    Functions: {
      change_pick: {
        Args: {
          p_category_id: string;
          p_one_line_review: string;
          p_product_id: string;
        };
        Returns: {
          category_id: string;
          created_at: string;
          ended_at: string | null;
          id: string;
          one_line_review: string;
          product_id: string;
          replaced_by_pick_id: string | null;
          started_at: string;
          status: string;
          updated_at: string;
          user_id: string;
        };
        SetofOptions: {
          from: "*";
          to: "picks";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
    };
    Enums: { [_ in never]: never };
    CompositeTypes: { [_ in never]: never };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;
type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends { Row: infer R }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends { Row: infer R }
      ? R
      : never
    : never;
