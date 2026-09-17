import type { Database } from './database.types';

type CategoryTopItems = Database['public']['Functions']['category_top_items'];

// Additive return fields from include_catalog_images_in_card_reads.
// Keep this overlay until the generated database.types.ts is refreshed.
export type AppDatabase = Omit<Database, 'public'> & {
  public: Omit<Database['public'], 'Functions'> & {
    Functions: Omit<Database['public']['Functions'], 'category_top_items'> & {
      category_top_items: Omit<CategoryTopItems, 'Returns'> & {
        Returns: (CategoryTopItems['Returns'][number] & {
          image_path: string | null;
          image_source_url: string | null;
        })[];
      };
    };
  };
};
