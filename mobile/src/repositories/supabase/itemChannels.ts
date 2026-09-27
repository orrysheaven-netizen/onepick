import type { SupabaseClient } from '@supabase/supabase-js';

import type { AppSupabaseClient } from '@/lib/supabase/client';
import type { PickChannel } from '@/lib/items/pickChannel';

/**
 * Channels (offline store / online / recipe) per item from public.item_channels,
 * representative channel first. Items without a channel (packaged products,
 * content catalogs) are absent.
 *
 * The channel only feeds a label, so a failed lookup degrades to "no label"
 * instead of failing the screen that asked for it.
 */
export async function fetchItemChannels(client: AppSupabaseClient, itemIds: readonly string[]) {
  const channels = new Map<string, PickChannel[]>();
  const ids = [...new Set(itemIds)];
  if (!ids.length) return channels;
  try {
    // item_channels is not in the generated types yet.
    const db = client as unknown as SupabaseClient;
    const { data, error } = await db.from('item_channels').select('item_id, channel, is_primary').in('item_id', ids);
    if (error || !Array.isArray(data)) return channels;
    const rows = [...(data as { item_id: string; channel: unknown; is_primary?: unknown }[])]
      .sort((a, b) => Number(b.is_primary === true) - Number(a.is_primary === true));
    for (const row of rows) {
      if (row.channel !== 'offline' && row.channel !== 'online' && row.channel !== 'recipe') continue;
      const list = channels.get(row.item_id) ?? [];
      if (!list.includes(row.channel)) list.push(row.channel);
      channels.set(row.item_id, list);
    }
  } catch {
    // Keep the screen usable without the label.
  }
  return channels;
}
