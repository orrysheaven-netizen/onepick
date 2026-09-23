import type { SupabaseClient } from '@supabase/supabase-js';

async function sha256(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function reserveExternalCatalogCaller(
  client: SupabaseClient,
  provider: 'tmdb' | 'musicbrainz' | 'igdb' | 'google_books',
  req: Request,
) {
  const authorization = req.headers.get('Authorization') ?? '';
  const token = authorization.startsWith('Bearer ') ? authorization.slice(7).trim() : '';
  let userId: string | null = null;
  if (token) {
    const { data, error } = await client.auth.getUser(token);
    if (!error && data.user && !data.user.is_anonymous) userId = data.user.id;
  }

  const forwarded = req.headers.get('cf-connecting-ip')
    ?? req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    ?? 'unknown';
  const ipHash = await sha256(forwarded.slice(0, 128));
  const { data, error } = await client.rpc('reserve_external_catalog_caller', {
    p_provider: provider,
    p_user_id: userId,
    p_ip_hash: ipHash,
  });
  return !error && data === true;
}
