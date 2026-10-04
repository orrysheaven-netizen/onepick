import { useQuery } from '@tanstack/react-query';
import { itemService } from '@/services';

/** Item detail (Figma 36): store profile link and short region of a store item. */
export function useItemStore(itemId: string, enabled = true) {
  return useQuery({
    queryKey: ['items', 'store', itemId],
    queryFn: () => itemService.getStore(itemId),
    enabled: Boolean(itemId) && enabled,
    staleTime: 5 * 60_000,
  });
}
