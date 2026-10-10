import { useQuery } from '@tanstack/react-query';
import type { PickCountChannelScope } from '@/repositories/interfaces/readRepository';
import { itemService } from '@/services';

export function useItemPickCount(itemId: string, channelScope?: PickCountChannelScope) {
  return useQuery({
    queryKey: ['items', 'pick-count', itemId, channelScope?.channel ?? 'all-channels', channelScope?.includeUnchanneled ?? null],
    queryFn: () => itemService.getPickCount(itemId, channelScope),
    enabled: Boolean(itemId),
    staleTime: 60_000,
    refetchInterval: 120_000,
  });
}
