import { useQuery } from '@tanstack/react-query';

import { queryKeys } from '@/lib/query/queryKeys';
import { itemService } from '@/services';

export function useItemDetail(itemId: string | undefined, userId?: string) {
  return useQuery({
    queryKey: queryKeys.items.detail(itemId ?? 'missing', userId),
    queryFn: () => itemService.getItemDetail(itemId!, userId),
    enabled: Boolean(itemId),
  });
}
