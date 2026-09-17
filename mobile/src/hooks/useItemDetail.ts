import { useQuery } from '@tanstack/react-query';

import { queryKeys } from '@/lib/query/queryKeys';
import { itemService } from '@/services';

export function useItemDetail(itemId: string | undefined, userId?: string, focusPickId?: string) {
  return useQuery({
    queryKey: [...queryKeys.items.detail(itemId ?? 'missing', userId), focusPickId ?? null],
    queryFn: () => itemService.getItemDetail(itemId!, userId, focusPickId),
    enabled: Boolean(itemId),
  });
}
