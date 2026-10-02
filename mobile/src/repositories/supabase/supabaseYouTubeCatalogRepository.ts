import { AppError } from '@/errors/appError';
import type { AppSupabaseClient } from '@/lib/supabase/client';
import type { YouTubeCatalogRepository } from '@/repositories/interfaces/youtubeCatalogRepository';
import { YOUTUBE_VIDEO_ID_PATTERN, youtubeVideoUrl } from '@/lib/youtube/videoLink';
import type {
  ImportedYouTubeChannelItem, RecipeDishSuggestion, RequestedRecipeVideo, YouTubeChannelEntry, YouTubeVideoEntry, YouTubeVideoLookup,
} from '@/types/domain/youtubeCatalog';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CHANNEL_ID_PATTERN = /^UC[A-Za-z0-9_-]{22}$/;

async function functionError(error: unknown) {
  const context = error && typeof error === 'object' && 'context' in error ? error.context : undefined;
  const response = typeof Response !== 'undefined' && context instanceof Response ? context : undefined;
  let body: { error?: unknown } | null = null;
  try { body = response ? await response.clone().json() : null; } catch { /* Ignore non-JSON context. */ }
  if (response?.status === 401 || body?.error === 'AUTH_REQUIRED') return new AppError('AUTH_REQUIRED');
  if (response?.status === 429 || body?.error === 'RATE_LIMITED') return new AppError('RATE_LIMITED');
  if (body?.error === 'CATALOG_NOT_CONFIGURED') return new AppError('CATALOG_NOT_CONFIGURED');
  if (body?.error === 'ITEM_NOT_ELIGIBLE') return new AppError('ITEM_NOT_ELIGIBLE');
  if (body?.error === 'ITEM_ALREADY_PENDING') return new AppError('ITEM_ALREADY_PENDING');
  if (body?.error === 'VIDEO_URL_INVALID') return new AppError('VIDEO_URL_INVALID');
  if (body?.error === 'CHANNEL_NOT_FOUND' || body?.error === 'VIDEO_NOT_FOUND' || body?.error === 'EXTERNAL_ID_INVALID') return new AppError('ITEM_NOT_FOUND');
  if (body?.error === 'CATEGORY_NOT_FOUND') return new AppError('CATEGORY_NOT_FOUND');
  if (body?.error === 'CATEGORY_NOT_PICKABLE' || body?.error === 'CATEGORY_REQUIRED') return new AppError('CATEGORY_NOT_PICKABLE');
  if (body?.error === 'DISH_NAME_INVALID') return new AppError('CATEGORY_LABEL_INVALID');
  if (body?.error === 'REVIEW_INVALID') return new AppError('REVIEW_INVALID');
  return new AppError('NETWORK_ERROR', 'NETWORK_ERROR', error);
}

function isEntry(value: unknown): value is YouTubeChannelEntry {
  if (!value || typeof value !== 'object') return false;
  const row = value as Partial<YouTubeChannelEntry>;
  return row.source === 'youtube_channel'
    && typeof row.externalId === 'string' && CHANNEL_ID_PATTERN.test(row.externalId)
    && typeof row.title === 'string' && row.title.length >= 1 && row.title.length <= 100
    && (row.thumbnailUrl === null || (typeof row.thumbnailUrl === 'string' && row.thumbnailUrl.startsWith('https://')))
    && typeof row.channelUrl === 'string' && row.channelUrl === `https://www.youtube.com/channel/${row.externalId}`
    && (row.existingItemId === null || (typeof row.existingItemId === 'string' && UUID_PATTERN.test(row.existingItemId)));
}

function isVideoEntry(value: unknown): value is YouTubeVideoEntry {
  if (!value || typeof value !== 'object') return false;
  const row = value as Partial<YouTubeVideoEntry>;
  return row.source === 'youtube_video'
    && typeof row.externalId === 'string' && YOUTUBE_VIDEO_ID_PATTERN.test(row.externalId)
    && typeof row.title === 'string' && row.title.length >= 1 && row.title.length <= 100
    && (row.channelTitle === null || (typeof row.channelTitle === 'string' && row.channelTitle.length >= 1 && row.channelTitle.length <= 100))
    && (row.thumbnailUrl === null || (typeof row.thumbnailUrl === 'string' && row.thumbnailUrl.startsWith('https://')))
    && row.videoUrl === youtubeVideoUrl(row.externalId)
    && (row.existingItemId === null || (typeof row.existingItemId === 'string' && UUID_PATTERN.test(row.existingItemId)))
    && (row.existingCategoryId === undefined || row.existingCategoryId === null
      || (typeof row.existingCategoryId === 'string' && UUID_PATTERN.test(row.existingCategoryId)));
}

function isSuggestion(value: unknown): value is RecipeDishSuggestion {
  if (!value || typeof value !== 'object') return false;
  const row = value as Partial<RecipeDishSuggestion>;
  return typeof row.categoryId === 'string' && UUID_PATTERN.test(row.categoryId)
    && typeof row.name === 'string' && row.name.length >= 1 && row.name.length <= 100
    && (row.path === null || (typeof row.path === 'string' && row.path.length <= 300));
}

function importedItem(data: unknown): ImportedYouTubeChannelItem {
  const row = data && typeof data === 'object' ? data as Record<string, unknown> : null;
  if (!row || typeof row.itemId !== 'string' || !UUID_PATTERN.test(row.itemId)
    || typeof row.categoryId !== 'string' || !UUID_PATTERN.test(row.categoryId) || typeof row.created !== 'boolean') {
    throw new AppError('INTERNAL_ERROR');
  }
  return { itemId: row.itemId, categoryId: row.categoryId, created: row.created };
}

export class SupabaseYouTubeCatalogRepository implements YouTubeCatalogRepository {
  constructor(private readonly client: AppSupabaseClient) {}

  async search(query: string, signal?: AbortSignal) {
    const { data, error } = await this.client.functions.invoke('youtube-catalog', {
      body: { action: 'search', query },
      signal,
    });
    if (error) throw await functionError(error);
    if (!Array.isArray(data?.channels)) throw new AppError('INTERNAL_ERROR');
    return data.channels.filter(isEntry).slice(0, 10);
  }

  async importChannel(externalId: string): Promise<ImportedYouTubeChannelItem> {
    const { data: sessionData, error: sessionError } = await this.client.auth.getSession();
    const accessToken = sessionData.session?.access_token?.trim();
    if (sessionError || !accessToken) throw new AppError('AUTH_REQUIRED');

    const { data, error } = await this.client.functions.invoke('youtube-catalog', {
      body: { action: 'import', externalId },
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (error) throw await functionError(error);
    return importedItem(data);
  }

  async lookupVideo(url: string, signal?: AbortSignal): Promise<YouTubeVideoLookup> {
    const { data, error } = await this.client.functions.invoke('youtube-catalog', {
      body: { action: 'video_lookup', url },
      signal,
    });
    if (error) throw await functionError(error);
    if (!isVideoEntry(data?.video)) throw new AppError('INTERNAL_ERROR');
    const video: YouTubeVideoEntry = { ...data.video, existingCategoryId: data.video.existingCategoryId ?? null };
    const suggestions = Array.isArray(data?.suggestions) ? data.suggestions.filter(isSuggestion).slice(0, 5) : [];
    return { video, suggestions };
  }

  private async sessionHeaders() {
    const { data: sessionData, error: sessionError } = await this.client.auth.getSession();
    const accessToken = sessionData.session?.access_token?.trim();
    if (sessionError || !accessToken) throw new AppError('AUTH_REQUIRED');
    return { Authorization: `Bearer ${accessToken}` };
  }

  async importVideo(externalId: string, categoryId: string): Promise<ImportedYouTubeChannelItem> {
    const { data, error } = await this.client.functions.invoke('youtube-catalog', {
      body: { action: 'video_import', externalId, categoryId },
      headers: await this.sessionHeaders(),
    });
    if (error) throw await functionError(error);
    return importedItem(data);
  }

  async requestVideo(externalId: string, dishName: string): Promise<RequestedRecipeVideo> {
    const { data, error } = await this.client.functions.invoke('youtube-catalog', {
      body: { action: 'video_request', externalId, dishName },
      headers: await this.sessionHeaders(),
    });
    if (error) throw await functionError(error);
    const row = data && typeof data === 'object' ? data as Record<string, unknown> : null;
    if (!row || typeof row.itemId !== 'string' || !UUID_PATTERN.test(row.itemId)) throw new AppError('INTERNAL_ERROR');
    return { itemId: row.itemId };
  }
}
