import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query/queryKeys';
import type { ReadCursor } from '@/repositories/interfaces/readRepository';
import { homeService } from '@/services/homeServiceInstance';

const HOME_CONTEXT_STALE_TIME = 5 * 60_000;
const HOME_MAX_PAGES = 3;

export function useHomeData(userId?: string, enabled = true, feedEnabled = enabled) {
  const context = useQuery({
    enabled,
    queryKey: [...queryKeys.home.data(userId), 'context'],
    queryFn: () => homeService.getHomeContext(userId),
    staleTime: HOME_CONTEXT_STALE_TIME,
  });

  const shouldFetchFeed = enabled && feedEnabled;
  const feed = useInfiniteQuery({
    enabled: shouldFetchFeed,
    queryKey: [...queryKeys.home.data(userId), 'infinite'],
    initialPageParam: null as ReadCursor | null,
    queryFn: ({ pageParam }) => homeService.getHomePicks(pageParam),
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    getPreviousPageParam: () => undefined,
    maxPages: HOME_MAX_PAGES,
    select: (data) => {
      const seen = new Set<string>();
      return {
        picks: data.pages.flatMap((page) => page.picks).filter((pick) => {
          // A Pick can move between pages while the user scrolls; show each once.
          if (seen.has(pick.pickId)) return false;
          seen.add(pick.pickId);
          return true;
        }),
        nextCursor: data.pages.at(-1)?.nextCursor ?? null,
      };
    },
  });

  const feedData = feedEnabled ? feed.data : { picks: [], nextCursor: null };
  const data = context.data && feedData ? { ...context.data, ...feedData } : undefined;
  const refetch = (options?: Parameters<typeof feed.refetch>[0]) =>
    Promise.all([
      context.refetch(options),
      ...(feedEnabled ? [feed.refetch(options)] : []),
    ]);

  return {
    ...feed,
    data,
    error: context.error ?? (feedEnabled ? feed.error : null),
    isError: context.isError || (feedEnabled && feed.isError),
    isPending: context.isPending || (feedEnabled && feed.isPending),
    isFetching: context.isFetching || (feedEnabled && feed.isFetching),
    isRefetching: context.isRefetching || (feedEnabled && feed.isRefetching),
    refetch,
  };
}
