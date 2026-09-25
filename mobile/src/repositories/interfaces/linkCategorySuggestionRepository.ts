import type { LinkCategorySuggestionInput, LinkCategorySuggestionResult } from '@/types/domain/linkCategorySuggestion';

export interface LinkCategorySuggestionRepository {
  suggest(input: LinkCategorySuggestionInput): Promise<LinkCategorySuggestionResult>;
}
