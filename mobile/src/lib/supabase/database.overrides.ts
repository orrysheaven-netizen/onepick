import type { Database } from './database.types';

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
  started_at: string;
};

// Additive RPC fields until the central generated types are refreshed.
export type AppDatabase = Omit<Database, 'public'> & {
  public: Omit<Database['public'], 'Functions'> & {
    Functions: Omit<Database['public']['Functions'], 'category_top_items'> & {
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
      item_photo_credit: {
        Args: { p_item_id: string };
        Returns: { item_id: string; user_id: string; username: string; image_path: string; image_source_url: string | null }[];
      };
    };
  };
};
