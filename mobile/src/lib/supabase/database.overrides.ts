import type { Database, Json } from './database.types';

type CategoryTopItems = Database['public']['Functions']['category_top_items'];
type HomeEditorialItems = Database['public']['Functions']['home_editorial_items'];
type ItemRow = Database['public']['Tables']['items']['Row'];

export type HomePickFeedRow = {
  pick_id: string;
  user_id: string;
  username: string;
  profile_image_url: string | null;
  item_id: string;
  item_name: string;
  category_id: string;
  category_name: string;
  one_line_review: string;
  thumbnail_path: string | null;
  image_path: string | null;
  image_source_url: string | null;
  started_at: string;
  /** home_pick_feed_page only: the Pick's channel for food Picks, else the item's channels ('offline' | 'online' | 'recipe'). */
  channels?: string[] | null;
};

export type PlaceCatalogSearchRow = {
  catalog_id: string;
  place_provider: string;
  provider_place_id: string;
  name: string;
  branch_name: string | null;
  road_address: string | null;
  address: string | null;
  region_1: string | null;
  region_2: string | null;
  latitude: number | null;
  longitude: number | null;
  provider_category: string | null;
  existing_item_id: string | null;
};

type OnboardingStateRow = {
  profile_id: string;
  current_category_id: string | null;
  handled_count: number;
  exited_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
};
type OnboardingEventRow = {
  profile_id: string;
  category_id: string;
  action: string;
  sequence_no: number;
  created_at: string;
  updated_at: string;
};
type ProfileAiReviewRow = {
  id: string;
  profile_id: string;
  actor_id: string;
  summary: string;
  body: string;
  keywords: string[];
  is_visible: boolean;
  is_stale: boolean;
  generated_at: string;
  created_at: string;
  updated_at: string;
  tone: string | null;
};
type SystemActorRow = {
  id: string;
  slug: string;
  display_name: string;
  actor_type: string;
  bio: string | null;
  avatar_url: string | null;
  is_verified: boolean;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

type UserFollowRow = {
  follower_id: string;
  followee_id: string;
  created_at: string;
};

// L4: a member's photo for a published product, waiting for admin review.
// RLS returns only the caller's own rows; writes go through RPCs.
export type ItemPhotoCandidateRow = {
  id: string;
  item_id: string;
  user_id: string;
  image_path: string;
  thumbnail_path: string;
  image_source_url: string | null;
  status: 'pending' | 'approved' | 'rejected' | 'superseded';
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_at: string;
  updated_at: string;
};

export type PublicFollowConnectionRow = {
  user_id: string;
  username: string;
  profile_image_url: string | null;
  bio: string | null;
  viewer_is_following: boolean;
};

type PickChangeNotificationRow = {
  pick_id: string;
  recipient_id: string;
  created_at: string;
  read_at: string | null;
};
type NotificationPreferencesRow = {
  user_id: string;
  followee_pick_change: boolean;
  updated_at: string;
};
type ItemReviewNotificationRow = {
  item_id: string;
  recipient_id: string;
  outcome: 'approved' | 'merged' | 'rejected';
  target_item_id: string;
  pick_id: string | null;
  /** Admin's reason, set only for rejected rows. */
  reason: string | null;
  created_at: string;
  read_at: string | null;
};
// item_review rows have no sender: username is null, item_id is the approved
// product and pick_id is the pick approval created (null if none was made).
// Rejected rows point at the request itself (nothing to pick) and carry the
// admin's reason in body.
export type NotificationGroupRow = {
  group_id: string;
  kind: 'pick_review' | 'comment' | 'reply' | 'fix_needed' | 'followee_pick';
  latest_at: string;
  snapshot: string;
  unread_count: number;
  total_count: number;
  actor_count: number;
  actor: {
    user_id: string;
    username: string;
    profile_image_url: string | null;
  } | null;
  target: {
    item_id: string | null;
    item_name: string | null;
    category_id: string | null;
    category_name: string | null;
    channel: string | null;
    pick_id: string | null;
    comment_id: string | null;
    root_comment_id: string | null;
    user_id: string | null;
  };
  reason: string | null;
};

export type NotificationPageRow = {
  kind: 'comment' | 'pick_change' | 'item_review';
  id: string;
  pick_id: string | null;
  username: string | null;
  body: string | null;
  item_name: string;
  created_at: string;
  read_at: string | null;
  item_id: string | null;
  outcome: 'approved' | 'merged' | 'rejected' | null;
};

export type StoreCatalogRow = {
  catalog_id: string;
  name: string;
  branch_name: string | null;
  road_address: string | null;
  address: string | null;
  region_1: string | null;
  region_2: string | null;
  provider_category: string | null;
  map_url: string | null;
};
export type ItemLinkSuggestionRow = {
  id: string;
  item_id: string;
  user_id: string;
  url: string;
  status: 'pending' | 'approved' | 'rejected';
  created_at: string;
  reviewed_at: string | null;
  reviewed_by: string | null;
};
export type AdminItemLinkSuggestionRow = {
  suggestion_id: string;
  item_id: string;
  item_name: string;
  item_status: string;
  category_name: string;
  place_id: string | null;
  place_name: string | null;
  place_branch_name: string | null;
  place_road_address: string | null;
  current_map_url: string | null;
  url: string;
  username: string | null;
  created_at: string;
};

type TableShape<Row, Insert = Partial<Row>, Update = Partial<Row>> = {
  Row: Row;
  Insert: Insert;
  Update: Update;
  Relationships: [];
};

// Additive fields until the central generated types are refreshed.
export type AppDatabase = Omit<Database, 'public'> & {
  public: Omit<Database['public'], 'Functions' | 'Tables'> & {
    Tables: Database['public']['Tables'] & {
      profile_onboarding_state: TableShape<OnboardingStateRow, {
        profile_id: string;
        current_category_id?: string | null;
        handled_count?: number;
        exited_at?: string | null;
        completed_at?: string | null;
        created_at?: string;
        updated_at?: string;
      }>;
      profile_onboarding_category_events: TableShape<OnboardingEventRow, {
        profile_id: string;
        category_id: string;
        action: string;
        sequence_no: number;
        created_at?: string;
        updated_at?: string;
      }>;
      profile_ai_reviews: TableShape<ProfileAiReviewRow, never, { is_visible?: boolean }>;
      system_actors: TableShape<SystemActorRow, never, never>;
      user_follows: TableShape<UserFollowRow, { follower_id: string; followee_id: string; created_at?: string }, never>;
      item_photo_candidates: TableShape<ItemPhotoCandidateRow, never, never>;
      pick_change_notifications: TableShape<PickChangeNotificationRow, never, { read_at?: string | null }>;
      item_review_notifications: TableShape<ItemReviewNotificationRow, never, { read_at?: string | null }>;
      notification_preferences: TableShape<NotificationPreferencesRow, { user_id: string; followee_pick_change?: boolean; updated_at?: string }, { followee_pick_change?: boolean; updated_at?: string }>;
    };
    Functions: Omit<Database['public']['Functions'], 'category_top_items' | 'home_editorial_items'> & {
      search_store_catalog: {
        Args: { p_query: string; p_limit?: number };
        Returns: StoreCatalogRow[];
      };
      search_store_catalog_page: {
        Args: { p_query: string; p_cursor?: string | null; p_limit?: number };
        Returns: (StoreCatalogRow & { next_cursor: string | null })[];
      };
      search_online_sellers: {
        Args: { p_query: string; p_limit?: number };
        Returns: { provider_id: string; name: string; host: string; official_url: string }[];
      };
      select_online_provider_item: {
        Args: { p_category_id: string; p_provider_id: string };
        Returns: Database['public']['Tables']['items']['Row'];
      };
      stage_brand_item: {
        Args: { p_category_id: string; p_brand_id: string };
        Returns: Database['public']['Tables']['items']['Row'];
      };
      brand_profile: {
        Args: { p_brand_id: string };
        Returns: Json;
      };
      brand_branch_page: {
        Args: {
          p_brand_id: string;
          p_after_pick_count?: number | null;
          p_after_provider_id?: string | null;
          p_limit?: number;
        };
        Returns: Json[];
      };
      stage_user_place_item: {
        Args: {
          p_category_id: string;
          p_name: string;
          p_road_address: string;
          p_map_url: string;
          p_branch_name?: string;
        };
        Returns: Database['public']['Tables']['items']['Row'];
      };
      revise_item_request: {
        Args: {
          p_item_id: string;
          p_link_url?: string | null;
          p_image_path?: string | null;
          p_thumbnail_path?: string | null;
          p_image_source_url?: string | null;
          p_remove_photo?: boolean;
        };
        Returns: Database['public']['Tables']['items']['Row'];
      };
      register_item_pick: {
        Args: {
          p_category_id: string;
          p_channel: string;
          p_one_line_review: string;
          p_item_id?: string;
          p_catalog_id?: string;
          p_provider_id?: string;
          p_link_url?: string;
          p_image_path?: string;
          p_thumbnail_path?: string;
          p_image_source_url?: string;
          p_expected_previous_pick_id?: string | null;
          p_request_id?: string;
        };
        Returns: Json;
      };
      store_menu_options: {
        Args: never;
        Returns: { category_id: string; name: string; group_name: string | null; place_enabled: boolean }[];
      };
      suggest_item_map_link: {
        Args: { p_item_id: string; p_url: string };
        Returns: ItemLinkSuggestionRow;
      };
      admin_pending_item_link_suggestions: {
        Args: { p_limit?: number };
        Returns: AdminItemLinkSuggestionRow[];
      };
      admin_review_item_link_suggestion: {
        Args: { p_suggestion_id: string; p_approve: boolean };
        Returns: ItemLinkSuggestionRow;
      };
      category_top_items: Omit<CategoryTopItems, 'Args' | 'Returns'> & {
        Args: { p_category_id: string; p_channel?: 'offline' | 'online' | 'recipe' };
        Returns: (CategoryTopItems['Returns'][number] & {
          image_path: string | null;
          image_source_url: string | null;
        })[];
      };
      category_ranking: {
        Args: { p_slug: string; p_limit?: number; p_channel?: 'offline' | 'online' | 'recipe'; p_root_slug?: string };
        Returns: {
          item_id: string; name: string; thumbnail_path: string | null; image_path: string | null;
          image_source_url: string | null; pick_count: number; rank: number; is_tied: boolean;
        }[];
      };
      ranking_categories: {
        Args: { p_root_slug?: string };
        Returns: { category_id: string; slug: string; name: string; category_path: string | null; sort_order: number }[];
      };
      dish_channel_overview: {
        Args: { p_query: string };
        Returns: {
          category_id: string; category_name: string; channel: string | null;
          item_id: string | null; item_name: string | null; thumbnail_path: string | null;
          image_path: string | null; image_source_url: string | null; pick_count: number; rank: number;
        }[];
      };
      home_editorial_items: Omit<HomeEditorialItems, 'Args'> & {
        Args: { p_limit?: number; p_channel?: 'offline' | 'online' | 'recipe'; p_root_slug?: string };
      };
      home_pick_feed_page: {
        Args: { p_before_time?: string; p_before_id?: string; p_channel?: 'offline' | 'online' | 'recipe'; p_root_slug?: string; p_category_id?: string };
        Returns: HomePickFeedRow[];
      };
      home_following_feed_page: {
        Args: { p_before_time?: string; p_before_id?: string; p_channel?: 'offline' | 'online' | 'recipe'; p_root_slug?: string };
        Returns: HomePickFeedRow[];
      };
      follow_counts: {
        Args: never;
        Returns: { following_count: number; follower_count: number }[];
      };
      profile_follow_counts: {
        Args: { p_profile_id: string };
        Returns: { following_count: number; follower_count: number }[];
      };
      profile_follow_connections_page: {
        Args: {
          p_profile_id: string;
          p_direction: 'followers' | 'following';
          p_after_username?: string | null;
          p_after_user_id?: string | null;
          p_limit?: number;
        };
        Returns: PublicFollowConnectionRow[];
      };
      notification_unread_count: {
        Args: never;
        Returns: number;
      };
      notification_group_page: {
        Args: { p_before_activity?: string; p_before_group_id?: string; p_limit?: number };
        Returns: NotificationGroupRow[];
      };
      mark_notification_group_read: {
        Args: { p_group_id: string; p_until: string };
        Returns: number;
      };
      notification_count: {
        Args: never;
        Returns: number;
      };
      notification_page: {
        Args: { p_before_time?: string; p_before_id?: string };
        Returns: NotificationPageRow[];
      };
      set_pending_item_pick_review: {
        Args: { p_item_id: string; p_review: string; p_channel?: string | null };
        Returns: { item_id: string; user_id: string; one_line_review: string; channel: string | null; created_at: string; updated_at: string };
      };
      item_photo_credit: {
        Args: { p_item_id: string };
        Returns: { item_id: string; user_id: string; username: string; image_path: string; image_source_url: string | null }[];
      };
      set_profile_onboarding_current: {
        Args: { p_category_id: string };
        Returns: OnboardingStateRow;
      };
      record_profile_onboarding_action: {
        Args: { p_category_id: string; p_action: string };
        Returns: OnboardingStateRow;
      };
      pause_profile_onboarding: {
        Args: never;
        Returns: OnboardingStateRow;
      };
      complete_profile_onboarding: {
        Args: never;
        Returns: OnboardingStateRow;
      };
      profile_taste_composition: {
        Args: { p_profile_id: string };
        Returns: Json;
      };
      category_uses_place_catalog: {
        Args: { p_category_id: string };
        Returns: boolean;
      };
      search_place_catalog: {
        Args: { p_category_id: string; p_query: string; p_limit?: number };
        Returns: PlaceCatalogSearchRow[];
      };
      select_place_catalog_item: {
        Args: { p_category_id: string; p_catalog_id: string };
        Returns: ItemRow;
      };
    };
  };
};
