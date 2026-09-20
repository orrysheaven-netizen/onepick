import { useInfiniteQuery } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query/queryKeys';
import type { ReadCursor } from '@/repositories/interfaces/readRepository';
import { homeService } from '@/services';

export function useHomeData(userId?: string, enabled = true) {
  return useInfiniteQuery({
    enabled,
    queryKey: [...queryKeys.home.data(userId), 'infinite'],
    initialPageParam: null as ReadCursor | null,
    queryFn: ({ pageParam }) => homeService.getHomeData(userId, pageParam),
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    select: (data) => {
      const first = data.pages[0];
      const seen = new Set<string>();
      return {
        ...first,
        // A Pick can move between pages while the user scrolls; show each once.
        picks: data.pages.flatMap((page) => page.picks).filter((pick) => {
          if (seen.has(pick.pickId)) return false;
          seen.add(pick.pickId);
          return true;
        }),
      };
    },
  });
}
