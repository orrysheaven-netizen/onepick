import { useQuery } from '@tanstack/react-query';
import { itemService } from '@/services';

export function useItemPickCount(itemId: string) {
  return useQuery({
    queryKey: ['items', 'pick-count', itemId],
    queryFn: () => itemService.getPickCount(itemId),
    enabled: Boolean(itemId),
    staleTime: 60_000,
    refetchInterval: 120_000,
  });
}
