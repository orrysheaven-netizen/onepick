import { useInfiniteQuery, useQuery } from '@tanstack/react-query';

import { queryKeys } from '@/lib/query/queryKeys';
import type { ReadCursor } from '@/repositories/interfaces/readRepository';
import { exploreService } from '@/services';

// Categories only change when an Admin edits them, and every Admin mutation
// already invalidates queryKeys.categories. Holding the list fresh for longer
// than the global default keeps Home → Explore → Profile from re-requesting the
// same rows on each navigation; invalidation still refetches immediately.
const CATEGORY_FRESH_MS = 10 * 60_000;

export function useExploreCategories(enabled = true) {
  return useQuery({
    queryKey: queryKeys.categories.browse,
    queryFn: () => exploreService.getCategories(),
    enabled,
    staleTime: CATEGORY_FRESH_MS,
  });
}

export function useCategoryTopItems(categoryId?: string) {
  return useQuery({
    queryKey: queryKeys.explore.topItems(categoryId),
    enabled: Boolean(categoryId),
    queryFn: () => categoryId ? exploreService.getCategoryTopItems(categoryId) : Promise.resolve([]),
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
