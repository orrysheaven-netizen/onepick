import type { Database, Json } from './database.types';

type CategoryTopItems = Database['public']['Functions']['category_top_items'];

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
  purchase_url: string | null;
  purchase_tip: string | null;
  started_at: string;
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
export type NotificationPageRow = {
  kind: 'comment' | 'pick_change';
  id: string;
  pick_id: string;
  username: string;
  body: string;
  item_name: string;
  created_at: string;
  read_at: string | null;
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
      pick_change_notifications: TableShape<PickChangeNotificationRow, never, { read_at?: string | null }>;
      notification_preferences: TableShape<NotificationPreferencesRow, { user_id: string; followee_pick_change?: boolean; updated_at?: string }, { followee_pick_change?: boolean; updated_at?: string }>;
    };
    Functions: Omit<Database['public']['Functions'], 'category_top_items' | 'home_pick_feed_page' | 'home_following_feed_page'> & {
      category_top_items: Omit<CategoryTopItems, 'Returns'> & {
        Returns: (CategoryTopItems['Returns'][number] & {
          image_path: string | null;
          image_source_url: string | null;
        })[];
      };
      home_pick_feed_page: {
        Args: { p_before_time?: string; p_before_id?: string };
        Returns: HomePickFeedRow[];
      };
      home_following_feed_page: {
        Args: { p_before_time?: string; p_before_id?: string };
        Returns: HomePickFeedRow[];
      };
      follow_counts: {
        Args: never;
        Returns: { following_count: number; follower_count: number }[];
      };
      notification_count: {
        Args: never;
        Returns: number;
      };
      notification_page: {
        Args: { p_before_time?: string; p_before_id?: string };
        Returns: NotificationPageRow[];
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
    };
  };
};
