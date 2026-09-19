import { AppError } from '@/errors/appError';
import { mapSupabaseError } from '@/errors/mapSupabaseError';
import { publicCountClient, type AppSupabaseClient } from '@/lib/supabase/client';

const SOURCE_COLUMNS = 'id,one_line_review,categories!picks_category_id_fkey!inner(name),items!picks_item_category_fk!inner(name)' as const;
const SOURCE_LIMIT = 50;

function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
}
function relation(value: unknown) {
  return object(Array.isArray(value) ? value[0] : value);
}
function hasText(value: unknown) {
  return typeof value === 'string' && value.trim().length > 0;
}

/** Match the Edge snapshot's required fields after public RLS/inner joins.
 * Return only a count; never cache source reviews or identifiers in this query. */
export function countProfileAiSourceRows(value: unknown): number {
  if (!Array.isArray(value) || value.length > SOURCE_LIMIT) throw new AppError('AI_REVIEW_FAILED');
  return value.filter((entry) => {
    const row = object(entry);
    return hasText(row.id) && hasText(row.one_line_review) &&
      hasText(relation(row.categories).name) && hasText(relation(row.items).name);
  }).length;
}

export async function readProfileAiEligibleCount(
  client: AppSupabaseClient, profileId: string, signal?: AbortSignal, timeoutMs = 8_000,
): Promise<number> {
  if (!profileId) throw new AppError('PROFILE_NOT_FOUND');
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new AppError('NETWORK_ERROR');
  if (signal?.aborted) throw new AppError('NETWORK_ERROR');
  const controller = new AbortController();
  let rejectInterrupted!: (error: AppError) => void;
  const interrupted = new Promise<never>((_resolve, reject) => { rejectInterrupted = reject; });
  const abort = () => {
    controller.abort();
    rejectInterrupted(new AppError('NETWORK_ERROR'));
  };
  signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(abort, timeoutMs);
  try {
    const read = async () => {
      const profileResult = await client.from('profiles').select('id').eq('id', profileId)
        .abortSignal(controller.signal).maybeSingle();
      if (profileResult.error) throw mapSupabaseError(profileResult.error);
      if (!profileResult.data) return 0;
      if (controller.signal.aborted) throw new AppError('NETWORK_ERROR');

      // Same public visibility, item states, ordering and bound as readSnapshot
      // in analyze-profile-taste. Never substitute the signed-in client.
      const result = await client.from('picks').select(SOURCE_COLUMNS)
        .eq('user_id', profileId).eq('status', 'active')
        .eq('categories.is_visible', true)
        .in('items.status', ['active', 'discontinued'])
        .order('id', { ascending: true }).limit(SOURCE_LIMIT)
        .abortSignal(controller.signal);
      if (result.error) throw mapSupabaseError(result.error);
      return countProfileAiSourceRows(result.data);
    };
    // Bound both reads even when a platform transport does not honor abort.
    return await Promise.race([read(), interrupted]);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
}

export const profileAiEligibilityService = {
  get: (profileId: string, signal?: AbortSignal) =>
    readProfileAiEligibleCount(publicCountClient, profileId, signal),
};
