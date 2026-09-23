import { createClient } from '@supabase/supabase-js';

const BUCKET = 'item-photos';
const MAX_OBJECTS_PER_RUN = 1000;
const BATCH_SIZE = 100;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return json({ error: 'METHOD_NOT_ALLOWED' }, 405);

  const url = Deno.env.get('SUPABASE_URL')?.trim();
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')?.trim();
  if (!url || !serviceRoleKey) return json({ error: 'CLEANUP_NOT_CONFIGURED' }, 503);

  const admin = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  const lease = await admin.rpc('claim_item_photo_cleanup');
  if (lease.error) {
    console.error('item photo cleanup lease failed', lease.error.code ?? 'unknown');
    return json({ error: 'CLEANUP_UNAVAILABLE' }, 503);
  }
  if (lease.data !== true) return json({ ok: true, skipped: true, deleted: 0 });

  let deleted = 0;
  for (;;) {
    const { data, error } = await admin.rpc('stale_item_photo_paths', { p_limit: BATCH_SIZE });
    if (error) {
      console.error('item photo cleanup list failed', error.code ?? 'unknown');
      return json({ error: 'CLEANUP_UNAVAILABLE' }, 503);
    }

    const paths = (data ?? [])
      .map((row: { path?: unknown }) => typeof row.path === 'string' ? row.path : '')
      .filter(Boolean)
      .slice(0, Math.min(BATCH_SIZE, MAX_OBJECTS_PER_RUN-deleted));

    if (!paths.length) break;

    // Supabase Storage objects must be removed through the Storage API so the
    // backing object and metadata are deleted together.
    const removed = await admin.storage.from(BUCKET).remove(paths);
    if (removed.error) {
      console.error('item photo cleanup remove failed', removed.error.statusCode ?? 'unknown');
      return json({ error: 'CLEANUP_UNAVAILABLE' }, 502);
    }

    deleted += paths.length;
    if (deleted >= MAX_OBJECTS_PER_RUN || paths.length < BATCH_SIZE) break;
  }

  return json({ ok: true, skipped: false, deleted });
});
