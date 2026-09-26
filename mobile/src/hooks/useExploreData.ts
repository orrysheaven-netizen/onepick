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

export function useCategoryTopItems(categoryId?: string) {
  return useQuery({
    queryKey: queryKeys.explore.topItems(categoryId),
    enabled: Boolean(categoryId),
    queryFn: () => categoryId ? exploreService.getCategoryTopItems(categoryId) : Promise.resolve([]),
  });
}

/** 매장/온라인 items of one menu (Explore menu search). */
export function useMenuChannelItems(categoryId?: string) {
  return useQuery({
    queryKey: queryKeys.explore.menuChannels(categoryId),
    enabled: Boolean(categoryId),
    queryFn: () => categoryId ? exploreService.getMenuChannelItems(categoryId) : Promise.resolve([]),
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
