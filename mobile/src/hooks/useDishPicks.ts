import { useInfiniteQuery, useQuery } from '@tanstack/react-query';

import { channelScopeKey, type PickChannelScope } from '@/lib/home/channelFeedMerge';
import { queryKeys } from '@/lib/query/queryKeys';
import type { ReadCursor } from '@/repositories/interfaces/readRepository';
import { homeService } from '@/services/homeServiceInstance';

const DISH_PICKS_STALE_TIME = 60_000;

/** Everyone's current Pick for one dish (미역국), newest first, same rules as the Home feed. */
/** `channel` may name several channels (Home's 오프라인 + 온라인); the repository merges them. */
export function useDishPicks(categoryId: string | undefined, channel: PickChannelScope, userId?: string) {
  return useInfiniteQuery({
    enabled: Boolean(categoryId),
    queryKey: queryKeys.home.dishPicks(userId, categoryId ?? '', channelScopeKey(channel)),
    initialPageParam: null as ReadCursor | null,
    queryFn: ({ pageParam }) => homeService.getHomePicks(pageParam, channel, null, categoryId),
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    staleTime: DISH_PICKS_STALE_TIME,
    select: (data) => {
      // A Pick can move between pages while the user reads; show each once.
      const seen = new Set<string>();
      return data.pages.flatMap((page) => page.picks).filter((pick) => {
        if (seen.has(pick.pickId)) return false;
        seen.add(pick.pickId);
        return true;
      });
    },
  });
}

/** The viewer's own current Picks for the dish (one per channel), shown above everyone else's. */
export function useMyDishPicks(categoryId: string | undefined, userId?: string) {
  return useQuery({
    enabled: Boolean(categoryId && userId),
    queryKey: queryKeys.home.myDishPicks(userId ?? '', categoryId ?? ''),
    queryFn: () => homeService.getMyDishPicks(userId!, categoryId!),
    staleTime: DISH_PICKS_STALE_TIME,
  });
}
