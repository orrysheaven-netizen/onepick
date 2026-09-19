import type { Database, Json } from './database.types';

type CategoryTopItems = Database['public']['Functions']['category_top_items'];

type ProfileAiReviewTable = {
  Row: {
    actor_id: string;
    body: string;
    created_at: string;
    generated_at: string;
    id: string;
    is_visible: boolean;
    is_stale: boolean;
    source_version: number;
    keywords: string[];
    model_name: string;
    pick_snapshot: Json;
    profile_id: string;
    prompt_version: string;
    source_fingerprint: string;
    summary: string;
    updated_at: string;
    tone: string | null;
  };
  Insert: {
    actor_id: string;
    body: string;
    created_at?: string;
    generated_at?: string;
    id?: string;
    is_visible?: boolean;
    is_stale?: boolean;
    source_version?: number;
    keywords?: string[];
    model_name: string;
    pick_snapshot?: Json;
    profile_id: string;
    prompt_version: string;
    source_fingerprint: string;
    summary: string;
    updated_at?: string;
  };
  Update: {
    actor_id?: string;
    body?: string;
    created_at?: string;
    generated_at?: string;
    id?: string;
    is_visible?: boolean;
    is_stale?: boolean;
    source_version?: number;
    keywords?: string[];
    model_name?: string;
    pick_snapshot?: Json;
    profile_id?: string;
    prompt_version?: string;
    source_fingerprint?: string;
    summary?: string;
    updated_at?: string;
  };
  Relationships: [
    { foreignKeyName: 'profile_ai_reviews_actor_id_fkey'; columns: ['actor_id']; isOneToOne: false; referencedRelation: 'system_actors'; referencedColumns: ['id']; },
    { foreignKeyName: 'profile_ai_reviews_profile_id_fkey'; columns: ['profile_id']; isOneToOne: true; referencedRelation: 'profiles'; referencedColumns: ['id']; },
  ];
};

type SystemActorTable = {
  Row: {
    actor_type: string; avatar_url: string | null; bio: string | null; created_at: string;
    display_name: string; id: string; is_active: boolean; is_verified: boolean; slug: string; updated_at: string;
  };
  Insert: {
    actor_type?: string; avatar_url?: string | null; bio?: string | null; created_at?: string;
    display_name: string; id?: string; is_active?: boolean; is_verified?: boolean; slug: string; updated_at?: string;
  };
  Update: {
    actor_type?: string; avatar_url?: string | null; bio?: string | null; created_at?: string;
    display_name?: string; id?: string; is_active?: boolean; is_verified?: boolean; slug?: string; updated_at?: string;
  };
  Relationships: [];
};

export type HomePickFeedRow = {
  pick_id: string; user_id: string; username: string; profile_image_url: string | null;
  item_id: string; item_name: string; category_id: string; category_name: string; one_line_review: string;
  thumbnail_path: string | null; image_path: string | null; image_source_url: string | null; started_at: string;
};

export type AppDatabase = Omit<Database, 'public'> & {
  public: Omit<Database['public'], 'Functions' | 'Tables'> & {
    Tables: Database['public']['Tables'] & {
      profile_ai_reviews: ProfileAiReviewTable;
      system_actors: SystemActorTable;
    };
    Functions: Omit<Database['public']['Functions'], 'category_top_items'> & {
      category_top_items: Omit<CategoryTopItems, 'Returns'> & {
        Returns: (CategoryTopItems['Returns'][number] & { image_path: string | null; image_source_url: string | null })[];
      };
      home_pick_feed_page: { Args: { p_before_time?: string; p_before_id?: string }; Returns: HomePickFeedRow[]; };
      item_photo_credit: {
        Args: { p_item_id: string };
        Returns: { item_id: string; user_id: string; username: string; image_path: string; image_source_url: string | null }[];
      };
    };
  };
};
