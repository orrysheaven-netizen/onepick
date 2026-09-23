import type { SupabaseClient } from '@supabase/supabase-js';

type JsonReply = (body: unknown, status?: number) => Response;

function callerAddress(req: Request) {
  const direct = req.headers.get('cf-connecting-ip')?.trim();
  if (direct) return direct.slice(0, 128);
  const forwarded = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  return (forwarded || 'unknown').slice(0, 128);
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

export async function guardCatalogSearch(
  req: Request,
  client: SupabaseClient,
  provider: string,
  json: JsonReply,
): Promise<Response | null> {
  const subjectHash = await sha256(`catalog-search:\n${provider}:\n${callerAddress(req)}`);
  const { data, error } = await client.rpc('consume_external_catalog_search', {
    p_provider: provider,
    p_subject_hash: subjectHash,
  });
  if (error) return json({ error: 'CATALOG_UNAVAILABLE' }, 503);
  return data === true ? null : json({ error: 'RATE_LIMITED' }, 429);
}
