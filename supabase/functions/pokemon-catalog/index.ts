import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { createPokemonCatalogHandler } from './pokemonCatalog.ts';

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
    .eq('provider', 'pokeapi').eq('cache_key', hashed).maybeSingle();
  if (error || !data) return null;
  const age = Date.now() - Date.parse(data.fetched_at);
  return Number.isFinite(age) && age >= 0 && age < maxAgeMs ? data.payload : null;
}

async function writeCache(client: SupabaseClient, key: string, payload: unknown) {
  const hashed = await sha256(key);
  const { error } = await client.from('external_catalog_cache').upsert({
    provider: 'pokeapi', cache_key: hashed, payload, fetched_at: new Date().toISOString(),
  });
  if (error) console.error('PokéAPI cache write failed', error.code);
}

const INDEX_QUERY = `query OnePickPokemonSpeciesIndex {
  pokemonspecies(limit: 2000, order_by: {id: asc}) {
    id
    name
    pokemonspeciesnames(where: {language: {name: {_in: ["ko", "en"]}}}) {
      name
      language { name }
    }
  }
}`;

async function fetchIndex() {
  try {
    const response = await fetch('https://graphql.pokeapi.co/v1beta2', {
      method: 'POST',
      headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: INDEX_QUERY }),
      signal: AbortSignal.timeout(10_000),
    });
    if (response.status === 429) return { error: json({ error: 'RATE_LIMITED' }, 429) } as const;
    if (!response.ok) {
      console.error('PokéAPI GraphQL request failed', response.status);
      return { error: json({ error: 'CATALOG_UNAVAILABLE' }, 502) } as const;
    }
    const payload = await response.json() as Record<string, unknown>;
    if (Array.isArray(payload.errors)) {
      console.error('PokéAPI GraphQL returned errors');
      return { error: json({ error: 'CATALOG_UNAVAILABLE' }, 502) } as const;
    }
    const data = payload.data && typeof payload.data === 'object' ? payload.data as Record<string, unknown> : null;
    const species = data && Array.isArray(data.pokemonspecies) ? data.pokemonspecies : null;
    return species ? { data: species } as const : { error: json({ error: 'CATALOG_UNAVAILABLE' }, 502) } as const;
  } catch (error) {
    console.error('PokéAPI GraphQL request error', error instanceof Error ? error.message : 'unknown');
    return { error: json({ error: 'CATALOG_UNAVAILABLE' }, 502) } as const;
  }
}

async function loadIndex(client: SupabaseClient) {
  const key = 'species-index-ko-en-v1';
  const fresh = await readCache(client, key, 24 * 60 * 60_000);
  if (Array.isArray(fresh)) return { data: fresh } as const;

  const remote = await fetchIndex();
  if (remote.data) {
    await writeCache(client, key, remote.data);
    return remote;
  }

  const stale = await readCache(client, key, 7 * 24 * 60 * 60_000);
  return Array.isArray(stale) ? { data: stale } as const : remote;
}

async function loadSpecies(client: SupabaseClient, id: string) {
  const key = `species:\n${id}`;
  const cached = await readCache(client, key, 30 * 24 * 60 * 60_000);
  if (cached && typeof cached === 'object' && !Array.isArray(cached)) return { data: cached } as const;

  try {
    const response = await fetch(`https://pokeapi.co/api/v2/pokemon-species/${encodeURIComponent(id)}/`, {
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(6_000),
    });
    if (response.status === 404) return { error: json({ error: 'POKEMON_NOT_FOUND' }, 404) } as const;
    if (response.status === 429) return { error: json({ error: 'RATE_LIMITED' }, 429) } as const;
    if (!response.ok) {
      console.error('PokéAPI species request failed', response.status);
      return { error: json({ error: 'CATALOG_UNAVAILABLE' }, 502) } as const;
    }
    const data = await response.json() as Record<string, unknown>;
    await writeCache(client, key, data);
    return { data } as const;
  } catch (error) {
    console.error('PokéAPI species request error', error instanceof Error ? error.message : 'unknown');
    return { error: json({ error: 'CATALOG_UNAVAILABLE' }, 502) } as const;
  }
}

const handler = createPokemonCatalogHandler({
  client: adminClient,
  loadIndex,
  loadSpecies,
  json,
});

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'METHOD_NOT_ALLOWED' }, 405);
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: 'BODY_INVALID' }, 400); }
  return handler(body, req);
});
