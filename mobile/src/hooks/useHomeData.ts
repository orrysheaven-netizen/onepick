import { keepPreviousData, useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query/queryKeys';
import type { PickChannel, ReadCursor } from '@/repositories/interfaces/readRepository';
import { homeService } from '@/services/homeServiceInstance';

const HOME_CONTEXT_STALE_TIME = 5 * 60_000;
const HOME_MAX_PAGES = 3;
const HOME_MENU_RANKING_CANDIDATE_LIMIT = 20;

export function useHomeMenuRanking(groupCategoryId: string | null = null, channel: PickChannel | null = null, enabled = true) {
  return useQuery({
    enabled,
    queryKey: queryKeys.home.menuRanking(groupCategoryId, channel),
    queryFn: () => homeService.getRecentMenuRanking(groupCategoryId, channel, HOME_MENU_RANKING_CANDIDATE_LIMIT),
    staleTime: HOME_CONTEXT_STALE_TIME,
  });
}

/** Store×menu 7-day ranking: Home shows the first six, 더보기 shows up to 50 in order. */
export function useHomeItemRanking(channel: PickChannel | null = null, limit = 20, enabled = true) {
  return useQuery({
    enabled,
    queryKey: queryKeys.home.itemRanking(channel, limit),
    queryFn: () => homeService.getRecentItemRanking(channel, limit),
    staleTime: HOME_CONTEXT_STALE_TIME,
  });
}

/** Figma 30E "오늘의 질문": the admin-set category id, or null when none is set. */
export function useDailyQuestionCategory(enabled = true) {
  return useQuery({
    enabled,
    queryKey: queryKeys.home.dailyQuestion(),
    queryFn: () => homeService.getDailyQuestionCategoryId(),
    staleTime: HOME_CONTEXT_STALE_TIME,
  });
}

/** Figma 30E "함께하는 사람들": current public Picks read with the viewer's visibility rules. */
export function useHomeParticipantPicks(userId: string | undefined, enabled = true) {
  return useQuery({
    enabled,
    queryKey: queryKeys.home.participants(userId),
    queryFn: () => homeService.getParticipantPicks(),
    staleTime: HOME_CONTEXT_STALE_TIME,
  });
}

/**
 * Full public feed (Home → 사람들의 원픽 더보기): 20 Picks per server page, all pages kept
 * so the list never drops rows it already showed, each Pick shown once.
 */
export function useFullPickFeed(userId: string | undefined, enabled: boolean, channel: PickChannel | null = null, rootSlug: string | null = null) {
  return useInfiniteQuery({
    enabled,
    queryKey: [...queryKeys.home.data(userId), 'full-feed', channel ?? 'all', rootSlug ?? 'every-root'],
    initialPageParam: null as ReadCursor | null,
    queryFn: ({ pageParam }) => homeService.getHomePicks(pageParam, channel, rootSlug),
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    select: (data) => {
      const seen = new Set<string>();
      return data.pages.flatMap((page) => page.picks).filter((pick) => {
        if (seen.has(pick.pickId)) return false;
        seen.add(pick.pickId);
        return true;
      });
    },
  });
}

export function useHomeData(userId?: string, enabled = true, feedEnabled = enabled, channel: PickChannel | null = null, rootSlug: string | null = null) {
  const context = useQuery({
    enabled,
    queryKey: [...queryKeys.home.data(userId), 'context', channel ?? 'all', rootSlug ?? 'every-root'],
    queryFn: () => homeService.getHomeContext(userId, channel, rootSlug),
    staleTime: HOME_CONTEXT_STALE_TIME,
  });

  const shouldFetchFeed = enabled && feedEnabled;
  const feed = useInfiniteQuery({
    enabled: shouldFetchFeed,
    // Each 매장/온라인 tab is its own server-filtered feed with its own cursor.
    queryKey: [...queryKeys.home.data(userId), 'infinite', channel ?? 'all', rootSlug ?? 'every-root'],
    initialPageParam: null as ReadCursor | null,
    queryFn: ({ pageParam }) => homeService.getHomePicks(pageParam, channel, rootSlug),
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    getPreviousPageParam: () => undefined,
    maxPages: HOME_MAX_PAGES,
    // Switching tabs keeps Home's header mounted; the screen hides the previous
    // tab's rows while isPlaceholderData is true.
    placeholderData: keepPreviousData,
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

