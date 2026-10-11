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
          logo_path: string | null
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
          logo_path?: string | null
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
          logo_path?: string | null
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
      category_catalog_sources: {
        Row: {
          category_id: string
          created_at: string
          edge_function_slug: string | null
          external_source: string | null
          is_enabled: boolean
          mode: string
          notes: string | null
          provider: string | null
          updated_at: string
        }
        Insert: {
          category_id: string
          created_at?: string
          edge_function_slug?: string | null
          external_source?: string | null
          is_enabled?: boolean
          mode: string
          notes?: string | null
          provider?: string | null
          updated_at?: string
        }
        Update: {
          category_id?: string
          created_at?: string
          edge_function_slug?: string | null
          external_source?: string | null
          is_enabled?: boolean
          mode?: string
          notes?: string | null
          provider?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "category_catalog_sources_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: true
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
        ]
      }
      category_taste_dimensions: {
        Row: {
          category_id: string
          created_at: string
          dimension_code: string
          is_primary: boolean
          updated_at: string
          weight: number
        }
        Insert: {
          category_id: string
          created_at?: string
          dimension_code: string
          is_primary?: boolean
          updated_at?: string
          weight?: number
        }
        Update: {
          category_id?: string
          created_at?: string
          dimension_code?: string
          is_primary?: boolean
          updated_at?: string
          weight?: number
        }
        Relationships: [
          {
            foreignKeyName: "category_taste_dimensions_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "category_taste_dimensions_dimension_code_fkey"
            columns: ["dimension_code"]
            isOneToOne: false
            referencedRelation: "taste_dimensions"
            referencedColumns: ["code"]
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
      comment_notifications: {
        Row: {
          comment_id: string
          created_at: string
          read_at: string | null
          recipient_id: string
        }
        Insert: {
          comment_id: string
          created_at?: string
          read_at?: string | null
          recipient_id: string
        }
        Update: {
          comment_id?: string
          created_at?: string
          read_at?: string | null
          recipient_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "comment_notifications_comment_id_fkey"
            columns: ["comment_id"]
            isOneToOne: true
            referencedRelation: "comments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "comment_notifications_recipient_id_fkey"
            columns: ["recipient_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
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
      external_catalog_cache: {
        Row: {
          cache_key: string
          fetched_at: string
          payload: Json
          provider: string
        }
        Insert: {
          cache_key: string
          fetched_at?: string
          payload: Json
          provider: string
        }
        Update: {
          cache_key?: string
          fetched_at?: string
          payload?: Json
          provider?: string
        }
        Relationships: []
      }
      external_catalog_request_limits: {
        Row: {
          next_allowed_at: string
          provider: string
        }
        Insert: {
          next_allowed_at?: string
          provider: string
        }
        Update: {
          next_allowed_at?: string
          provider?: string
        }
        Relationships: []
      }
      home_settings: {
        Row: {
          id: boolean
          minimum_pick_count: number
          updated_at: string
        }
        Insert: {
          id?: boolean
          minimum_pick_count?: number
          updated_at?: string
        }
        Update: {
          id?: boolean
          minimum_pick_count?: number
          updated_at?: string
        }
        Relationships: []
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
      item_catalog_verifications: {
        Row: {
          created_at: string
          item_id: string
          notes: string | null
          source_type: string | null
          source_url: string | null
          updated_at: string
          verification_state: string
          verified_at: string
        }
        Insert: {
          created_at?: string
          item_id: string
          notes?: string | null
          source_type?: string | null
          source_url?: string | null
          updated_at?: string
          verification_state: string
          verified_at?: string
        }
        Update: {
          created_at?: string
          item_id?: string
          notes?: string | null
          source_type?: string | null
          source_url?: string | null
          updated_at?: string
          verification_state?: string
          verified_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "item_catalog_verifications_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: true
            referencedRelation: "items"
            referencedColumns: ["id"]
          },
        ]
      }
      item_category_ai_suggestions: {
        Row: {
          category_fingerprint: string
          created_at: string
          item_id: string
          item_name: string
          model_name: string
          payload: Json
          prompt_version: string
          updated_at: string
          user_id: string
        }
        Insert: {
          category_fingerprint: string
          created_at?: string
          item_id: string
          item_name: string
          model_name: string
          payload: Json
          prompt_version: string
          updated_at?: string
          user_id: string
        }
        Update: {
          category_fingerprint?: string
          created_at?: string
          item_id?: string
          item_name?: string
          model_name?: string
          payload?: Json
          prompt_version?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "item_category_ai_suggestions_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: true
            referencedRelation: "items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "item_category_ai_suggestions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      item_editorial_features: {
        Row: {
          created_at: string
          ends_at: string | null
          is_active: boolean
          item_id: string
          note: string | null
          priority: number
          starts_at: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          ends_at?: string | null
          is_active?: boolean
          item_id: string
          note?: string | null
          priority?: number
          starts_at?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          ends_at?: string | null
          is_active?: boolean
          item_id?: string
          note?: string | null
          priority?: number
          starts_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "item_editorial_features_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: true
            referencedRelation: "items"
            referencedColumns: ["id"]
          },
        ]
      }
      item_photo_credits: {
        Row: {
          created_at: string
          image_path: string
          image_source_url: string | null
          item_id: string
          thumbnail_path: string
          user_id: string
        }
        Insert: {
          created_at?: string
          image_path: string
          image_source_url?: string | null
          item_id: string
          thumbnail_path: string
          user_id: string
        }
        Update: {
          created_at?: string
          image_path?: string
          image_source_url?: string | null
          item_id?: string
          thumbnail_path?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "item_photo_credits_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: true
            referencedRelation: "items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "item_photo_credits_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      items: {
        Row: {
          brand_id: string | null
          category_id: string
          collection_name: string | null
          created_at: string
          created_by: string | null
          creator_name: string | null
          external_id: string | null
          external_refreshed_at: string | null
          external_source: string | null
          id: string
          image_path: string | null
          image_source_url: string | null
          market_availability_status: string
          merged_into_item_id: string | null
          model_code: string | null
          name: string
          normalized_name: string
          official_url: string | null
          original_name: string | null
          release_year: number | null
          requested_category_label: string | null
          status: string
          thumbnail_path: string | null
          updated_at: string
        }
        Insert: {
          brand_id?: string | null
          category_id: string
          collection_name?: string | null
          created_at?: string
          created_by?: string | null
          creator_name?: string | null
          external_id?: string | null
          external_refreshed_at?: string | null
          external_source?: string | null
          id?: string
          image_path?: string | null
          image_source_url?: string | null
          market_availability_status?: string
          merged_into_item_id?: string | null
          model_code?: string | null
          name: string
          normalized_name: string
          official_url?: string | null
          original_name?: string | null
          release_year?: number | null
          requested_category_label?: string | null
          status?: string
          thumbnail_path?: string | null
          updated_at?: string
        }
        Update: {
          brand_id?: string | null
          category_id?: string
          collection_name?: string | null
          created_at?: string
          created_by?: string | null
          creator_name?: string | null
          external_id?: string | null
          external_refreshed_at?: string | null
          external_source?: string | null
          id?: string
          image_path?: string | null
          image_source_url?: string | null
          market_availability_status?: string
          merged_into_item_id?: string | null
          model_code?: string | null
          name?: string
          normalized_name?: string
          official_url?: string | null
          original_name?: string | null
          release_year?: number | null
          requested_category_label?: string | null
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
          channel: string | null
          created_at: string
          ended_at: string | null
          id: string
          item_id: string
          one_line_review: string
          purchase_tip: string | null
          purchase_url: string | null
          replaced_by_pick_id: string | null
          started_at: string
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          category_id: string
          channel?: string | null
          created_at?: string
          ended_at?: string | null
          id?: string
          item_id: string
          one_line_review: string
          purchase_tip?: string | null
          purchase_url?: string | null
          replaced_by_pick_id?: string | null
          started_at?: string
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          category_id?: string
          channel?: string | null
          created_at?: string
          ended_at?: string | null
          id?: string
          item_id?: string
          one_line_review?: string
          purchase_tip?: string | null
          purchase_url?: string | null
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
      product_analytics_events: {
        Row: {
          app_version: string | null
          category_id: string | null
          created_at: string
          event_name: string
          id: string
          item_id: string | null
          path: string | null
          pick_id: string | null
          platform: string | null
          source: string | null
          user_id: string | null
        }
        Insert: {
          app_version?: string | null
          category_id?: string | null
          created_at?: string
          event_name: string
          id?: string
          item_id?: string | null
          path?: string | null
          pick_id?: string | null
          platform?: string | null
          source?: string | null
          user_id?: string | null
        }
        Update: {
          app_version?: string | null
          category_id?: string | null
          created_at?: string
          event_name?: string
          id?: string
          item_id?: string | null
          path?: string | null
          pick_id?: string | null
          platform?: string | null
          source?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "product_analytics_events_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_analytics_events_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_analytics_events_pick_id_fkey"
            columns: ["pick_id"]
            isOneToOne: false
            referencedRelation: "picks"
            referencedColumns: ["id"]
          },
        ]
      }
      profile_ai_generation_limits: {
        Row: {
          created_at: string
          next_allowed_at: string
          profile_id: string
          source_version: number
        }
        Insert: {
          created_at?: string
          next_allowed_at: string
          profile_id: string
          source_version?: number
        }
        Update: {
          created_at?: string
          next_allowed_at?: string
          profile_id?: string
          source_version?: number
        }
        Relationships: [
          {
            foreignKeyName: "profile_ai_generation_limits_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      profile_ai_reviews: {
        Row: {
          actor_id: string
          body: string
          created_at: string
          generated_at: string
          id: string
          is_stale: boolean
          is_visible: boolean
          keywords: string[]
          model_name: string
          pick_snapshot: Json
          profile_id: string
          prompt_version: string
          source_fingerprint: string
          source_version: number
          summary: string
          tone: string | null
          updated_at: string
        }
        Insert: {
          actor_id: string
          body: string
          created_at?: string
          generated_at?: string
          id?: string
          is_stale?: boolean
          is_visible?: boolean
          keywords?: string[]
          model_name: string
          pick_snapshot?: Json
          profile_id: string
          prompt_version: string
          source_fingerprint: string
          source_version?: number
          summary: string
          tone?: string | null
          updated_at?: string
        }
        Update: {
          actor_id?: string
          body?: string
          created_at?: string
          generated_at?: string
          id?: string
          is_stale?: boolean
          is_visible?: boolean
          keywords?: string[]
          model_name?: string
          pick_snapshot?: Json
          profile_id?: string
          prompt_version?: string
          source_fingerprint?: string
          source_version?: number
          summary?: string
          tone?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "profile_ai_reviews_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "system_actors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profile_ai_reviews_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      profile_onboarding_category_events: {
        Row: {
          action: string
          category_id: string
          created_at: string
          profile_id: string
          sequence_no: number
          updated_at: string
        }
        Insert: {
          action: string
          category_id: string
          created_at?: string
          profile_id: string
          sequence_no: number
          updated_at?: string
        }
        Update: {
          action?: string
          category_id?: string
          created_at?: string
          profile_id?: string
          sequence_no?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "profile_onboarding_category_events_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profile_onboarding_category_events_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      profile_onboarding_state: {
        Row: {
          completed_at: string | null
          created_at: string
          current_category_id: string | null
          exited_at: string | null
          handled_count: number
          profile_id: string
          updated_at: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          current_category_id?: string | null
          exited_at?: string | null
          handled_count?: number
          profile_id: string
          updated_at?: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          current_category_id?: string | null
          exited_at?: string | null
          handled_count?: number
          profile_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "profile_onboarding_state_current_category_id_fkey"
            columns: ["current_category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profile_onboarding_state_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      profile_social_links: {
        Row: {
          created_at: string
          platform: string
          updated_at: string
          url: string
          user_id: string
        }
        Insert: {
          created_at?: string
          platform: string
          updated_at?: string
          url: string
          user_id: string
        }
        Update: {
          created_at?: string
          platform?: string
          updated_at?: string
          url?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "profile_social_links_user_id_fkey"
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
          nickname: string | null
          onboarding_completed: boolean
          profile_image_url: string | null
          updated_at: string
          username: string
        }
        Insert: {
          bio?: string | null
          created_at?: string
          id: string
          nickname?: string | null
          onboarding_completed?: boolean
          profile_image_url?: string | null
          updated_at?: string
          username: string
        }
        Update: {
          bio?: string | null
          created_at?: string
          id?: string
          nickname?: string | null
          onboarding_completed?: boolean
          profile_image_url?: string | null
          updated_at?: string
          username?: string
        }
        Relationships: []
      }
      system_actors: {
        Row: {
          actor_type: string
          avatar_url: string | null
          bio: string | null
          created_at: string
          display_name: string
          id: string
          is_active: boolean
          is_verified: boolean
          slug: string
          updated_at: string
        }
        Insert: {
          actor_type?: string
          avatar_url?: string | null
          bio?: string | null
          created_at?: string
          display_name: string
          id?: string
          is_active?: boolean
          is_verified?: boolean
          slug: string
          updated_at?: string
        }
        Update: {
          actor_type?: string
          avatar_url?: string | null
          bio?: string | null
          created_at?: string
          display_name?: string
          id?: string
          is_active?: boolean
          is_verified?: boolean
          slug?: string
          updated_at?: string
        }
        Relationships: []
      }
      taste_dimensions: {
        Row: {
          code: string
          created_at: string
          description: string
          display_order: number
          name: string
          updated_at: string
        }
        Insert: {
          code: string
          created_at?: string
          description: string
          display_order?: number
          name: string
          updated_at?: string
        }
        Update: {
          code?: string
          created_at?: string
          description?: string
          display_order?: number
          name?: string
          updated_at?: string
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
      admin_catalog_quality_snapshot: { Args: never; Returns: Json }
      admin_dashboard_metrics: { Args: never; Returns: Json }
      admin_merge_pending_item: {
        Args: { p_source_item_id: string; p_target_item_id: string }
        Returns: {
          brand_id: string | null
          category_id: string
          collection_name: string | null
          created_at: string
          created_by: string | null
          creator_name: string | null
          external_id: string | null
          external_refreshed_at: string | null
          external_source: string | null
          id: string
          image_path: string | null
          image_source_url: string | null
          market_availability_status: string
          merged_into_item_id: string | null
          model_code: string | null
          name: string
          normalized_name: string
          official_url: string | null
          original_name: string | null
          release_year: number | null
          requested_category_label: string | null
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
      admin_operations_snapshot: { Args: { p_days?: number }; Returns: Json }
      admin_review_pending_item: {
        Args: {
          p_category_id?: string
          p_item_id: string
          p_reject_reason?: string
          p_status: string
        }
        Returns: {
          brand_id: string | null
          category_id: string
          collection_name: string | null
          created_at: string
          created_by: string | null
          creator_name: string | null
          external_id: string | null
          external_refreshed_at: string | null
          external_source: string | null
          id: string
          image_path: string | null
          image_source_url: string | null
          market_availability_status: string
          merged_into_item_id: string | null
          model_code: string | null
          name: string
          normalized_name: string
          official_url: string | null
          original_name: string | null
          release_year: number | null
          requested_category_label: string | null
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
      admin_set_item_editorial_feature: {
        Args: {
          p_ends_at?: string
          p_is_active?: boolean
          p_item_id: string
          p_note?: string
          p_priority?: number
          p_starts_at?: string
        }
        Returns: {
          created_at: string
          ends_at: string | null
          is_active: boolean
          item_id: string
          note: string | null
          priority: number
          starts_at: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "item_editorial_features"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      admin_set_user_suspension: {
        Args: { p_reason?: string; p_suspended: boolean; p_user_id: string }
        Returns: Json
      }
      admin_user_moderation: { Args: { p_user_id: string }; Returns: Json }
      admin_users: {
        Args: { p_query?: string }
        Returns: {
          created_at: string
          id: string
          is_admin: boolean
          moderation_status: string
          onboarding_completed: boolean
          suspended_at: string
          suspension_reason: string
          updated_at: string
          username: string
        }[]
      }
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
          collection_name: string | null
          created_at: string
          created_by: string | null
          creator_name: string | null
          external_id: string | null
          external_refreshed_at: string | null
          external_source: string | null
          id: string
          image_path: string | null
          image_source_url: string | null
          market_availability_status: string
          merged_into_item_id: string | null
          model_code: string | null
          name: string
          normalized_name: string
          official_url: string | null
          original_name: string | null
          release_year: number | null
          requested_category_label: string | null
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
      catalog_user_is_suspended: {
        Args: { p_user_id: string }
        Returns: boolean
      }
      category_is_open_leaf: {
        Args: { p_category_id: string }
        Returns: boolean
      }
      category_path: { Args: { p_category_id: string }; Returns: string }
      category_top_items: {
        Args: { p_category_id: string }
        Returns: {
          image_path: string
          image_source_url: string
          is_tied: boolean
          item_id: string
          name: string
          pick_count: number
          rank: number
          thumbnail_path: string
        }[]
      }
      category_top_items_v2: {
        Args: { p_category_id: string }
        Returns: {
          image_path: string
          image_source_url: string
          is_tied: boolean
          item_id: string
          market_availability_status: string
          name: string
          official_url: string
          pick_count: number
          rank: number
          thumbnail_path: string
        }[]
      }
      change_pick: {
        Args: {
          p_category_id: string
          p_channel?: string | null
          p_item_id: string
          p_one_line_review: string
          p_purchase_tip?: string | null
          p_purchase_url?: string | null
        }
        Returns: {
          category_id: string
          channel: string | null
          created_at: string
          ended_at: string | null
          id: string
          item_id: string
          one_line_review: string
          purchase_tip: string | null
          purchase_url: string | null
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
      classify_pending_item: {
        Args: { p_category_id: string; p_item_id: string }
        Returns: Json
      }
      comment_notification_count: {
        Args: { p_recipient_id: string }
        Returns: number
      }
      comment_notification_page: {
        Args: {
          p_before_id?: string
          p_before_time?: string
          p_recipient_id: string
        }
        Returns: {
          body: string
          comment_id: string
          created_at: string
          item_name: string
          pick_id: string
          read_at: string
          username: string
        }[]
      }
      complete_profile_onboarding: {
        Args: never
        Returns: {
          completed_at: string | null
          created_at: string
          current_category_id: string | null
          exited_at: string | null
          handled_count: number
          profile_id: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "profile_onboarding_state"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      capture_product_event: {
        Args: {
          p_event_name: string
          p_pick_id?: string | null
          p_item_id?: string | null
          p_category_id?: string | null
          p_source?: string | null
          p_path?: string | null
          p_platform?: string | null
          p_app_version?: string | null
        }
        Returns: undefined
      }
      consume_image_import: { Args: never; Returns: undefined }
      current_user_is_admin: { Args: never; Returns: boolean }
      explore_recent_items_page: {
        Args: {
          p_before_id?: string
          p_before_time?: string
          p_category_ids?: string[]
          p_stores_only?: boolean
        }
        Returns: {
          category_id: string
          category_name: string
          image_path: string
          image_source_url: string
          item_id: string
          item_name: string
          last_picked_at: string
          thumbnail_path: string
        }[]
      }
      home_editorial_items: {
        Args: { p_limit?: number }
        Returns: {
          category_id: string
          category_name: string
          category_path: string
          editorial_note: string
          editorial_priority: number
          image_path: string
          image_source_url: string
          item_id: string
          name: string
          pick_count: number
          thumbnail_path: string
        }[]
      }
      home_pick_feed_page: {
        Args: { p_before_id?: string; p_before_time?: string; p_category_id?: string; p_channel?: string; p_root_slug?: string }
        Returns: {
          category_id: string
          category_name: string
          channels: string[]
          image_path: string
          image_source_url: string
          item_id: string
          item_name: string
          one_line_review: string
          pick_id: string
          profile_image_url: string
          started_at: string
          thumbnail_path: string
          user_id: string
          username: string
        }[]
      }
      home_pick_feed_page_v2: {
        Args: { p_before_id?: string; p_before_time?: string }
        Returns: {
          category_id: string
          category_name: string
          image_path: string
          image_source_url: string
          item_id: string
          item_name: string
          market_availability_status: string
          official_url: string
          one_line_review: string
          pick_id: string
          profile_image_url: string
          started_at: string
          thumbnail_path: string
          user_id: string
          username: string
        }[]
      }
      home_showcase: {
        Args: never
        Returns: {
          items: Json
          minimum_pick_count: number
        }[]
      }
      home_showcase_page: {
        Args: { p_after_id?: string; p_before_time?: string }
        Returns: {
          items: Json
          minimum_pick_count: number
        }[]
      }
      item_brands: {
        Args: { p_item_ids: string[] }
        Returns: {
          brand_id: string
          brand_name: string
          item_id: string
          logo_path: string | null
        }[]
      }
      item_photo_credit: {
        Args: { p_item_id: string }
        Returns: {
          image_path: string
          image_source_url: string
          item_id: string
          user_id: string
          username: string
        }[]
      }
      pause_profile_onboarding: {
        Args: never
        Returns: {
          completed_at: string | null
          created_at: string
          current_category_id: string | null
          exited_at: string | null
          handled_count: number
          profile_id: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "profile_onboarding_state"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      profile_ai_pick_popularity: {
        Args: { p_item_ids: string[] }
        Returns: {
          category_id: string
          category_pick_count: number
          item_id: string
          item_pick_count: number
          ranking_min_sample: number
        }[]
      }
      profile_taste_composition: {
        Args: { p_profile_id: string }
        Returns: Json
      }
      record_profile_onboarding_action: {
        Args: { p_action: string; p_category_id: string }
        Returns: {
          completed_at: string | null
          created_at: string
          current_category_id: string | null
          exited_at: string | null
          handled_count: number
          profile_id: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "profile_onboarding_state"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      register_pick: {
        Args: {
          p_category_id: string
          p_channel?: string | null
          p_image_path?: string
          p_image_source_url?: string
          p_item_id: string
          p_item_name: string
          p_one_line_review: string
          p_thumbnail_path?: string
        }
        Returns: {
          category_id: string
          channel: string | null
          created_at: string
          ended_at: string | null
          id: string
          item_id: string
          one_line_review: string
          purchase_tip: string | null
          purchase_url: string | null
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
      remove_pick: {
        Args: { p_category_id: string; p_channel?: string | null }
        Returns: boolean
      }
      reserve_external_catalog_slot: {
        Args: { p_interval_ms: number; p_provider: string }
        Returns: number
      }
      reserve_profile_ai_generation: {
        Args: { p_profile_id: string }
        Returns: boolean
      }
      save_profile_ai_review: {
        Args: {
          p_actor_id: string
          p_body: string
          p_keywords: string[]
          p_model_name: string
          p_pick_snapshot: Json
          p_profile_id: string
          p_prompt_version: string
          p_source_fingerprint: string
          p_source_version: number
          p_summary: string
        }
        Returns: Json
      }
      search_items: {
        Args: { p_category_ids?: string[]; p_limit?: number; p_query: string }
        Returns: {
          brand_id: string | null
          category_id: string
          collection_name: string | null
          created_at: string
          created_by: string | null
          creator_name: string | null
          external_id: string | null
          external_refreshed_at: string | null
          external_source: string | null
          id: string
          image_path: string | null
          image_source_url: string | null
          market_availability_status: string
          merged_into_item_id: string | null
          model_code: string | null
          name: string
          normalized_name: string
          official_url: string | null
          original_name: string | null
          release_year: number | null
          requested_category_label: string | null
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
      set_profile_onboarding_current: {
        Args: { p_category_id: string }
        Returns: {
          completed_at: string | null
          created_at: string
          current_category_id: string | null
          exited_at: string | null
          handled_count: number
          profile_id: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "profile_onboarding_state"
          isOneToOne: true
          isSetofReturn: false
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
          collection_name: string | null
          created_at: string
          created_by: string | null
          creator_name: string | null
          external_id: string | null
          external_refreshed_at: string | null
          external_source: string | null
          id: string
          image_path: string | null
          image_source_url: string | null
          market_availability_status: string
          merged_into_item_id: string | null
          model_code: string | null
          name: string
          normalized_name: string
          official_url: string | null
          original_name: string | null
          release_year: number | null
          requested_category_label: string | null
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
      set_pending_item_category_hint: {
        Args: { p_item_id: string; p_label?: string }
        Returns: Database["public"]["Tables"]["items"]["Row"]
      }
      submit_unclassified_item: {
        Args: {
          p_image_path?: string
          p_image_source_url?: string
          p_item_name: string
          p_thumbnail_path?: string
        }
        Returns: {
          brand_id: string | null
          category_id: string
          collection_name: string | null
          created_at: string
          created_by: string | null
          creator_name: string | null
          external_id: string | null
          external_refreshed_at: string | null
          external_source: string | null
          id: string
          image_path: string | null
          image_source_url: string | null
          market_availability_status: string
          merged_into_item_id: string | null
          model_code: string | null
          name: string
          normalized_name: string
          official_url: string | null
          original_name: string | null
          release_year: number | null
          requested_category_label: string | null
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
        Args: {
          p_one_line_review: string
          p_pick_id: string
          p_purchase_tip?: string | null
          p_purchase_url?: string | null
        }
        Returns: {
          category_id: string
          channel: string | null
          created_at: string
          ended_at: string | null
          id: string
          item_id: string
          one_line_review: string
          purchase_tip: string | null
          purchase_url: string | null
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
