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
    for (const row of data as { item_id: string; provider_id: string }[]) {
      if (row.item_id && row.provider_id) providers.set(row.item_id, row.provider_id);
    }
  } catch {
    // Provider navigation is enhancement-only; the Pick itself still renders.
  }
  return providers;
}
