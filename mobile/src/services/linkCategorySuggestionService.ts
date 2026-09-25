import { AppError } from '@/errors/appError';
import type { LinkCategorySuggestionRepository } from '@/repositories/interfaces/linkCategorySuggestionRepository';
import type { LinkCategorySuggestionInput } from '@/types/domain/linkCategorySuggestion';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class LinkCategorySuggestionService {
  constructor(private readonly repository: LinkCategorySuggestionRepository) {}

  suggest(input: LinkCategorySuggestionInput) {
    const url = input.url.trim();
    const name = input.name?.trim().replace(/\s+/g, ' ') ?? '';
    if (!url || url.length > 2048) throw new AppError('ITEM_NOT_ELIGIBLE');
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== 'https:' || parsed.username || parsed.password) throw new Error('bad');
    } catch {
      throw new AppError('ITEM_NOT_ELIGIBLE');
    }
    if (name.length > 100) throw new AppError('ITEM_NAME_INVALID');
    return this.repository.suggest({ ...input, url, ...(name ? { name } : {}) });
  }

  attachPendingLink(itemId: string, rawUrl: string) {
    if (!UUID_PATTERN.test(itemId)) throw new AppError('ITEM_NOT_FOUND');
    const url = rawUrl.trim();
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== 'https:' || parsed.username || parsed.password) throw new Error('bad');
    } catch {
      throw new AppError('ITEM_NOT_ELIGIBLE');
    }
    return this.repository.attachPendingLink(itemId, url);
  }
}
