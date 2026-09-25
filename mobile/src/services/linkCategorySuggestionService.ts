import { AppError } from '@/errors/appError';
import type { LinkCategorySuggestionRepository } from '@/repositories/interfaces/linkCategorySuggestionRepository';
import type { LinkCategorySuggestionInput } from '@/types/domain/linkCategorySuggestion';

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
}
