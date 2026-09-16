import { useQuery } from '@tanstack/react-query';

import { queryKeys } from '@/lib/query/queryKeys';
import { exploreService } from '@/services';

export function useExploreData(categoryId?: string) {
  return useQuery({
    queryKey: queryKeys.explore.data(categoryId),
    queryFn: () => exploreService.getExploreData(categoryId),
  });
}
