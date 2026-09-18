import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { createGameCatalogHandler } from './gameCatalog.ts';

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
    .eq('provider', 'igdb').eq('cache_key', hashed).maybeSingle();
  if (error || !data) return null;
  const age = Date.now() - Date.parse(data.fetched_at);
  return Number.isFinite(age) && age >= 0 && age < maxAgeMs ? data.payload : null;
}

async function writeCache(client: SupabaseClient, key: string, payload: unknown) {
  const hashed = await sha256(key);
  const { error } = await client.from('external_catalog_cache').upsert({
    provider: 'igdb', cache_key: hashed, payload, fetched_at: new Date().toISOString(),
  });
  if (error) console.error('IGDB cache write failed', error.code);
}

async function writeDiagnostic(client: SupabaseClient, payload: Record<string, unknown>) {
  const hashed = await sha256('latest');
  const { error } = await client.from('external_catalog_cache').upsert({
    provider: 'igdb_diag',
    cache_key: hashed,
    payload,
    fetched_at: new Date().toISOString(),
  });
  if (error) console.error('IGDB diagnostic write failed', error.code);
}

async function waitForProvider(client: SupabaseClient) {
  const { data, error } = await client.rpc('reserve_external_catalog_slot', {
    p_provider: 'igdb', p_interval_ms: 650,
  });
  if (error || typeof data !== 'number') {
    console.error('IGDB rate reservation failed', error?.code ?? 'invalid_result');
    return false;
  }
  if (data > 2500) return false;
  if (data > 0) await new Promise((resolve) => setTimeout(resolve, data));
  return true;
}

const tokenKey = 'client_credentials';
async function readAccessToken(client: SupabaseClient) {
  const hashed = await sha256(tokenKey);
  const { data, error } = await client.from('external_catalog_cache').select('payload,fetched_at')
    .eq('provider', 'igdb_oauth').eq('cache_key', hashed).maybeSingle();
  if (error || !data || !data.payload || typeof data.payload !== 'object') return null;
  const payload = data.payload as Record<string, unknown>;
  const token = typeof payload.access_token === 'string' ? payload.access_token : '';
  const expiresIn = typeof payload.expires_in === 'number' ? payload.expires_in : 0;
  const fetchedAt = Date.parse(data.fetched_at);
  const validUntil = fetchedAt + Math.max(0, expiresIn - 300) * 1000;
  return token && Number.isFinite(validUntil) && Date.now() < validUntil ? token : null;
}

async function clearAccessToken(client: SupabaseClient) {
  const hashed = await sha256(tokenKey);
  await client.from('external_catalog_cache').delete().eq('provider', 'igdb_oauth').eq('cache_key', hashed);
}

async function fetchAccessToken(client: SupabaseClient, force = false) {
  if (!force) {
    const cached = await readAccessToken(client);
    if (cached) return cached;
  }
  const clientId = Deno.env.get('IGDB_CLIENT_ID')?.trim();
  const clientSecret = Deno.env.get('IGDB_CLIENT_SECRET')?.trim();
  if (!clientId || !clientSecret) {
    await writeDiagnostic(client, {
      stage: 'config',
      outcome: 'missing',
      hasClientId: Boolean(clientId),
      hasClientSecret: Boolean(clientSecret),
    });
    return null;
  }
  const url = new URL('https://id.twitch.tv/oauth2/token');
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('client_secret', clientSecret);
  url.searchParams.set('grant_type', 'client_credentials');
  try {
    const response = await fetch(url, { method: 'POST', signal: AbortSignal.timeout(8_000) });
    if (!response.ok) {
      console.error('IGDB Twitch token request failed', response.status);
      await writeDiagnostic(client, { stage: 'twitch_oauth', outcome: 'http_error', status: response.status });
      return null;
    }
    const data = await response.json() as Record<string, unknown>;
    const token = typeof data.access_token === 'string' ? data.access_token : '';
    const expiresIn = typeof data.expires_in === 'number' ? data.expires_in : 0;
    if (!token || expiresIn <= 0) {
      await writeDiagnostic(client, { stage: 'twitch_oauth', outcome: 'invalid_response' });
      return null;
    }
    const hashed = await sha256(tokenKey);
    const { error } = await client.from('external_catalog_cache').upsert({
      provider: 'igdb_oauth',
      cache_key: hashed,
      payload: { access_token: token, expires_in: expiresIn },
      fetched_at: new Date().toISOString(),
    });
    if (error) console.error('IGDB token cache write failed', error.code);
    await writeDiagnostic(client, { stage: 'twitch_oauth', outcome: 'ok' });
    return token;
  } catch (error) {
    console.error('IGDB Twitch token request error', error instanceof Error ? error.message : 'unknown');
    await writeDiagnostic(client, { stage: 'twitch_oauth', outcome: 'network_error' });
    return null;
  }
}

async function requestIgdb(query: string, client: SupabaseClient, forceToken = false) {
  const clientId = Deno.env.get('IGDB_CLIENT_ID')?.trim();
  const token = await fetchAccessToken(client, forceToken);
  if (!clientId || !token) return { error: json({ error: 'CATALOG_NOT_CONFIGURED' }, 503) } as const;
  if (!await waitForProvider(client)) {
    await writeDiagnostic(client, { stage: 'igdb', outcome: 'rate_limited' });
    return { error: json({ error: 'RATE_LIMITED' }, 429) } as const;
  }
  try {
    const response = await fetch('https://api.igdb.com/v4/games', {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Client-ID': clientId,
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'text/plain',
      },
      body: query,
      signal: AbortSignal.timeout(5_000),
    });
    if (response.status === 401 && !forceToken) {
      await clearAccessToken(client);
      return requestIgdb(query, client, true);
    }
    if (response.status === 429) {
      await writeDiagnostic(client, { stage: 'igdb', outcome: 'http_error', status: 429 });
      return { error: json({ error: 'RATE_LIMITED' }, 429) } as const;
    }
    if (!response.ok) {
      console.error('IGDB request failed', response.status);
      await writeDiagnostic(client, { stage: 'igdb', outcome: 'http_error', status: response.status });
      return { error: json({ error: 'CATALOG_UNAVAILABLE' }, 502) } as const;
    }
    const data = await response.json() as unknown;
    await writeDiagnostic(client, { stage: 'igdb', outcome: 'ok' });
    return { data } as const;
  } catch (error) {
    console.error('IGDB request error', error instanceof Error ? error.message : 'unknown');
    await writeDiagnostic(client, { stage: 'igdb', outcome: 'network_error' });
    return { error: json({ error: 'CATALOG_UNAVAILABLE' }, 502) } as const;
  }
}

const handler = createGameCatalogHandler({
  client: adminClient,
  fetchIgdb: requestIgdb,
  readCache,
  writeCache,
  json,
});

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'METHOD_NOT_ALLOWED' }, 405);
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: 'BODY_INVALID' }, 400); }
  return handler(body, req);
});
