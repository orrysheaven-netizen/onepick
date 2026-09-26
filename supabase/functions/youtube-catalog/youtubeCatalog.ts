import type { SupabaseClient } from '@supabase/supabase-js';

export const YOUTUBE_SOURCE = 'youtube_channel' as const;
export const YOUTUBE_VIDEO_SOURCE = 'youtube_video' as const;
const CHANNEL_CATEGORY_SLUG = 'youtube';
const VIDEO_CATEGORY_SLUG = 'recipe';
const CHANNEL_ID = /^UC[A-Za-z0-9_-]{22}$/;
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const clean = (value: unknown, max: number) => typeof value === 'string'
  ? value.trim().replace(/\s+/g, ' ').slice(0, max) : '';

export type YouTubeChannelEntry = {
  source: typeof YOUTUBE_SOURCE;
  externalId: string;
  title: string;
  thumbnailUrl: string | null;
  channelUrl: string;
  existingItemId: string | null;
};

function thumbnailUrl(value: unknown) {
  if (!value || typeof value !== 'object') return null;
  const row = value as Record<string, unknown>;
  const candidates = ['high','medium','default'].flatMap((key) => {
    const entry = row[key];
    if (!entry || typeof entry !== 'object') return [];
    const url = clean((entry as Record<string, unknown>).url, 2048);
    return url.startsWith('https://') ? [url] : [];
  });
  return candidates[0] ?? null;
}

export function channelUrl(id: string) {
  return CHANNEL_ID.test(id) ? `https://www.youtube.com/channel/${id}` : null;
}

export function mapYouTubeSearchResult(value: unknown): YouTubeChannelEntry | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const idObject = row.id;
  const id = idObject && typeof idObject === 'object'
    ? clean((idObject as Record<string, unknown>).channelId, 40)
    : '';
  const snippet = row.snippet;
  if (!CHANNEL_ID.test(id) || !snippet || typeof snippet !== 'object') return null;
  const details = snippet as Record<string, unknown>;
  const title = clean(details.title, 100);
  if (!title) return null;
  return {
    source: YOUTUBE_SOURCE,
    externalId: id,
    title,
    thumbnailUrl: thumbnailUrl(details.thumbnails),
    channelUrl: channelUrl(id)!,
    existingItemId: null,
  };
}

export function mapYouTubeChannel(value: unknown): YouTubeChannelEntry | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const id = clean(row.id, 40);
  const snippet = row.snippet;
  if (!CHANNEL_ID.test(id) || !snippet || typeof snippet !== 'object') return null;
  const details = snippet as Record<string, unknown>;
  const title = clean(details.title, 100);
  if (!title) return null;
  return {
    source: YOUTUBE_SOURCE,
    externalId: id,
    title,
    thumbnailUrl: thumbnailUrl(details.thumbnails),
    channelUrl: channelUrl(id)!,
    existingItemId: null,
  };
}

export type YouTubeVideoEntry = {
  source: typeof YOUTUBE_VIDEO_SOURCE;
  externalId: string;
  title: string;
  channelTitle: string | null;
  thumbnailUrl: string | null;
  videoUrl: string;
  existingItemId: string | null;
};

export function videoUrl(id: string) {
  return VIDEO_ID.test(id) ? `https://www.youtube.com/watch?v=${id}` : null;
}

export function mapYouTubeVideo(value: unknown): YouTubeVideoEntry | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const id = clean(row.id, 20);
  const snippet = row.snippet;
  if (!VIDEO_ID.test(id) || !snippet || typeof snippet !== 'object' || Array.isArray(snippet)) return null;
  const details = snippet as Record<string, unknown>;
  const title = clean(details.title, 100);
  if (!title) return null;
  return {
    source: YOUTUBE_VIDEO_SOURCE,
    externalId: id,
    title,
    channelTitle: clean(details.channelTitle, 100) || null,
    thumbnailUrl: thumbnailUrl(details.thumbnails),
    videoUrl: videoUrl(id)!,
    existingItemId: null,
  };
}

const VIDEO_HOSTS = ['youtube.com', 'www.youtube.com', 'm.youtube.com'];
const SHORT_VIDEO_HOSTS = ['youtu.be', 'www.youtu.be'];

/**
 * Video ID from a shared YouTube video link (watch, youtu.be, Shorts, live, embed).
 * Channel, playlist-only and non-YouTube links return null. Keep in sync with
 * mobile/src/lib/youtube/videoLink.ts.
 */
export function parseYouTubeVideoUrl(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 2048 || /\s/.test(trimmed)) return null;
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  if (url.username || url.password || url.port) return null;
  const host = url.hostname.toLowerCase();
  const parts = url.pathname.split('/').filter(Boolean);
  if (SHORT_VIDEO_HOSTS.includes(host)) {
    return parts.length === 1 && VIDEO_ID.test(parts[0]) ? parts[0] : null;
  }
  if (!VIDEO_HOSTS.includes(host)) return null;
  if (parts.length === 1 && parts[0] === 'watch') {
    const id = url.searchParams.get('v') ?? '';
    return VIDEO_ID.test(id) ? id : null;
  }
  if (parts.length === 2 && ['shorts', 'live', 'embed'].includes(parts[0]) && VIDEO_ID.test(parts[1])) return parts[1];
  return null;
}

export function normalizeItemName(value: string) {
  return value.toLocaleLowerCase('ko-KR').replace(/\s+/g, '');
}

export type DirectLookup =
  | { type: 'id'; value: string }
  | { type: 'handle'; value: string }
  | { type: 'video'; value: string }
  | null;

export function directLookup(query: string): DirectLookup {
  const trimmed = query.trim();
  if (CHANNEL_ID.test(trimmed)) return { type: 'id', value: trimmed };
  if (trimmed.startsWith('@') && trimmed.length >= 3 && trimmed.length <= 60 && !/\s/.test(trimmed)) {
    return { type: 'handle', value: trimmed };
  }
  try {
    const url = new URL(trimmed);
    const host = url.hostname.toLowerCase();
    const youtubeHost = ['youtube.com','www.youtube.com','m.youtube.com'].includes(host);
    const shortHost = ['youtu.be','www.youtu.be'].includes(host);
    if (!youtubeHost && !shortHost) return null;
    const parts = url.pathname.split('/').filter(Boolean);
    if (shortHost && VIDEO_ID.test(parts[0] ?? '')) return { type: 'video', value: parts[0] };
    if (parts[0] === 'channel' && CHANNEL_ID.test(parts[1] ?? '')) return { type: 'id', value: parts[1] };
    if (parts[0]?.startsWith('@') && parts[0].length >= 3) return { type: 'handle', value: decodeURIComponent(parts[0]) };
    const queryVideo = url.searchParams.get('v') ?? '';
    if (parts[0] === 'watch' && VIDEO_ID.test(queryVideo)) return { type: 'video', value: queryVideo };
    if (['shorts','live','embed'].includes(parts[0] ?? '') && VIDEO_ID.test(parts[1] ?? '')) {
      return { type: 'video', value: parts[1] };
    }
  } catch { /* Not a URL. */ }
  return null;
}

type Remote = { data: Record<string, unknown>; error?: never } | { error: Response; data?: never };
type Dependencies = {
  client: () => SupabaseClient | null;
  fetchYouTube: (url: URL) => Promise<Remote>;
  readCache: (client: SupabaseClient, key: string, maxAgeMs: number) => Promise<unknown | null>;
  writeCache: (client: SupabaseClient, key: string, payload: unknown) => Promise<void>;
  apiKey: () => string | null;
  json: (body: unknown, status?: number) => Response;
};

async function catalogCategory(client: SupabaseClient, slug: string) {
  const categoryResult = await client.from('categories').select('id,parent_id')
    .eq('slug', slug).eq('status', 'open').eq('is_visible', true).eq('is_pickable', true).maybeSingle();
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

function channelsUrl(apiKey: string, lookup: Exclude<DirectLookup, null | { type: 'video'; value: string }>) {
  const url = new URL('https://www.googleapis.com/youtube/v3/channels');
  url.searchParams.set('part', 'snippet');
  url.searchParams.set(lookup.type === 'id' ? 'id' : 'forHandle', lookup.value);
  url.searchParams.set('key', apiKey);
  return url;
}

function videosUrl(apiKey: string, videoId: string) {
  const url = new URL('https://www.googleapis.com/youtube/v3/videos');
  url.searchParams.set('part', 'snippet');
  url.searchParams.set('id', videoId);
  url.searchParams.set('key', apiKey);
  return url;
}

function videoDetailsUrl(apiKey: string, videoId: string) {
  const url = videosUrl(apiKey, videoId);
  url.searchParams.set('fields', 'items(id,snippet(title,channelTitle,thumbnails))');
  return url;
}

function videoChannelId(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const snippet = (value as Record<string, unknown>).snippet;
  if (!snippet || typeof snippet !== 'object' || Array.isArray(snippet)) return null;
  const id = clean((snippet as Record<string, unknown>).channelId, 40);
  return CHANNEL_ID.test(id) ? id : null;
}

function searchable(value: string) {
  return value.normalize('NFKC').toLocaleLowerCase('ko-KR').replace(/[\s\p{P}\p{S}]+/gu, '');
}

export function rankChannels(channels: YouTubeChannelEntry[], query: string) {
  const wanted = searchable(query);
  if (!wanted) return channels;
  return channels.map((entry, index) => {
    const title = searchable(entry.title);
    const score = title === wanted ? 1000
      : title.startsWith(wanted) ? 800
        : title.includes(wanted) ? 650
          : wanted.includes(title) ? 500
            : 0;
    return { entry, index, score };
  }).sort((a, b) => b.score - a.score || a.index - b.index).map(({ entry }) => entry);
}

function searchUrl(apiKey: string, query: string) {
  const url = new URL('https://www.googleapis.com/youtube/v3/search');
  url.searchParams.set('part', 'snippet');
  url.searchParams.set('type', 'channel');
  url.searchParams.set('q', query);
  url.searchParams.set('maxResults', '25');
  url.searchParams.set('safeSearch', 'strict');
  url.searchParams.set('relevanceLanguage', 'ko');
  url.searchParams.set('regionCode', 'KR');
  url.searchParams.set('key', apiKey);
  return url;
}

function isFresh(value: unknown, maxAgeMs: number) {
  if (typeof value !== 'string') return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && Date.now() - parsed >= 0 && Date.now() - parsed < maxAgeMs;
}

export function createYouTubeCatalogHandler(deps: Dependencies) {
  const { client: makeClient, fetchYouTube, readCache, writeCache, apiKey, json } = deps;

  const authenticate = async (client: SupabaseClient, req: Request) => {
    const authorization = req.headers.get('Authorization') ?? '';
    const token = authorization.startsWith('Bearer ') ? authorization.slice(7).trim() : '';
    if (!token) return null;
    const { data, error } = await client.auth.getUser(token);
    return error || !data.user || data.user.is_anonymous ? null : data.user;
  };

  const reserveSearch = async (client: SupabaseClient, req: Request, userId: string) => {
    const forwarded = req.headers.get('cf-connecting-ip')
      ?? req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
      ?? null;
    let ipHash: string | null = null;
    if (forwarded && forwarded.length <= 128) {
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(forwarded));
      ipHash = [...new Uint8Array(digest)]
        .map((byte) => byte.toString(16).padStart(2, '0')).join('');
    }
    const quota = await client.rpc('reserve_youtube_catalog_search', { p_user_id: userId, p_ip_hash: ipHash });
    if (quota.error) return json({ error: 'CATALOG_UNAVAILABLE' }, 503);
    if (quota.data !== true) return json({ error: 'RATE_LIMITED' }, 429);
    return null;
  };

  const videoFields = (video: YouTubeVideoEntry, now: string) => ({
    name: video.title,
    normalized_name: normalizeItemName(video.title),
    official_url: video.videoUrl,
    image_source_url: video.thumbnailUrl,
    original_name: video.title,
    creator_name: video.channelTitle,
    external_refreshed_at: now,
    status: 'active',
  });

  // Recipe videos are imported into the selected food menu. external_id includes
  // categoryId so the same YouTube video may be a recipe candidate for multiple menus.
  const handleVideo = async (body: Record<string, unknown>, req: Request): Promise<Response> => {
    const lookup = body.action === 'video_lookup';
    const rawId = typeof body.externalId === 'string' ? body.externalId.trim() : '';
    const id = lookup
      ? parseYouTubeVideoUrl(typeof body.url === 'string' ? body.url : '')
      : (VIDEO_ID.test(rawId) ? rawId : null);
    if (!id) return json({ error: lookup ? 'VIDEO_URL_INVALID' : 'EXTERNAL_ID_INVALID' }, 400);

    const client = makeClient();
    if (!client) return json({ error: 'CATALOG_NOT_CONFIGURED' }, 503);
    const user = await authenticate(client, req);
    if (!user) return json({ error: 'AUTH_REQUIRED' }, 401);

    if (lookup) {
      const limited = await reserveSearch(client, req, user.id);
      if (limited) return limited;
    } else {
      const suspended = await client.rpc('catalog_user_is_suspended', { p_user_id: user.id });
      if (suspended.error) return json({ error: 'CATALOG_UNAVAILABLE' }, 503);
      if (suspended.data === true) return json({ error: 'ITEM_NOT_ELIGIBLE' }, 409);
    }

    let category: { id: string; parent_id: string | null } | null = null;
    if (lookup) {
      category = await catalogCategory(client, VIDEO_CATEGORY_SLUG);
    } else {
      const requested = typeof body.categoryId === 'string' ? body.categoryId.trim() : '';
      if (!UUID.test(requested)) return json({ error: 'CATEGORY_NOT_FOUND' }, 400);
      const selected = await client.from('categories').select('id,parent_id,status,is_visible,is_pickable')
        .eq('id', requested).maybeSingle();
      if (selected.error || !selected.data || selected.data.status !== 'open'
        || selected.data.is_visible !== true || selected.data.is_pickable !== true) {
        return json({ error: 'CATEGORY_NOT_FOUND' }, 400);
      }
      const children = await client.from('categories').select('id').eq('parent_id', requested).limit(1);
      if (children.error || children.data?.length) return json({ error: 'CATEGORY_NOT_FOUND' }, 400);

      let ancestorId = selected.data.parent_id;
      let underFood = false;
      for (let depth = 0; ancestorId && depth < 4; depth++) {
        const ancestor = await client.from('categories').select('id,parent_id,slug,status,is_visible')
          .eq('id', ancestorId).maybeSingle();
        if (ancestor.error || !ancestor.data || ancestor.data.status !== 'open' || ancestor.data.is_visible !== true) break;
        if (ancestor.data.slug === 'food') { underFood = true; break; }
        ancestorId = ancestor.data.parent_id;
      }
      if (!underFood) return json({ error: 'CATEGORY_NOT_FOUND' }, 400);
      category = { id: selected.data.id, parent_id: selected.data.parent_id };
    }
    if (!category) return json({ error: 'CATEGORY_NOT_FOUND' }, 503);

    const key = apiKey();
    if (!key) return json({ error: 'CATALOG_NOT_CONFIGURED' }, 503);

    const identity = lookup ? id : `${id}:${category.id}`;
    const findExisting = () => client.from('items').select('id,category_id,status,external_refreshed_at')
      .eq('external_source', YOUTUBE_VIDEO_SOURCE).eq('external_id', identity).maybeSingle();
    const existing = await findExisting();
    if (existing.error) return json({ error: 'CATALOG_UNAVAILABLE' }, 503);
    if (existing.data && existing.data.category_id !== category.id) return json({ error: 'ITEM_NOT_ELIGIBLE' }, 409);
    if (existing.data && !['active', 'discontinued'].includes(existing.data.status)) {
      return json({ error: 'ITEM_NOT_ELIGIBLE' }, 409);
    }

    const ensureRecipeChannel = async (itemId: string, targetUrl: string) => {
      const result = await client.from('item_channels').upsert({
        item_id: itemId,
        channel: 'recipe',
        target_url: targetUrl,
        is_primary: true,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'item_id,channel' });
      return !result.error;
    };

    if (!lookup && existing.data && isFresh(existing.data.external_refreshed_at, 20 * 24 * 60 * 60_000)) {
      if (!await ensureRecipeChannel(existing.data.id, videoUrl(id)!)) return json({ error: 'CATALOG_UNAVAILABLE' }, 503);
      return json({ itemId: existing.data.id, categoryId: category.id, created: false });
    }

    const cacheKey = `video:\n${id}`;
    const cached = lookup ? await readCache(client, cacheKey, 10 * 60_000) : null;
    let rawItems: unknown[] | null = Array.isArray(cached) ? cached : null;
    let fetchedNow = false;
    if (!rawItems) {
      const remote = await fetchYouTube(videoDetailsUrl(key, id));
      if (remote.error) return remote.error;
      rawItems = Array.isArray(remote.data.items) ? remote.data.items.slice(0, 1) : [];
      await writeCache(client, cacheKey, rawItems);
      fetchedNow = true;
    }
    const video = rawItems.map(mapYouTubeVideo).find((entry) => entry?.externalId === id) ?? null;
    if (!video) return json({ error: 'VIDEO_NOT_FOUND' }, 404);
    const now = new Date().toISOString();

    if (existing.data && fetchedNow) {
      const updated = await client.from('items').update(videoFields(video, now))
        .eq('id', existing.data.id).select('id,category_id').maybeSingle();
      if (updated.error || !updated.data) return json({ error: 'CATALOG_UNAVAILABLE' }, 503);
      if (!lookup) {
        if (!await ensureRecipeChannel(updated.data.id, video.videoUrl)) return json({ error: 'CATALOG_UNAVAILABLE' }, 503);
        return json({ itemId: updated.data.id, categoryId: updated.data.category_id, created: false });
      }
    }

    // Lookup is only a preview; the target menu is deliberately chosen afterward.
    if (lookup) return json({ video: { ...video, existingItemId: existing.data?.id ?? null } });

    const quota = await client.rpc('reserve_external_catalog_import', { p_user_id: user.id });
    if (quota.error) return json({ error: 'CATALOG_UNAVAILABLE' }, 503);
    if (quota.data !== true) return json({ error: 'RATE_LIMITED' }, 429);

    const inserted = await client.from('items').insert({
      category_id: category.id,
      ...videoFields(video, now),
      external_source: YOUTUBE_VIDEO_SOURCE,
      external_id: identity,
      release_year: null,
      collection_name: null,
    }).select('id,category_id').maybeSingle();
    if (!inserted.error && inserted.data) {
      if (!await ensureRecipeChannel(inserted.data.id, video.videoUrl)) return json({ error: 'CATALOG_UNAVAILABLE' }, 503);
      return json({ itemId: inserted.data.id, categoryId: inserted.data.category_id, created: true });
    }
    if (inserted.error?.code !== '23505') return json({ error: 'CATALOG_UNAVAILABLE' }, 503);
    const winner = await findExisting();
    if (!winner.error && winner.data && winner.data.category_id === category.id
      && await ensureRecipeChannel(winner.data.id, video.videoUrl)) {
      return json({ itemId: winner.data.id, categoryId: category.id, created: false });
    }
    return json({ error: 'CATALOG_UNAVAILABLE' }, 503);
  };

  return async (body: Record<string, unknown>, req: Request): Promise<Response> => {
    if (body.action === 'video_lookup' || body.action === 'video_import') return handleVideo(body, req);
    if (body.action !== 'search' && body.action !== 'import') return json({ error: 'ACTION_INVALID' }, 400);
    const query = clean(body.query, 1000);
    const id = typeof body.externalId === 'string' ? body.externalId.trim() : '';
    const lookup = body.action === 'search' ? directLookup(query) : null;
    if (body.action === 'search' && (query.length < 2 || (!lookup && query.length > 100))) return json({ error: 'QUERY_INVALID' }, 400);
    if (body.action === 'import' && !CHANNEL_ID.test(id)) return json({ error: 'EXTERNAL_ID_INVALID' }, 400);

    const client = makeClient();
    if (!client) return json({ error: 'CATALOG_NOT_CONFIGURED' }, 503);

    const user = await authenticate(client, req);
    if (!user) return json({ error: 'AUTH_REQUIRED' }, 401);

    if (body.action === 'search') {
      const limited = await reserveSearch(client, req, user.id);
      if (limited) return limited;
    } else {
      const suspended = await client.rpc('catalog_user_is_suspended', { p_user_id: user.id });
      if (suspended.error) return json({ error: 'CATALOG_UNAVAILABLE' }, 503);
      if (suspended.data === true) return json({ error: 'ITEM_NOT_ELIGIBLE' }, 409);
    }

    const category = await catalogCategory(client, CHANNEL_CATEGORY_SLUG);
    if (!category) return json({ error: 'CATEGORY_NOT_FOUND' }, 503);
    const key = apiKey();
    if (!key) return json({ error: 'CATALOG_NOT_CONFIGURED' }, 503);

    if (body.action === 'search') {
      const normalizedQuery = query.normalize('NFKC').toLocaleLowerCase('ko-KR').replace(/\s+/g, ' ').trim();
      const lookupCacheValue = lookup?.type === 'handle'
        ? lookup.value.toLocaleLowerCase('ko-KR')
        : lookup?.value;
      const cacheKey = lookup
        ? `direct:\n${lookup.type}:\n${lookupCacheValue}`
        : `search:\n${normalizedQuery}`;
      const cached = await readCache(client, cacheKey, 10 * 60_000);
      let rawItems: unknown[] | null = Array.isArray(cached) ? cached : null;
      let fetchedNow = false;
      if (!rawItems) {
        if (lookup?.type === 'video') {
          const videoRemote = await fetchYouTube(videosUrl(key, lookup.value));
          if (videoRemote.error) return videoRemote.error;
          const videoItems = Array.isArray(videoRemote.data.items) ? videoRemote.data.items : [];
          const channelId = videoItems.map(videoChannelId).find((value): value is string => Boolean(value));
          if (!channelId) rawItems = [];
          else {
            const channelRemote = await fetchYouTube(channelsUrl(key, { type: 'id', value: channelId }));
            if (channelRemote.error) return channelRemote.error;
            rawItems = Array.isArray(channelRemote.data.items) ? channelRemote.data.items.slice(0, 1) : [];
          }
        } else {
          const remote = await fetchYouTube(lookup ? channelsUrl(key, lookup) : searchUrl(key, query));
          if (remote.error) return remote.error;
          rawItems = Array.isArray(remote.data.items) ? remote.data.items.slice(0, 25) : [];
        }
        await writeCache(client, cacheKey, rawItems);
        fetchedNow = true;
      }
      const mapper = lookup ? mapYouTubeChannel : mapYouTubeSearchResult;
      const seen = new Set<string>();
      const mappedChannels = rawItems.map(mapper).filter((entry): entry is YouTubeChannelEntry => {
        if (!entry || seen.has(entry.externalId)) return false;
        seen.add(entry.externalId);
        return true;
      });
      const channels = lookup ? mappedChannels : rankChannels(mappedChannels, query);
      if (!channels.length) return json({ channels: [] });

      const known = await client.from('items').select('id,external_id,status,external_refreshed_at')
        .eq('category_id', category.id).eq('external_source', YOUTUBE_SOURCE)
        .in('external_id', channels.map((entry) => entry.externalId)).in('status', ['active', 'discontinued']);
      if (known.error) return json({ error: 'CATALOG_UNAVAILABLE' }, 503);
      const rows = new Map((known.data ?? []).map((item) => [item.external_id, item]));

      if (fetchedNow) {
        const now = new Date().toISOString();
        await Promise.all(channels.flatMap((entry) => {
          const existing = rows.get(entry.externalId);
          if (!existing) return [];
          return [client.from('items').update({
            name: entry.title,
            normalized_name: normalizeItemName(entry.title),
            official_url: entry.channelUrl,
            image_source_url: entry.thumbnailUrl,
            original_name: entry.title,
            external_refreshed_at: now,
            status: 'active',
          }).eq('id', existing.id)];
        }));
      }

      return json({ channels: channels.map((entry) => ({
        ...entry,
        existingItemId: rows.get(entry.externalId)?.id ?? null,
      })) });
    }

    const findExisting = () => client.from('items').select('id,category_id,status,external_refreshed_at')
      .eq('external_source', YOUTUBE_SOURCE).eq('external_id', id).maybeSingle();
    const existing = await findExisting();
    if (existing.error) return json({ error: 'CATALOG_UNAVAILABLE' }, 503);
    if (existing.data && existing.data.category_id !== category.id) return json({ error: 'ITEM_NOT_ELIGIBLE' }, 409);
    if (existing.data && ['active','discontinued'].includes(existing.data.status)
      && isFresh(existing.data.external_refreshed_at, 20 * 24 * 60 * 60_000)) {
      return json({ itemId: existing.data.id, categoryId: category.id, created: false });
    }

    const remote = await fetchYouTube(channelsUrl(key, { type: 'id', value: id }));
    if (remote.error) return remote.error;
    const source = Array.isArray(remote.data.items) ? remote.data.items : [];
    const channel = source.map(mapYouTubeChannel).find((entry) => entry?.externalId === id) ?? null;
    if (!channel) return json({ error: 'CHANNEL_NOT_FOUND' }, 404);
    const now = new Date().toISOString();

    if (existing.data) {
      const updated = await client.from('items').update({
        name: channel.title,
        normalized_name: normalizeItemName(channel.title),
        official_url: channel.channelUrl,
        image_source_url: channel.thumbnailUrl,
        original_name: channel.title,
        external_refreshed_at: now,
        status: 'active',
      }).eq('id', existing.data.id).select('id,category_id').maybeSingle();
      if (updated.error || !updated.data) return json({ error: 'CATALOG_UNAVAILABLE' }, 503);
      return json({ itemId: updated.data.id, categoryId: updated.data.category_id, created: false });
    }

    const quota = await client.rpc('reserve_external_catalog_import', { p_user_id: user.id });
    if (quota.error) return json({ error: 'CATALOG_UNAVAILABLE' }, 503);
    if (quota.data !== true) return json({ error: 'RATE_LIMITED' }, 429);

    const inserted = await client.from('items').insert({
      category_id: category.id,
      name: channel.title,
      normalized_name: normalizeItemName(channel.title),
      official_url: channel.channelUrl,
      image_source_url: channel.thumbnailUrl,
      external_source: YOUTUBE_SOURCE,
      external_id: id,
      original_name: channel.title,
      release_year: null,
      creator_name: null,
      collection_name: null,
      external_refreshed_at: now,
      status: 'active',
    }).select('id,category_id').maybeSingle();
    if (!inserted.error && inserted.data) {
      return json({ itemId: inserted.data.id, categoryId: inserted.data.category_id, created: true });
    }
    if (inserted.error?.code !== '23505') return json({ error: 'CATALOG_UNAVAILABLE' }, 503);
    const winner = await findExisting();
    return !winner.error && winner.data
      ? json({ itemId: winner.data.id, categoryId: category.id, created: false })
      : json({ error: 'CATALOG_UNAVAILABLE' }, 503);
  };
}
