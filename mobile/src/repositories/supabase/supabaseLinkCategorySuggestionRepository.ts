import { AppError } from '@/errors/appError';
import type { AppSupabaseClient } from '@/lib/supabase/client';
import type { LinkCategorySuggestionRepository } from '@/repositories/interfaces/linkCategorySuggestionRepository';
import type {
  LinkCategoryOption,
  LinkCategorySuggestionInput,
  LinkCategorySuggestionResult,
  LinkPlaceMatch,
  LinkSuggestedCategory,
} from '@/types/domain/linkCategorySuggestion';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function functionError(error: unknown) {
  const context = error && typeof error === 'object' && 'context' in error ? error.context : undefined;
  const response = typeof Response !== 'undefined' && context instanceof Response ? context : undefined;
  let body: { error?: unknown } | null = null;
  try { body = response ? await response.clone().json() : null; } catch { /* ignore */ }
  if (response?.status === 401 || body?.error === 'AUTH_REQUIRED') return new AppError('AUTH_REQUIRED');
  if (response?.status === 429 || body?.error === 'RATE_LIMITED') return new AppError('RATE_LIMITED');
  if (response?.status === 404 || body?.error === 'ITEM_NOT_FOUND') return new AppError('ITEM_NOT_FOUND');
  if (response?.status === 400 || response?.status === 409 || body?.error === 'URL_INVALID' || body?.error === 'ITEM_NOT_ELIGIBLE') return new AppError('ITEM_NOT_ELIGIBLE');
  return new AppError('NETWORK_ERROR', 'NETWORK_ERROR', error);
}

function isHttps(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 2048) return false;
  try { return new URL(value).protocol === 'https:'; } catch { return false; }
}

function isCategory(value: unknown): value is LinkCategoryOption {
  if (!value || typeof value !== 'object') return false;
  const row = value as Partial<LinkCategoryOption>;
  return typeof row.categoryId === 'string' && UUID_PATTERN.test(row.categoryId)
    && typeof row.label === 'string' && row.label.length >= 1 && row.label.length <= 200
    && typeof row.name === 'string' && row.name.length >= 1 && row.name.length <= 100;
}

function isSuggestion(value: unknown): value is LinkSuggestedCategory {
  if (!isCategory(value)) return false;
  const row = value as Partial<LinkSuggestedCategory>;
  return typeof row.reason === 'string' && row.reason.length <= 160;
}

function isPlace(value: unknown): value is LinkPlaceMatch {
  if (!value || typeof value !== 'object') return false;
  const row = value as Partial<LinkPlaceMatch>;
  return typeof row.catalogId === 'string' && UUID_PATTERN.test(row.catalogId)
    && typeof row.name === 'string' && row.name.length >= 1 && row.name.length <= 100
    && (row.branchName === null || typeof row.branchName === 'string')
    && (row.roadAddress === null || typeof row.roadAddress === 'string')
    && (row.address === null || typeof row.address === 'string')
    && (row.region1 === null || typeof row.region1 === 'string')
    && (row.region2 === null || typeof row.region2 === 'string')
    && (row.providerCategory === null || typeof row.providerCategory === 'string');
}

function parseResult(value: unknown): LinkCategorySuggestionResult {
  if (!value || typeof value !== 'object') throw new AppError('INTERNAL_ERROR');
  const row = value as Partial<LinkCategorySuggestionResult>;
  if ((row.kind !== 'place' && row.kind !== 'online')
      || !isHttps(row.inputUrl) || !isHttps(row.canonicalUrl)
      || typeof row.host !== 'string' || row.host.length < 1 || row.host.length > 253
      || (row.title !== null && typeof row.title !== 'string')
      || (row.description !== null && typeof row.description !== 'string')
      || (row.resolvedName !== null && typeof row.resolvedName !== 'string')
      || typeof row.needsName !== 'boolean'
      || !Array.isArray(row.places) || !row.places.every(isPlace)
      || !Array.isArray(row.suggestions) || !row.suggestions.every(isSuggestion)
      || !Array.isArray(row.categories) || !row.categories.every(isCategory)) {
    throw new AppError('INTERNAL_ERROR');
  }
  return row as LinkCategorySuggestionResult;
}

export class SupabaseLinkCategorySuggestionRepository implements LinkCategorySuggestionRepository {
  constructor(private readonly client: AppSupabaseClient) {}

  async suggest(input: LinkCategorySuggestionInput) {
    const { data, error } = await this.client.functions.invoke('link-category-suggestions', {
      body: {
        url: input.url,
        ...(input.name?.trim() ? { name: input.name.trim() } : {}),
        ...(input.placeCatalogId ? { placeCatalogId: input.placeCatalogId } : {}),
      },
    });
    if (error) throw await functionError(error);
    return parseResult(data);
  }

  async attachPendingLink(itemId: string, url: string) {
    const { data, error } = await this.client.functions.invoke('link-category-suggestions', {
      body: { action: 'attach_pending_link', itemId, url },
    });
    if (error) throw await functionError(error);
    if (!data || data.ok !== true) throw new AppError('INTERNAL_ERROR');
  }
}
