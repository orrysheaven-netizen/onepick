import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { createYouTubeCatalogHandler } from './youtubeCatalog.ts';

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
    .eq('provider', 'youtube').eq('cache_key', hashed).maybeSingle();
  if (error || !data) return null;
  const age = Date.now() - Date.parse(data.fetched_at);
  return Number.isFinite(age) && age >= 0 && age < maxAgeMs ? data.payload : null;
}

async function writeCache(client: SupabaseClient, key: string, payload: unknown) {
  const hashed = await sha256(key);
  const { error } = await client.from('external_catalog_cache').upsert({
    provider: 'youtube', cache_key: hashed, payload, fetched_at: new Date().toISOString(),
  });
  if (error) console.error('YouTube cache write failed', error.code);
}

async function fetchYouTube(url: URL) {
  try {
    const response = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(6_000),
    });
    if (!response.ok) {
      let reason = '';
      try {
        const payload = await response.clone().json() as Record<string, unknown>;
        const error = payload.error && typeof payload.error === 'object' ? payload.error as Record<string, unknown> : {};
        const errors = Array.isArray(error.errors) ? error.errors : [];
        const first = errors[0] && typeof errors[0] === 'object' ? errors[0] as Record<string, unknown> : {};
        reason = typeof first.reason === 'string' ? first.reason : '';
      } catch { /* Ignore error-body parse failures. */ }
      if (response.status === 429 || ['quotaExceeded','dailyLimitExceeded','rateLimitExceeded'].includes(reason)) {
        return { error: json({ error: 'RATE_LIMITED' }, 429) } as const;
      }
      console.error('YouTube Data API request failed', response.status, reason || 'unknown');
      return { error: json({ error: 'CATALOG_UNAVAILABLE' }, 502) } as const;
    }
    return { data: await response.json() as Record<string, unknown> } as const;
  } catch (error) {
    console.error('YouTube Data API request error', error instanceof Error ? error.message : 'unknown');
    return { error: json({ error: 'CATALOG_UNAVAILABLE' }, 502) } as const;
  }
}

const handler = createYouTubeCatalogHandler({
  client: adminClient,
  fetchYouTube,
  readCache,
  writeCache,
  apiKey: () => Deno.env.get('YOUTUBE_API_KEY')?.trim() || null,
  json,
});

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'METHOD_NOT_ALLOWED' }, 405);
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: 'BODY_INVALID' }, 400); }
  return handler(body, req);
});
