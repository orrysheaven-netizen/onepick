import { useInfiniteQuery } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query/queryKeys';
import type { ReadCursor } from '@/repositories/interfaces/readRepository';
import { homeService } from '@/services';

export function useHomeData(userId?: string, enabled = true) {
  return useInfiniteQuery({
    enabled,
    // A new model and a viewer-specific RPC: never reuse the old product feed.
    queryKey: [...queryKeys.home.data(userId), 'people-v1'],
    initialPageParam: null as ReadCursor | null,
    queryFn: ({ pageParam }) => homeService.getHomeData(userId, pageParam),
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    select: (data) => {
      const first = data.pages[0];
      const seen = new Set<string>();
      return {
        ...first,
        featuredPicks: data.pages.flatMap((page) => page.featuredPicks).filter((entry) => {
          // Keep distinct people even when they chose the very same product.
          if (entry.userId === userId || seen.has(entry.pickId)) return false;
          seen.add(entry.pickId);
          return true;
        }),
      };
    },
  });
}
