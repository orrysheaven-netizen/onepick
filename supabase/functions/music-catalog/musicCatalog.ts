import type { SupabaseClient } from '@supabase/supabase-js';

export const MUSICBRAINZ_SOURCE = 'musicbrainz_recording' as const;
const MBID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const clean = (value: unknown, max: number) => typeof value === 'string'
  ? value.trim().replace(/\s+/g, ' ').slice(0, max) : '';

export type MusicEntry = {
  source: typeof MUSICBRAINZ_SOURCE;
  externalId: string;
  title: string;
  artistName: string;
  releaseTitle: string | null;
  releaseGroupId: string | null;
  releaseYear: number | null;
  coverArtUrl: string | null;
  disambiguation: string | null;
  existingItemId: string | null;
};

function year(value: unknown) {
  if (typeof value !== 'string' || !/^\d{4}(?:-|$)/.test(value)) return null;
  const y = Number(value.slice(0, 4));
  return y >= 1888 && y <= 2200 ? y : null;
}

function artistName(value: unknown) {
  if (!Array.isArray(value)) return '';
  return value.map((part) => {
    if (!part || typeof part !== 'object') return '';
    const row = part as Record<string, unknown>;
    const credited = clean(row.name, 200)
      || (row.artist && typeof row.artist === 'object' ? clean((row.artist as Record<string, unknown>).name, 200) : '');
    return credited + clean(row.joinphrase, 20);
  }).join('').trim().slice(0, 200);
}

function releaseCandidate(value: unknown) {
  if (!Array.isArray(value)) return null;
  const releases = value.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return [];
    const row = entry as Record<string, unknown>;
    const group = row['release-group'];
    if (!group || typeof group !== 'object') return [];
    const rg = group as Record<string, unknown>;
    const id = clean(rg.id, 36);
    if (!MBID.test(id)) return [];
    return [{
      id,
      title: clean(rg.title, 200) || clean(row.title, 200) || null,
      date: clean(row.date, 20),
      official: row.status === 'Official',
    }];
  });
  if (!releases.length) return null;
  releases.sort((a, b) => Number(b.official) - Number(a.official)
    || (a.date || '9999').localeCompare(b.date || '9999') || (a.title ?? '').localeCompare(b.title ?? ''));
  return releases[0];
}

export function mapMusicBrainzRecording(value: unknown): MusicEntry | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const id = clean(row.id, 36);
  if (!MBID.test(id) || row.video === true) return null;
  const title = clean(row.title, 100);
  const artist = artistName(row['artist-credit']);
  if (!title || !artist) return null;
  const release = releaseCandidate(row.releases);
  return {
    source: MUSICBRAINZ_SOURCE,
    externalId: id,
    title,
    artistName: artist,
    releaseTitle: release?.title ?? null,
    releaseGroupId: release?.id ?? null,
    releaseYear: year(row['first-release-date']) ?? year(release?.date),
    coverArtUrl: null,
    disambiguation: clean(row.disambiguation, 120) || null,
    existingItemId: null,
  };
}

export function normalizeItemName(value: string) {
  return value.toLocaleLowerCase('ko-KR').replace(/\s+/g, '');
}

export function musicItemName(entry: Pick<MusicEntry, 'title' | 'artistName'>) {
  const combined = `${entry.title} · ${entry.artistName}`;
  return combined.length <= 100 ? combined : `${entry.title.slice(0, 70)} · ${entry.artistName}`.slice(0, 100);
}

function quoteLucene(value: string) {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

// Lucene field queries. MusicBrainz must be called without dismax=true, which
// switches to a plain-text parser that ignores field names and drops the artist
// constraint entirely.
export function buildRecordingQuery(title: string, artist: string, artistId: string | null = null) {
  const titleClause = `recording:"${quoteLucene(title)}"`;
  if (artistId && MBID.test(artistId)) return `${titleClause} AND arid:${artistId}`;
  return artist ? `${titleClause} AND artist:"${quoteLucene(artist)}"` : titleClause;
}

// Credited names on recordings are usually Latin ("IU", "NewJeans"), so a Korean
// artist name only matches through the artist's aliases.
export function buildArtistQuery(artist: string) {
  return `artist:"${quoteLucene(artist)}" OR alias:"${quoteLucene(artist)}"`;
}

const ARTIST_MATCH_SCORE = 90;
export function mapArtistMatch(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null;
  const artists = (value as Record<string, unknown>).artists;
  if (!Array.isArray(artists) || !artists[0] || typeof artists[0] !== 'object') return null;
  const top = artists[0] as Record<string, unknown>;
  const id = clean(top.id, 36);
  return MBID.test(id) && typeof top.score === 'number' && top.score >= ARTIST_MATCH_SCORE ? id : null;
}

// Cover Art Archive still lists many images with http:// URLs. The same paths are
// served over TLS, so upgrade them; clients and the web CSP only accept https.
export function secureCoverUrl(value: string) {
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
    const host = parsed.hostname;
    if (host !== 'coverartarchive.org' && host !== 'archive.org' && !host.endsWith('.archive.org')) return null;
    parsed.protocol = 'https:';
    return parsed.toString();
  } catch { return null; }
}

type Remote = { data: Record<string, unknown>; error?: never } | { error: Response; data?: never };
/** A definitive Cover Art Archive answer, or null when the lookup could not complete. */
export type CoverLookup = { url: string | null } | null;
type Dependencies = {
  client: () => SupabaseClient | null;
  fetchMusicBrainz: (url: URL) => Promise<Remote>;
  fetchCoverArt: (releaseGroupId: string) => Promise<CoverLookup>;
  readCache: (client: SupabaseClient, key: string, maxAgeMs: number) => Promise<unknown | null>;
  writeCache: (client: SupabaseClient, key: string, payload: unknown) => Promise<void>;
  waitForProvider: (client: SupabaseClient) => Promise<boolean>;
  /** Keeps work running after the response is sent (EdgeRuntime.waitUntil). */
  keepAlive: (work: Promise<unknown>) => void;
  json: (body: unknown, status?: number) => Response;
};

async function catalogCategory(client: SupabaseClient) {
  const categoryResult = await client.from('categories').select('id,parent_id')
    .eq('slug', 'music').eq('status', 'open').eq('is_visible', true).eq('is_pickable', true).maybeSingle();
  const category = categoryResult.data;
  if (categoryResult.error || !category) return null;
  const children = await client.from('categories').select('id').eq('parent_id', category.id).limit(1);
  if (children.error || children.data?.length) return null;
  if (category.parent_id) {
    const parent = await client.from('categories').select('id,parent_id')
      .eq('id', category.parent_id).eq('status', 'open').eq('is_visible', true).eq('is_pickable', false).maybeSingle();
    if (parent.error || !parent.data || parent.data.parent_id) return null;
  }
  return category;
}

// Cover Art Archive answers 404 for most release groups, so only URLs confirmed by
// fetchCoverArt are ever sent to clients. Misses are re-checked daily because
// covers keep being added; hits are stable for much longer. A lookup that did not
// complete (timeout, 5xx) is remembered only briefly, so one slow release group
// cannot hold every search for the same query at the fetch timeout.
const ARTIST_CACHE_MS = 7 * 24 * 60 * 60_000;
const COVER_HIT_MS = 30 * 24 * 60 * 60_000;
const COVER_MISS_MS = 24 * 60 * 60_000;
const COVER_UNKNOWN_MS = 15 * 60_000;
// Search waits at most this long for cover verification. Whatever is still
// pending keeps running after the response and lands in the cache for the
// next search, which then answers from cache alone.
export const COVER_BUDGET_MS = 4_000;

type CoverCacheRow = { url: string | null; fetchedAt: string; unknown?: true };

export function createMusicCatalogHandler(deps: Dependencies) {
  const { client: makeClient, fetchMusicBrainz, fetchCoverArt, readCache, writeCache, waitForProvider, keepAlive, json } = deps;

  // Resolves a typed artist name to a MusicBrainz artist id via name or alias,
  // cached per name. Null means "no confident match"; a Response is an error.
  async function resolveArtist(client: SupabaseClient, artist: string): Promise<string | null | Response> {
    const cacheKey = `artist:\n${artist}`;
    const cached = await readCache(client, cacheKey, ARTIST_CACHE_MS);
    if (cached && typeof cached === 'object' && 'id' in cached) {
      const id = (cached as { id: unknown }).id;
      return typeof id === 'string' && MBID.test(id) ? id : null;
    }
    if (!await waitForProvider(client)) return json({ error: 'RATE_LIMITED' }, 429);
    const url = new URL('https://musicbrainz.org/ws/2/artist/');
    url.searchParams.set('query', buildArtistQuery(artist));
    url.searchParams.set('fmt', 'json');
    url.searchParams.set('limit', '3');
    const remote = await fetchMusicBrainz(url);
    if (remote.error) return remote.error;
    const id = mapArtistMatch(remote.data);
    await writeCache(client, cacheKey, { id });
    return id;
  }

  async function verifiedCover(client: SupabaseClient, releaseGroupId: string) {
    // Namespace v3: earlier entries cached timeouts (v1) and http:// covers (v2)
    // as misses and must not be reused.
    const cacheKey = `cover:v3\n${releaseGroupId}`;
    const cached = await readCache(client, cacheKey, COVER_HIT_MS);
    if (cached && typeof cached === 'object' && 'url' in cached) {
      const row = cached as Partial<CoverCacheRow>;
      if (typeof row.url === 'string') return row.url;
      const age = typeof row.fetchedAt === 'string' ? Date.now() - Date.parse(row.fetchedAt) : Number.NaN;
      if (Number.isFinite(age) && age >= 0 && age < (row.unknown ? COVER_UNKNOWN_MS : COVER_MISS_MS)) return null;
    }
    const lookup = await fetchCoverArt(releaseGroupId);
    const row: CoverCacheRow = lookup
      ? { url: lookup.url, fetchedAt: new Date().toISOString() }
      : { url: null, fetchedAt: new Date().toISOString(), unknown: true };
    await writeCache(client, cacheKey, row);
    return row.url;
  }

  // Resolves with every cover verified within the budget; unfinished lookups
  // continue in the background and are only missing from this response.
  async function verifiedCovers(client: SupabaseClient, releaseGroupIds: Array<string | null>, budgetMs: number) {
    const unique = [...new Set(releaseGroupIds.filter((id): id is string => Boolean(id)))];
    const covers = new Map<string, string | null>();
    const pending = unique.map((id) => verifiedCover(client, id)
      .then((url) => { covers.set(id, url); }, (error) => { console.error('Cover lookup failed', error instanceof Error ? error.message : 'unknown'); }));
    let timer: ReturnType<typeof setTimeout> | undefined;
    const budget = new Promise<void>((resolve) => { timer = setTimeout(resolve, budgetMs); });
    await Promise.race([Promise.all(pending), budget]);
    clearTimeout(timer);
    if (covers.size < unique.length) keepAlive(Promise.all(pending));
    return covers;
  }

  return async (body: Record<string, unknown>, req: Request): Promise<Response> => {
    if (body.action !== 'search' && body.action !== 'import') return json({ error: 'ACTION_INVALID' }, 400);
    const title = clean(body.title, 1000);
    const artist = clean(body.artist, 1000);
    const id = typeof body.externalId === 'string' ? body.externalId.trim() : '';
    if (body.action === 'search' && (title.length < 1 || title.length > 100 || artist.length > 100
      || (title.length < 2 && artist.length < 2))) return json({ error: 'QUERY_INVALID' }, 400);
    if (body.action === 'import' && !MBID.test(id)) return json({ error: 'EXTERNAL_ID_INVALID' }, 400);

    const client = makeClient();
    if (!client) return json({ error: 'CATALOG_NOT_CONFIGURED' }, 503);
    let importUserId: string | null = null;

    if (body.action === 'import') {
      const authorization = req.headers.get('Authorization') ?? '';
      const token = authorization.startsWith('Bearer ') ? authorization.slice(7).trim() : '';
      if (!token) return json({ error: 'AUTH_REQUIRED' }, 401);
      const { data, error } = await client.auth.getUser(token);
      if (error || !data.user) return json({ error: 'AUTH_REQUIRED' }, 401);
      importUserId = data.user.id;
      const suspended = await client.rpc('catalog_user_is_suspended', { p_user_id: data.user.id });
      if (suspended.error) return json({ error: 'CATALOG_UNAVAILABLE' }, 503);
      if (suspended.data === true) return json({ error: 'ITEM_NOT_ELIGIBLE' }, 409);
    }

    const category = await catalogCategory(client);
    if (!category) return json({ error: 'CATEGORY_NOT_FOUND' }, 503);

    if (body.action === 'search') {
      // v2: v1 entries hold dismax-era results that ignored the artist clause.
      const cacheKey = `search:v2\n${title}\n${artist}`;
      const cached = await readCache(client, cacheKey, 6 * 60 * 60_000);
      let recordings = Array.isArray(cached) ? cached.map(mapMusicBrainzRecording).filter((v): v is MusicEntry => Boolean(v)) : [];
      if (!recordings.length) {
        const artistId = artist ? await resolveArtist(client, artist) : null;
        if (artistId instanceof Response) return artistId;
        const searchRecordings = async (query: string) => {
          if (!await waitForProvider(client)) return json({ error: 'RATE_LIMITED' }, 429);
          const url = new URL('https://musicbrainz.org/ws/2/recording/');
          url.searchParams.set('query', query);
          url.searchParams.set('fmt', 'json');
          url.searchParams.set('limit', '20');
          const remote = await fetchMusicBrainz(url);
          if (remote.error) return remote.error;
          return Array.isArray(remote.data.recordings) ? remote.data.recordings : [];
        };
        let source = await searchRecordings(buildRecordingQuery(title, artist, artistId));
        if (source instanceof Response) return source;
        // A credited-name mismatch (unresolved alias, featured artist, typo)
        // should still show the song rather than nothing.
        if (!source.length && artist) {
          source = await searchRecordings(buildRecordingQuery(title, ''));
          if (source instanceof Response) return source;
        }
        const seen = new Set<string>();
        recordings = source.map(mapMusicBrainzRecording).filter((entry): entry is MusicEntry => {
          if (!entry || seen.has(entry.externalId)) return false;
          seen.add(entry.externalId); return true;
        }).slice(0, 20);
        await writeCache(client, cacheKey, source.slice(0, 40));
      }
      if (!recordings.length) return json({ recordings: [] });
      const [known, covers] = await Promise.all([
        client.from('items').select('id,external_id')
          .eq('category_id', category.id).eq('external_source', MUSICBRAINZ_SOURCE)
          .in('external_id', recordings.map((entry) => entry.externalId)).in('status', ['active', 'discontinued']),
        verifiedCovers(client, recordings.map((entry) => entry.releaseGroupId), COVER_BUDGET_MS),
      ]);
      if (known.error) return json({ error: 'CATALOG_UNAVAILABLE' }, 503);
      const ids = new Map((known.data ?? []).map((item) => [item.external_id, item.id]));
      return json({ recordings: recordings.map((entry) => ({
        ...entry,
        coverArtUrl: entry.releaseGroupId ? covers.get(entry.releaseGroupId) ?? null : null,
        existingItemId: ids.get(entry.externalId) ?? null,
      })) });
    }

    const findExisting = () => client.from('items').select('id,category_id,status')
      .eq('external_source', MUSICBRAINZ_SOURCE).eq('external_id', id).maybeSingle();
    const receipt = (item: { id: string; category_id: string; status: string }) =>
      item.category_id === category.id && ['active', 'discontinued'].includes(item.status)
        ? json({ itemId: item.id, categoryId: item.category_id, created: false })
        : json({ error: 'ITEM_NOT_ELIGIBLE' }, 409);
    const existing = await findExisting();
    if (existing.error) return json({ error: 'CATALOG_UNAVAILABLE' }, 503);
    if (existing.data) return receipt(existing.data);

    const cacheKey = `recording:\n${id}`;
    const cached = await readCache(client, cacheKey, 24 * 60 * 60_000);
    let raw = cached && typeof cached === 'object' && !Array.isArray(cached) ? cached as Record<string, unknown> : null;
    if (!raw) {
      if (!await waitForProvider(client)) return json({ error: 'RATE_LIMITED' }, 429);
      const url = new URL(`https://musicbrainz.org/ws/2/recording/${id}`);
      url.searchParams.set('inc', 'artist-credits+releases+release-groups');
      url.searchParams.set('fmt', 'json');
      const remote = await fetchMusicBrainz(url);
      if (remote.error) return remote.error;
      raw = remote.data;
      await writeCache(client, cacheKey, raw);
    }
    const recording = mapMusicBrainzRecording(raw);
    if (!recording || recording.externalId !== id) return json({ error: 'RECORDING_NOT_FOUND' }, 404);
    const cover = recording.releaseGroupId ? await verifiedCover(client, recording.releaseGroupId) : null;
    const itemName = musicItemName(recording);
    const inserted = await client.from('items').insert({
      category_id: category.id,
      name: itemName,
      normalized_name: normalizeItemName(`${recording.title} ${recording.artistName}`),
      official_url: `https://musicbrainz.org/recording/${id}`,
      image_source_url: cover,
      external_source: MUSICBRAINZ_SOURCE,
      created_by: importUserId,
      external_id: id,
      original_name: recording.title,
      release_year: recording.releaseYear,
      creator_name: recording.artistName,
      collection_name: recording.releaseTitle,
      status: 'active',
    }).select('id,category_id').maybeSingle();
    if (!inserted.error && inserted.data) return json({ itemId: inserted.data.id, categoryId: inserted.data.category_id, created: true });
    if (inserted.error?.code === 'P0001' && inserted.error.message?.includes('RATE_LIMITED')) {
      return json({ error: 'RATE_LIMITED' }, 429);
    }
    if (inserted.error?.code !== '23505') return json({ error: 'CATALOG_UNAVAILABLE' }, 503);
    const winner = await findExisting();
    return !winner.error && winner.data ? receipt(winner.data) : json({ error: 'CATALOG_UNAVAILABLE' }, 503);
  };
}
