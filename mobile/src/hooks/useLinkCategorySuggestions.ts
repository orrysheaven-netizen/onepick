import { useMutation } from '@tanstack/react-query';

import { linkCategorySuggestionService } from '@/services/linkCategorySuggestionServiceInstance';
import type { LinkCategorySuggestionInput } from '@/types/domain/linkCategorySuggestion';

export function useLinkCategorySuggestions() {
  return useMutation({
    mutationFn: (input: LinkCategorySuggestionInput) => linkCategorySuggestionService.suggest(input),
  });
}
