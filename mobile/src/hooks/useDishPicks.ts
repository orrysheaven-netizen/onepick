import { useInfiniteQuery } from '@tanstack/react-query';

import type { PickChannel } from '@/lib/items/pickChannel';
import { queryKeys } from '@/lib/query/queryKeys';
import type { ReadCursor } from '@/repositories/interfaces/readRepository';
import { homeService } from '@/services/homeServiceInstance';

const DISH_PICKS_STALE_TIME = 60_000;

/** Everyone's current Pick for one dish (미역국), newest first, same rules as the Home feed. */
export function useDishPicks(categoryId: string | undefined, channel: PickChannel | null, userId?: string) {
  return useInfiniteQuery({
    enabled: Boolean(categoryId),
    queryKey: queryKeys.home.dishPicks(userId, categoryId ?? '', channel),
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
