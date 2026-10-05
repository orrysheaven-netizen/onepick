import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
});

type PlaceRow = {
  id: string;
  name: string;
  normalized_name: string;
  branch_name: string | null;
  road_address: string | null;
  address: string | null;
  region_1: string | null;
  region_2: string | null;
  provider_category: string | null;
  business_status: string;
};
type CategoryRow = {
  id: string;
  name: string;
  slug: string;
  parent_id: string | null;
  status: string;
  is_visible: boolean;
  is_pickable: boolean;
};
type SourceRow = { category_id: string; mode: string; is_enabled: boolean };
type TermRow = { category_id: string; term: string; kind: string };

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function makeClient(service = false, authHeader = '') {
  const url = Deno.env.get('SUPABASE_URL')?.trim();
  const key = Deno.env.get(service ? 'SUPABASE_SERVICE_ROLE_KEY' : 'SUPABASE_ANON_KEY')?.trim();
  if (!url || !key) return null;
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    ...(authHeader ? { global: { headers: { Authorization: authHeader } } } : {}),
  });
}

function cleanText(value: unknown, max = 300) {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').slice(0, max) : '';
}
function norm(value: string) {
  return value.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
}
// Mirrors private.normalize_place_name (trim, drop whitespace, lowercase) so
// punctuation such as "(본점)" or "&" still matches place_catalog.normalized_name.
// ILIKE wildcard/escape characters are dropped so user text stays a literal substring.
function placeSearchName(value: string) {
  return value.trim().replace(/\s+/g, '').toLowerCase().replace(/[%_\\]/g, '');
}
// Branch names are stored without the trailing 점 that Naver titles add.
function branchKey(value: string) {
  return placeSearchName(value).replace(/점$/, '');
}
function placeFullName(place: Pick<PlaceRow, 'name' | 'branch_name'>) {
  return branchKey(place.name + (place.branch_name ?? ''));
}
function naverHost(hostname: string) {
  const host = hostname.toLowerCase();
  return host === 'naver.me' || host === 'naver.com' || host.endsWith('.naver.com');
}
function naverPlaceHost(hostname: string) {
  const host = hostname.toLowerCase();
  return host === 'map.naver.com' || host === 'place.naver.com'
    || host === 'm.place.naver.com' || host.endsWith('.place.naver.com');
}
function httpsUrl(value: unknown) {
  if (typeof value !== 'string' || value.length > 2048) return null;
  try {
    const parsed = new URL(value.trim());
    return parsed.protocol === 'https:' && !parsed.username && !parsed.password ? parsed : null;
  } catch {
    return null;
  }
}
function decodeHtml(value: string) {
  return value.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>');
}
function meta(html: string, key: string) {
  const tags = html.match(/<meta\b[^>]*>/gi) ?? [];
  for (const tag of tags) {
    const property = /\b(?:property|name)\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1] ?? '';
    if (property.toLowerCase() !== key.toLowerCase()) continue;
    const content = /\bcontent\s*=\s*["']([^"']*)["']/i.exec(tag)?.[1] ?? '';
    if (content) return decodeHtml(content).trim();
  }
  return '';
}
function titleFromHtml(html: string) {
  const og = meta(html, 'og:title');
  if (og) return og;
  const m = /<title[^>]*>([^<]+)<\/title>/i.exec(html);
  return m?.[1] ? decodeHtml(m[1]).trim() : '';
}
function cleanNaverTitle(value: string) {
  const title = value
    // Naver pages can append invisible control characters (seen: U+001C) to og:title.
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/\s*[:|\-]\s*네이버(?:\s*(?:지도|플레이스))?\s*$/i, '')
    .replace(/\s*네이버(?:\s*(?:지도|플레이스))?\s*$/i, '')
    .trim()
    .slice(0, 100);
  // Generic page titles ("네이버 지도", "네이버 플레이스", "NAVER") are not a store name.
  return /^(?:naver)?$/i.test(title) ? '' : title;
}
// naver.me share links land on map.naver.com/p/entry/place/<id>, a script-rendered page
// without a title; the mobile place page for the same id carries og:title.
function naverPlaceId(url: URL) {
  return /\/(?:place|restaurant|cafe)\/(\d{3,15})(?:[/?#]|$)/.exec(url.pathname)?.[1] ?? null;
}
const LINK_USER_AGENT = 'Mozilla/5.0 OnePick-LinkResolver/1.0';
const MOBILE_USER_AGENT = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148';
async function limitedText(response: Response, maxBytes = 160000) {
  if (!response.body) return '';
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let total = 0;
  let out = '';
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      total += part.value.byteLength;
      if (total > maxBytes) break;
      out += decoder.decode(part.value, { stream: true });
    }
  } finally {
    try { await reader.cancel(); } catch {}
  }
  return out + decoder.decode();
}
async function reserveSlot(client: SupabaseClient, provider: string, intervalMs: number, maxWaitMs: number) {
  const result = await client.rpc('reserve_external_catalog_slot', {
    p_provider: provider,
    p_interval_ms: intervalMs,
  });
  if (result.error || typeof result.data !== 'number' || result.data > maxWaitMs) return false;
  if (result.data > 0) await new Promise((resolve) => setTimeout(resolve, result.data));
  return true;
}
// A per-user slot is taken before the shared Naver slot, so one caller spamming links
// only pushes back their own next slot instead of exhausting the global budget.
// The slot key fits reserve_external_catalog_slot's ^[a-z][a-z0-9_]{0,31}$ contract.
function naverUserSlot(userId: string) {
  return 'nlu_' + userId.toLowerCase().replace(/[^0-9a-f]/g, '').slice(0, 28);
}
async function reserveNaver(client: SupabaseClient, userId: string) {
  if (!await reserveSlot(client, naverUserSlot(userId), 1500, 3000)) return false;
  return reserveSlot(client, 'naver_link', 800, 2500);
}
async function fetchNaverPage(input: URL, userAgent: string) {
  let current = input;
  let html = '';
  let loaded = false;
  for (let i = 0; i < 5; i++) {
    if (!naverHost(current.hostname)) throw new Error('URL_UNSUPPORTED');
    const response = await fetch(current, {
      method: 'GET',
      redirect: 'manual',
      headers: { Accept: 'text/html,application/xhtml+xml', 'User-Agent': userAgent },
      signal: AbortSignal.timeout(6000),
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location');
      await response.body?.cancel();
      if (!location) throw new Error('LINK_RESOLVE_FAILED');
      const next = new URL(location, current);
      if (next.protocol !== 'https:' || !naverHost(next.hostname)) throw new Error('URL_UNSUPPORTED');
      current = next;
      continue;
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error('LINK_RESOLVE_FAILED');
    }
    html = await limitedText(response);
    loaded = true;
    break;
  }
  if (!loaded) throw new Error('LINK_RESOLVE_FAILED');
  return { url: current, html };
}
async function resolveNaver(input: URL, client: SupabaseClient, userId: string) {
  if (!await reserveNaver(client, userId)) throw new Error('RATE_LIMITED');
  const page = await fetchNaverPage(input, LINK_USER_AGENT);
  let title = cleanNaverTitle(titleFromHtml(page.html));
  let description = cleanText(meta(page.html, 'og:description'), 240);
  const placeId = title ? null : naverPlaceId(page.url);
  if (placeId) {
    try {
      const place = await fetchNaverPage(new URL('https://m.place.naver.com/place/' + placeId + '/home'), MOBILE_USER_AGENT);
      title = cleanNaverTitle(titleFromHtml(place.html));
      description = description || cleanText(meta(place.html, 'og:description'), 240);
    } catch { /* The name step stays available when the place page cannot be read. */ }
  }
  return { canonicalUrl: page.url.toString(), title, description };
}

// PostgREST caps each response at max_rows (1000), so read reference tables page by page
// instead of silently scoring against a truncated taxonomy.
async function readAll<T>(page: (from: number, to: number) => PromiseLike<{ data: unknown; error: unknown }>) {
  const size = 1000;
  const rows: T[] = [];
  for (let from = 0; from < 20 * size; from += size) {
    const result = await page(from, from + size - 1);
    if (result.error) throw new Error('CATEGORY_READ_FAILED');
    const data = (result.data ?? []) as T[];
    rows.push(...data);
    if (data.length < size) return rows;
  }
  throw new Error('CATEGORY_READ_FAILED');
}

function foodPath(categoryId: string, byId: Map<string, CategoryRow>) {
  const names: string[] = [];
  const seen = new Set<string>();
  let current = byId.get(categoryId);
  let food = false;
  while (current && names.length < 4 && !seen.has(current.id)) {
    seen.add(current.id);
    names.unshift(current.name);
    if (current.slug === 'food') food = true;
    current = current.parent_id ? byId.get(current.parent_id) : undefined;
  }
  return food ? names.join(' › ') : null;
}

function scoreCategories(categories: CategoryRow[], sources: SourceRow[], terms: TermRow[], context: string) {
  const normalizedContext = norm(context);
  const internal = new Set(sources.filter((row) => row.mode === 'internal' && row.is_enabled).map((row) => row.category_id));
  const byId = new Map(categories.map((row) => [row.id, row]));
  const allowed = categories
    .filter((row) => row.status === 'open' && row.is_visible && row.is_pickable && internal.has(row.id))
    .map((row) => {
      const label = foodPath(row.id, byId);
      return label ? { ...row, label } : null;
    })
    .filter((row): row is CategoryRow & { label: string } => Boolean(row));

  const byCategory = new Map<string, TermRow[]>();
  for (const term of terms) {
    const list = byCategory.get(term.category_id) ?? [];
    list.push(term);
    byCategory.set(term.category_id, list);
  }

  const ranked = allowed.map((category) => {
    const candidates = [
      { term: category.name, kind: 'name' },
      ...(byCategory.get(category.id) ?? []).map((row) => ({ term: row.term, kind: row.kind })),
    ];
    let best = 0;
    let matched = '';
    let matchedKind = '';
    for (const candidate of candidates) {
      const token = norm(candidate.term);
      if (token.length < 2 || normalizedContext.length < 2) continue;
      let score = 0;
      if (normalizedContext === token) score = 130;
      else if (normalizedContext.includes(token)) {
        score = candidate.kind === 'name' ? 110 : candidate.kind === 'alias' ? 105 : 98;
        score += Math.min(token.length, 16);
      } else if (token.includes(normalizedContext)) score = 62;
      if (score > best) {
        best = score;
        matched = candidate.term;
        matchedKind = candidate.kind;
      }
    }
    return {
      categoryId: category.id,
      label: category.label,
      name: category.name,
      score: best,
      reason: matched
        ? (matchedKind === 'name' ? '“' + matched + '” 표현과 일치' : '“' + matched + '” 관련어와 일치')
        : '',
    };
  }).filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score || a.label.localeCompare(b.label, 'ko'));

  return {
    categories: allowed.map((row) => ({ categoryId: row.id, label: row.label, name: row.name }))
      .sort((a, b) => a.label.localeCompare(b.label, 'ko')),
    suggestions: ranked.slice(0, 4).map((row) => ({
      categoryId: row.categoryId,
      label: row.label,
      name: row.name,
      reason: row.reason,
    })),
  };
}

function sortPlaces(rows: PlaceRow[], query: string) {
  const q = placeSearchName(query);
  return [...rows].sort((a, b) => {
    const an = placeSearchName(a.name);
    const bn = placeSearchName(b.name);
    const ar = an === q ? 0 : an.startsWith(q) ? 1 : an.includes(q) ? 2 : 3;
    const br = bn === q ? 0 : bn.startsWith(q) ? 1 : bn.includes(q) ? 2 : 3;
    return ar - br || a.name.localeCompare(b.name, 'ko') || (a.branch_name ?? '').localeCompare(b.branch_name ?? '', 'ko');
  }).slice(0, 8);
}

async function findPlaces(client: SupabaseClient, name: string, placeCatalogId: string | null) {
  const columns = 'id,name,normalized_name,branch_name,road_address,address,region_1,region_2,provider_category,business_status';
  if (placeCatalogId) {
    const result = await client.from('place_catalog').select(columns)
      .eq('id', placeCatalogId).eq('business_status', 'open').maybeSingle();
    if (result.error) throw new Error('PLACE_READ_FAILED');
    return result.data ? [result.data as PlaceRow] : [];
  }
  const q = placeSearchName(name);
  if (q.length < 2 || q.length > 100) return [];
  const result = await client.from('place_catalog').select(columns)
    .eq('business_status', 'open').ilike('normalized_name', '%' + q + '%').limit(20);
  if (result.error) throw new Error('PLACE_READ_FAILED');
  let rows = (result.data ?? []) as PlaceRow[];
  // Naver titles carry the branch ("스타벅스 강남우성점") while the catalog keeps it
  // apart (name 스타벅스, branch_name 강남우성), so a full-title miss retries each
  // brand / branch split of the title's words.
  const words = name.trim().split(/\s+/);
  for (let i = 1; rows.length === 0 && i < words.length && i <= 3; i++) {
    const head = placeSearchName(words.slice(0, i).join(''));
    const branch = branchKey(words.slice(i).join(''));
    if (head.length < 2 || !branch) continue;
    const split = await client.from('place_catalog').select(columns)
      .eq('business_status', 'open').eq('normalized_name', head)
      .ilike('branch_name', '%' + branch + '%').limit(20);
    if (split.error) throw new Error('PLACE_READ_FAILED');
    rows = (split.data ?? []) as PlaceRow[];
  }
  // Naver names can add a word the catalog lacks ("을밀대 평양냉면" vs 을밀대): list the
  // first word's stores so the person can pick; none of them is an exact match.
  const first = placeSearchName(words[0] ?? '');
  if (rows.length === 0 && words.length > 1 && first.length >= 2) {
    const brand = await client.from('place_catalog').select(columns)
      .eq('business_status', 'open').eq('normalized_name', first).limit(20);
    if (brand.error) throw new Error('PLACE_READ_FAILED');
    rows = (brand.data ?? []) as PlaceRow[];
  }
  return sortPlaces(rows, name);
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (req.method !== 'POST') return json({ error: 'METHOD_NOT_ALLOWED' }, 405);

  const authHeader = req.headers.get('Authorization') ?? '';
  const match = authHeader.length <= 8192 ? /^Bearer ([^\s]+)$/i.exec(authHeader) : null;
  if (!match) return json({ error: 'AUTH_REQUIRED' }, 401);

  const user = makeClient(false, authHeader);
  const admin = makeClient(true);
  if (!user || !admin) return json({ error: 'LINK_SUGGESTION_NOT_CONFIGURED' }, 503);

  const auth = await user.auth.getUser(match[1]);
  if (auth.error || !auth.data.user || auth.data.user.is_anonymous) return json({ error: 'AUTH_REQUIRED' }, 401);

  const suspended = await admin.rpc('catalog_user_is_suspended', { p_user_id: auth.data.user.id });
  if (suspended.error) return json({ error: 'LINK_SUGGESTION_UNAVAILABLE' }, 503);
  if (suspended.data === true) return json({ error: 'ITEM_NOT_ELIGIBLE' }, 409);

  try {
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;

    if (body.action === 'attach_pending_link') {
      const itemId = typeof body.itemId === 'string' && UUID_PATTERN.test(body.itemId) ? body.itemId : '';
      const pendingUrl = httpsUrl(body.url);
      if (!itemId || !pendingUrl) return json({ error: 'INPUT_INVALID' }, 400);

      const itemResult = await admin.from('items').select('id,status,created_by')
        .eq('id', itemId).maybeSingle();
      if (itemResult.error) return json({ error: 'LINK_SUGGESTION_UNAVAILABLE' }, 503);
      if (!itemResult.data || itemResult.data.created_by !== auth.data.user.id) {
        return json({ error: 'ITEM_NOT_FOUND' }, 404);
      }
      if (itemResult.data.status !== 'pending') return json({ error: 'ITEM_NOT_ELIGIBLE' }, 409);

      const updateResult = await admin.from('items').update({ official_url: pendingUrl.toString() })
        .eq('id', itemId).eq('created_by', auth.data.user.id).eq('status', 'pending')
        .select('id');
      if (updateResult.error) return json({ error: 'LINK_SAVE_FAILED' }, 503);
      // The item can leave pending (admin review) between the read and the update.
      if (!updateResult.data?.length) return json({ error: 'ITEM_NOT_ELIGIBLE' }, 409);
      return json({ ok: true });
    }

    const parsed = httpsUrl(body.url);
    if (!parsed) return json({ error: 'URL_INVALID' }, 400);

    const requestedName = cleanText(body.name, 100);
    const placeCatalogId = typeof body.placeCatalogId === 'string' && UUID_PATTERN.test(body.placeCatalogId)
      ? body.placeCatalogId : null;

    let canonicalUrl = parsed.toString();
    let title = '';
    let description = '';
    let naverResolved = false;
    if (naverHost(parsed.hostname)) {
      try {
        const resolved = await resolveNaver(parsed, admin, auth.data.user.id);
        canonicalUrl = resolved.canonicalUrl;
        title = resolved.title;
        description = resolved.description;
        naverResolved = true;
      } catch (error) {
        if (error instanceof Error && error.message === 'RATE_LIMITED') return json({ error: 'RATE_LIMITED' }, 429);
      }
    }

    const canonicalHost = new URL(canonicalUrl).hostname;
    const kind = naverPlaceHost(canonicalHost)
      || (parsed.hostname.toLowerCase() === 'naver.me' && !naverResolved)
      ? 'place'
      : 'online';

    const resolvedName = requestedName || title;
    const places = kind === 'place' ? await findPlaces(admin, resolvedName, placeCatalogId) : [];
    const selectedPlace = placeCatalogId ? places[0] : undefined;
    const exactPlace = !selectedPlace && resolvedName
      ? places.find((place) => placeSearchName(place.name) === placeSearchName(resolvedName)
        || placeFullName(place) === branchKey(resolvedName))
      : undefined;
    const contextPlace = selectedPlace ?? exactPlace;

    const [categoryRows, sourceRows, termRows] = await Promise.all([
      readAll<CategoryRow>((from, to) => admin.from('categories')
        .select('id,name,slug,parent_id,status,is_visible,is_pickable').order('id').range(from, to)),
      readAll<SourceRow>((from, to) => admin.from('category_catalog_sources')
        .select('category_id,mode,is_enabled').order('category_id').range(from, to)),
      readAll<TermRow>((from, to) => admin.from('category_search_terms')
        .select('category_id,term,kind').order('id').range(from, to)),
    ]);

    const context = [
      requestedName,
      title,
      description,
      parsed.hostname,
      contextPlace?.name,
      contextPlace?.provider_category,
    ].filter(Boolean).join(' ');

    const scored = scoreCategories(
      categoryRows,
      sourceRows,
      termRows,
      context,
    );

    return json({
      kind,
      inputUrl: parsed.toString(),
      canonicalUrl,
      host: new URL(canonicalUrl).hostname,
      title: title || null,
      description: description || null,
      resolvedName: resolvedName || null,
      needsName: !resolvedName,
      places: places.map((place) => ({
        catalogId: place.id,
        name: place.name,
        branchName: place.branch_name,
        roadAddress: place.road_address,
        address: place.address,
        region1: place.region_1,
        region2: place.region_2,
        providerCategory: place.provider_category,
      })),
      suggestions: scored.suggestions,
      categories: scored.categories,
    });
  } catch (error) {
    console.error('LINK_CATEGORY_SUGGESTION_FAILED', error instanceof Error ? error.message : 'unknown');
    return json({ error: 'LINK_CATEGORY_SUGGESTION_FAILED' }, 500);
  }
});
