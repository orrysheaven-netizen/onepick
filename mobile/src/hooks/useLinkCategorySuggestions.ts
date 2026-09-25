import { useMutation } from '@tanstack/react-query';

import { linkCategorySuggestionService } from '@/services/linkCategorySuggestionServiceInstance';
import type { LinkCategorySuggestionInput } from '@/types/domain/linkCategorySuggestion';

export function useLinkCategorySuggestions() {
  return useMutation({
    mutationFn: (input: LinkCategorySuggestionInput) => linkCategorySuggestionService.suggest(input),
  });
}

export function useAttachPendingItemLink() {
  return useMutation({
    mutationFn: ({ itemId, url }: { itemId: string; url: string }) =>
      linkCategorySuggestionService.attachPendingLink(itemId, url),
  });
}
