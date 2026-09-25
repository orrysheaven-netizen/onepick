import type { SupabaseClient } from '@supabase/supabase-js';
import { mapSupabaseError } from '@/errors/mapSupabaseError';
import { parseItemChannelLinks, type ItemChannelLink } from '@/lib/items/itemChannelLinks';
import { supabase } from '@/lib/supabase/client';
import type { Database } from '@/lib/supabase/database.types';

// item_channels is readable by anon/authenticated for active and discontinued
// items (add_restaurant_place_identity.sql) but is not in the generated types yet.
type ItemChannelRow = { item_id: string; channel: string; target_url: string | null; is_primary: boolean; created_at: string; updated_at: string };
type ItemChannelsDatabase = Omit<Database, 'public'> & {
  public: Omit<Database['public'], 'Tables'> & {
    Tables: Database['public']['Tables'] & {
      item_channels: {
        Row: ItemChannelRow;
        Insert: Partial<ItemChannelRow>;
        Update: Partial<ItemChannelRow>;
        Relationships: [];
      };
    };
  };
};
type ItemChannelsClient = SupabaseClient<ItemChannelsDatabase>;

export class ItemChannelLinkService {
  constructor(private readonly client: ItemChannelsClient) {}

  async list(itemId: string): Promise<ItemChannelLink[]> {
    const { data, error } = await this.client.from('item_channels')
      .select('channel,target_url,is_primary').eq('item_id', itemId);
    if (error) throw mapSupabaseError(error);
    return parseItemChannelLinks(data);
  }
}

export const itemChannelLinkService = new ItemChannelLinkService(supabase as unknown as ItemChannelsClient);
