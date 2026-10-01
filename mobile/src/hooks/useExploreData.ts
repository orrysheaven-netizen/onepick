import type { PickChannel } from '@/lib/items/pickChannel';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';

import { queryKeys } from '@/lib/query/queryKeys';
import type { ReadCursor } from '@/repositories/interfaces/readRepository';
import { exploreService } from '@/services/exploreServiceInstance';

const CATEGORY_BROWSE_STALE_TIME = 5 * 60_000;

export function useExploreCategories(enabled = true) {
  return useQuery({
    queryKey: queryKeys.categories.browse,
    queryFn: () => exploreService.getCategories(),
    enabled,
    staleTime: CATEGORY_BROWSE_STALE_TIME,
  });
}

const RECENT_FOOD_RANKING_STALE_TIME = 60_000;

export function useRecentFoodMenuRanking(
  enabled = true,
  groupCategoryId: string | null = null,
  limit = 6,
) {
  return useQuery({
    queryKey: queryKeys.explore.recentFoodMenus(groupCategoryId, limit),
    enabled,
    staleTime: RECENT_FOOD_RANKING_STALE_TIME,
    queryFn: () => exploreService.getRecentFoodMenuRanking(groupCategoryId, limit),
  });
}
export function useCategoryTopItems(categoryId?: string, channel: PickChannel | null = null) {
  return useQuery({
    queryKey: queryKeys.explore.topItems(categoryId, channel),
    enabled: Boolean(categoryId),
    queryFn: () => categoryId ? exploreService.getCategoryTopItems(categoryId, channel) : Promise.resolve([]),
  });
}

const RANKING_STALE_TIME = 60_000;

/** Public ranking page list for /ranking/[slug]. */
export function useCategoryRanking(
  slug?: string,
  limit?: number,
  channel: PickChannel | null = null,
  rootSlug: string | null = null,
) {
  return useQuery({
    queryKey: queryKeys.explore.ranking(slug, channel, rootSlug),
    enabled: Boolean(slug),
    staleTime: RANKING_STALE_TIME,
    queryFn: () => slug ? exploreService.getCategoryRanking(slug, limit, channel, rootSlug) : Promise.resolve([]),
  });
}

export function useRankingCategories(enabled = true, rootSlug: string | null = null) {
  return useQuery({
    queryKey: queryKeys.explore.rankingCategories(rootSlug),
    enabled,
    staleTime: CATEGORY_BROWSE_STALE_TIME,
    queryFn: () => exploreService.getRankingCategories(rootSlug),
  });
}

export function useCategoryBySlug(slug?: string) {
  return useQuery({
    queryKey: queryKeys.categories.bySlug(slug ?? ''),
    enabled: Boolean(slug),
    staleTime: CATEGORY_BROWSE_STALE_TIME,
    queryFn: () => slug ? exploreService.getCategoryBySlug(slug) : Promise.resolve(null),
  });
}

/** Places/products in scope, one per item, most recently picked first. */
export function useRecentPickedItems(categoryIds: string[] | null, enabled = true, storesOnly = false) {
  return useInfiniteQuery({
    enabled,
    queryKey: queryKeys.explore.recentItems(categoryIds, storesOnly),
    initialPageParam: null as ReadCursor | null,
    queryFn: ({ pageParam }) => exploreService.getRecentItems(categoryIds, pageParam, storesOnly),
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    select: (data) => {
      // A Pick between page fetches can move an item up; keep its first (newest) row only.
      const seen = new Set<string>();
      return data.pages.flatMap((page) => page.items).filter((item) => {
        if (seen.has(item.itemId)) return false;
        seen.add(item.itemId);
        return true;
      });
    },
  });
}

export function useExploreData(categoryId?: string, enabled = true) {
  return useInfiniteQuery({
    enabled,
    queryKey: queryKeys.explore.data(categoryId),
    initialPageParam: null as ReadCursor | null,
    queryFn: ({ pageParam }) => exploreService.getExploreData(categoryId, pageParam),
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    select: (data) => {
      const feed = data.pages.flatMap((page) => page.feed);
      const seenItemIds = new Set<string>();
      const recentItems = feed
        .filter((item) => item.item && item.category)
        .filter((item) => {
          if (seenItemIds.has(item.pick.itemId)) return false;
          seenItemIds.add(item.pick.itemId);
          return true;
        })
        .map((item) => ({ item: item.item!, category: item.category! }))
        .slice(0, 8);

      return {
        pages: data.pages,
        pageParams: data.pageParams,
        openCategories: data.pages[0]?.openCategories ?? [],
        selectedCategoryId: categoryId ?? null,
        feed,
        recentItems,
      };
    },
  });
}
