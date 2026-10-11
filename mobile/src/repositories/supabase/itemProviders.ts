import type { SupabaseClient } from '@supabase/supabase-js';

import type { AppSupabaseClient } from '@/lib/supabase/client';

/**
 * Public provider identity per item. Optional by design: legacy/catalog items do
 * not have a provider, and a failed auxiliary lookup must not break the card.
 */
export async function fetchItemProviderIds(client: AppSupabaseClient, itemIds: readonly string[]) {
  const providers = new Map<string, string>();
  const ids = [...new Set(itemIds)];
  if (!ids.length) return providers;
  try {
    // provider foundation tables are newer than the generated database types.
    const db = client as unknown as SupabaseClient;
    const { data, error } = await db.from('item_providers')
      .select('item_id, provider_id')
      .in('item_id', ids);
    if (error || !Array.isArray(data)) return providers;
    // item_providers.item_id is the primary key (20260924231500), so one item has
    // at most one store. Should a response ever disagree, leave that item without
    // a store link instead of letting row order pick one.
    const conflicted = new Set<string>();
    for (const row of data as { item_id: string; provider_id: string }[]) {
      if (!row.item_id || !row.provider_id || conflicted.has(row.item_id)) continue;
      const known = providers.get(row.item_id);
      if (known && known !== row.provider_id) {
        providers.delete(row.item_id);
        conflicted.add(row.item_id);
      } else {
        providers.set(row.item_id, row.provider_id);
      }
    }
  } catch {
    // Provider navigation is enhancement-only; the Pick itself still renders.
  }
  return providers;
}
