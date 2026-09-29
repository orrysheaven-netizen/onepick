import { useQuery } from '@tanstack/react-query';

import { queryKeys } from '@/lib/query/queryKeys';
import { pickService } from '@/services';

export function usePickDetail(pickId?: string, currentUserId?: string, enabled = true) {
  return useQuery({
    queryKey: pickId ? queryKeys.picks.detail(pickId, currentUserId) : ['picks', 'detail', 'missing'],
    queryFn: () => pickService.getPickDetail(pickId!, currentUserId),
    enabled: Boolean(pickId) && enabled,
  });
}
