import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { invalidatePickData } from '@/lib/query/invalidatePickData';
import { itemCategoryAiService } from '@/services/itemCategoryAiService';
import { registrationService } from '@/services/registrationService';

const suggestionKey = (itemId: string) => ['item-category-ai', itemId] as const;

export function useItemCategorySuggestions(itemId?: string) {
  return useQuery({
    queryKey: itemId ? suggestionKey(itemId) : ['item-category-ai', 'missing'],
    queryFn: () => itemCategoryAiService.suggest(itemId!),
    enabled: Boolean(itemId),
    staleTime: 5 * 60 * 1000,
  });
}

export function useApplyItemCategory(itemId?: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (categoryId: string) => {
      if (!itemId) throw new Error('ITEM_REQUIRED');
      return itemCategoryAiService.apply(itemId, categoryId);
    },
    onSuccess: async () => {
      invalidatePickData(client);
      if (itemId) await client.invalidateQueries({ queryKey: suggestionKey(itemId) });
    },
  });
}

/** Free-text category hint when none of the existing categories fit. */
export function useSetItemCategoryHint(itemId?: string, userId?: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (label: string) => {
      if (!itemId || !userId) throw new Error('ITEM_REQUIRED');
      return registrationService.setCategoryHint({ userId, itemId, label });
    },
    onSuccess: () => invalidatePickData(client),
  });
}
