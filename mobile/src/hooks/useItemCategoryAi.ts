import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { invalidatePickData } from '@/lib/query/invalidatePickData';
import { itemCategoryAiService } from '@/services/itemCategoryAiService';

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
