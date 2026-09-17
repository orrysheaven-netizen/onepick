import { useQuery } from '@tanstack/react-query';
import { itemService } from '@/services';

export function useItemPickCount(itemId: string) {
  return useQuery({
    queryKey: ['items', 'pick-count', itemId],
    queryFn: () => itemService.getPickCount(itemId),
    enabled: Boolean(itemId),
    staleTime: 15_000,
    refetchInterval: 30_000,
  });
}
