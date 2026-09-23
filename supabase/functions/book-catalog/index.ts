import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { createBookCatalogHandler } from './bookCatalog.ts';
import { reserveExternalCatalogCaller } from '../_shared/externalCatalogGuard.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, 'Content-Type': 'application/json' },
});

function adminClient() {
  const url = Deno.env.get('SUPABASE_URL')?.trim();
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')?.trim();
  if (!url || !key) return null;
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

async function readCache(client: SupabaseClient, key: string, maxAgeMs: number) {
  const hashed = await sha256(key);
  const { data, error } = await client
    .from('external_catalog_cache')
    .select('payload,fetched_at')
    .eq('provider', 'google_books')
    .eq('cache_key', hashed)
    .maybeSingle();
  if (error || !data) return null;
  const age = Date.now() - Date.parse(data.fetched_at);
  return Number.isFinite(age) && age >= 0 && age < maxAgeMs ? data.payload : null;
}

async function writeCache(client: SupabaseClient, key: string, payload: unknown) {
  const hashed = await sha256(key);
  const { error } = await client.from('external_catalog_cache').upsert({
    provider: 'google_books',
    cache_key: hashed,
    payload,
    fetched_at: new Date().toISOString(),
  });
  if (error) console.error('Google Books cache write failed', error.code);
}

async function writeDiagnostic(client: SupabaseClient, payload: Record<string, unknown>) {
  const hashed = await sha256('latest');
  const { error } = await client.from('external_catalog_cache').upsert({
    provider: 'google_books_diag',
    cache_key: hashed,
    payload,
    fetched_at: new Date().toISOString(),
  });
  if (error) console.error('Google Books diagnostic write failed', error.code);
}

async function waitForProvider(client: SupabaseClient) {
  const { data, error } = await client.rpc('reserve_external_catalog_slot', {
    p_provider: 'google_books',
    p_interval_ms: 200,
  });
  if (error || typeof data !== 'number') {
    console.error('Google Books rate reservation failed', error?.code ?? 'invalid_result');
    return false;
  }
  if (data > 3500) return false;
  if (data > 0) await new Promise((resolve) => setTimeout(resolve, data));
  return true;
}

function retryAfterMs(response: Response, attempt: number) {
  const header = response.headers.get('retry-after')?.trim() ?? '';
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(3_000, Math.max(500, Math.round(seconds * 1000)));
  }
  return Math.min(3_000, 500 * (2 ** attempt));
}

async function fetchGoogleBooks(url: URL, client: SupabaseClient) {
  const key = Deno.env.get('GOOGLE_BOOKS_API_KEY')?.trim();
  if (!key) {
    await writeDiagnostic(client, {
      stage: 'google_books',
      outcome: 'missing_api_key',
      authenticated: false,
    });
    return { error: json({ error: 'CATALOG_NOT_CONFIGURED' }, 503) } as const;
  }
  url.searchParams.set('key', key);

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch(url, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(7_000),
      });

      if (response.status === 404) {
        await writeDiagnostic(client, {
          stage: 'google_books',
          outcome: 'not_found',
          authenticated: Boolean(key),
        });
        return { error: json({ error: 'BOOK_NOT_FOUND' }, 404) } as const;
      }

      if (response.status === 429) {
        const waitMs = retryAfterMs(response, attempt);
        if (attempt < 2) {
          await new Promise((resolve) => setTimeout(resolve, waitMs));
          continue;
        }
        await writeDiagnostic(client, {
          stage: 'google_books',
          outcome: 'rate_limited',
          authenticated: Boolean(key),
          attempts: attempt + 1,
          retryAfterMs: waitMs,
        });
        return {
          error: json(
            { error: 'RATE_LIMITED', retryAfterSeconds: Math.max(1, Math.ceil(waitMs / 1000)) },
            429,
          ),
        } as const;
      }

      if (!response.ok) {
        console.error('Google Books request failed', response.status);
        await writeDiagnostic(client, {
          stage: 'google_books',
          outcome: 'http_error',
          status: response.status,
          authenticated: Boolean(key),
        });
        return { error: json({ error: 'CATALOG_UNAVAILABLE' }, 502) } as const;
      }

      const body = await response.json() as Record<string, unknown>;
      await writeDiagnostic(client, {
        stage: 'google_books',
        outcome: 'ok',
        authenticated: Boolean(key),
        attempts: attempt + 1,
      });
      return { data: body } as const;
    } catch (error) {
      if (attempt < 2) {
        await new Promise((resolve) => setTimeout(resolve, Math.min(3_000, 500 * (2 ** attempt))));
        continue;
      }
      console.error(
        'Google Books request error',
        error instanceof Error ? error.name : 'unknown',
      );
      await writeDiagnostic(client, {
        stage: 'google_books',
        outcome: 'network_error',
        authenticated: Boolean(key),
        attempts: attempt + 1,
      });
      return { error: json({ error: 'CATALOG_UNAVAILABLE' }, 502) } as const;
    }
  }

  return { error: json({ error: 'CATALOG_UNAVAILABLE' }, 502) } as const;
}

const handler = createBookCatalogHandler({
  client: adminClient,
  fetchGoogleBooks,
  readCache,
  writeCache,
  waitForProvider,
  json,
});

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'METHOD_NOT_ALLOWED' }, 405);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'BODY_INVALID' }, 400);
  }
  if (body.action === 'search') {
    const client = adminClient();
    if (!client) return json({ error: 'CATALOG_NOT_CONFIGURED' }, 503);
    if (!await reserveExternalCatalogCaller(client, 'google_books', req)) {
      return json({ error: 'RATE_LIMITED' }, 429);
    }
  }
  return handler(body, req);
});
