import { useQuery } from '@tanstack/react-query';
import { itemService } from '@/services';

/** Explore search (Figma 43): "원픽 N 지역" for the store Pick rows. */
export function useSearchItemMeta(itemIds: string[]) {
  return useQuery({
    queryKey: ['items', 'search-meta', [...itemIds].sort()],
    queryFn: () => itemService.getSearchItemMeta(itemIds),
    enabled: itemIds.length > 0,
    staleTime: 60_000,
  });
}
