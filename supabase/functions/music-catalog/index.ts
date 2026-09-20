import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { createMusicCatalogHandler, secureCoverUrl, type CoverLookup } from './musicCatalog.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
});

function adminClient() {
  const url = Deno.env.get('SUPABASE_URL')?.trim();
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')?.trim();
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function readCache(client: SupabaseClient, key: string, maxAgeMs: number) {
  const hashed = await sha256(key);
  const { data, error } = await client.from('external_catalog_cache').select('payload,fetched_at')
    .eq('provider', 'musicbrainz').eq('cache_key', hashed).maybeSingle();
  if (error || !data) return null;
  const age = Date.now() - Date.parse(data.fetched_at);
  return Number.isFinite(age) && age >= 0 && age < maxAgeMs ? data.payload : null;
}

async function writeCache(client: SupabaseClient, key: string, payload: unknown) {
  const hashed = await sha256(key);
  const { error } = await client.from('external_catalog_cache').upsert({
    provider: 'musicbrainz', cache_key: hashed, payload, fetched_at: new Date().toISOString(),
  });
  if (error) console.error('MusicBrainz cache write failed', error.code);
}

async function waitForProvider(client: SupabaseClient) {
  const { data, error } = await client.rpc('reserve_external_catalog_slot', {
    p_provider: 'musicbrainz', p_interval_ms: 1100,
  });
  if (error || typeof data !== 'number') {
    console.error('MusicBrainz rate reservation failed', error?.code ?? 'invalid_result');
    return false;
  }
  if (data > 3500) return false;
  if (data > 0) await new Promise((resolve) => setTimeout(resolve, data));
  return true;
}

const userAgent = 'OnePick/0.1 (https://onepick-5cl.pages.dev)';
async function fetchMusicBrainz(url: URL) {
  try {
    const response = await fetch(url, {
      headers: { Accept: 'application/json', 'User-Agent': userAgent },
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) {
      if (response.status === 404) return { error: json({ error: 'RECORDING_NOT_FOUND' }, 404) } as const;
      if (response.status === 503 || response.status === 429) return { error: json({ error: 'RATE_LIMITED' }, 429) } as const;
      console.error('MusicBrainz request failed', response.status);
      return { error: json({ error: 'CATALOG_UNAVAILABLE' }, 502) } as const;
    }
    return { data: await response.json() as Record<string, unknown> } as const;
  } catch (error) {
    console.error('MusicBrainz request error', error instanceof Error ? error.message : 'unknown');
    return { error: json({ error: 'CATALOG_UNAVAILABLE' }, 502) } as const;
  }
}

// Resolves to { url } when Cover Art Archive gave a definitive answer (a front
// image, or none at all) and to null when it could not be reached in time, so
// callers can cache only real answers. The archive redirects twice to slow
// storage hosts, hence the generous timeout.
async function fetchCoverArt(releaseGroupId: string): Promise<CoverLookup> {
  try {
    const response = await fetch(`https://coverartarchive.org/release-group/${releaseGroupId}`, {
      headers: { Accept: 'application/json', 'User-Agent': userAgent },
      signal: AbortSignal.timeout(8_000),
    });
    if (response.status === 404) return { url: null };
    if (!response.ok) {
      console.error('Cover Art Archive request failed', response.status);
      return null;
    }
    const data = await response.json() as { images?: unknown[] };
    if (!Array.isArray(data.images)) return { url: null };
    const rows = data.images.filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === 'object');
    const front = rows.find((row) => row.front === true && row.approved !== false) ?? rows.find((row) => row.front === true);
    if (!front) return { url: null };
    const thumbs = front.thumbnails && typeof front.thumbnails === 'object' ? front.thumbnails as Record<string, unknown> : {};
    const candidate = [thumbs['500'], thumbs['250'], front.image].find((value) => typeof value === 'string') as string | undefined;
    return { url: candidate ? secureCoverUrl(candidate) : null };
  } catch (error) {
    console.error('Cover Art Archive request error', error instanceof Error ? error.message : 'unknown');
    return null;
  }
}

// Supabase Edge Runtime keeps the worker alive for promises handed to
// EdgeRuntime.waitUntil; without it the isolate may stop once the response is sent.
declare const EdgeRuntime: { waitUntil?: (work: Promise<unknown>) => void } | undefined;
function keepAlive(work: Promise<unknown>) {
  if (typeof EdgeRuntime !== 'undefined' && typeof EdgeRuntime.waitUntil === 'function') EdgeRuntime.waitUntil(work);
  else void work;
}

const handler = createMusicCatalogHandler({
  client: adminClient, fetchMusicBrainz, fetchCoverArt, readCache, writeCache, waitForProvider, keepAlive, json,
});

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'METHOD_NOT_ALLOWED' }, 405);
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: 'BODY_INVALID' }, 400); }
  return handler(body, req);
});
