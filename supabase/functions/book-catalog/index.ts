import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { createBookCatalogHandler } from './bookCatalog.ts';

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
    .eq('provider', 'nlk_isbn').eq('cache_key', hashed).maybeSingle();
  if (error || !data) return null;
  const age = Date.now() - Date.parse(data.fetched_at);
  return Number.isFinite(age) && age >= 0 && age < maxAgeMs ? data.payload : null;
}

async function writeCache(client: SupabaseClient, key: string, payload: unknown) {
  const hashed = await sha256(key);
  const { error } = await client.from('external_catalog_cache').upsert({
    provider: 'nlk_isbn', cache_key: hashed, payload, fetched_at: new Date().toISOString(),
  });
  if (error) console.error('NLK ISBN cache write failed', error.code);
}

async function fetchNlk(url: URL) {
  try {
    const response = await fetch(url, {
      headers: { Accept: 'application/json', 'User-Agent': 'OnePick/0.1 (https://onepick-5cl.pages.dev)' },
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) {
      console.error('NLK ISBN request failed', response.status);
      return { error: json({ error: 'CATALOG_UNAVAILABLE' }, 502) } as const;
    }
    const data = await response.json() as unknown;
    if (data && typeof data === 'object' && !Array.isArray(data)) {
      const row = data as Record<string, unknown>;
      const code = String(row.ERROR_CODE ?? row.errorCode ?? row.code ?? '');
      if (code === '010' || code === '011') return { error: json({ error: 'CATALOG_NOT_CONFIGURED' }, 503) } as const;
      if (code === '000' || code === '101') return { error: json({ error: 'CATALOG_UNAVAILABLE' }, 502) } as const;
    }
    return { data } as const;
  } catch (error) {
    console.error('NLK ISBN request error', error instanceof Error ? error.message : 'unknown');
    return { error: json({ error: 'CATALOG_UNAVAILABLE' }, 502) } as const;
  }
}

const handler = createBookCatalogHandler({
  client: adminClient,
  fetchNlk,
  readCache,
  writeCache,
  json,
  apiKey: () => Deno.env.get('NLK_OPEN_API_KEY')?.trim() || null,
});

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'METHOD_NOT_ALLOWED' }, 405);
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: 'BODY_INVALID' }, 400); }
  return handler(body, req);
});
