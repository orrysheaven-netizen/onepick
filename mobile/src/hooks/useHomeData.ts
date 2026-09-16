import { useQuery } from '@tanstack/react-query';

import { queryKeys } from '@/lib/query/queryKeys';
import { homeService } from '@/services';

export function useHomeData(userId?: string, enabled = true) {
  return useQuery({
    enabled,
    queryKey: queryKeys.home.data(userId),
    queryFn: () => homeService.getHomeData(userId),
  });
}
