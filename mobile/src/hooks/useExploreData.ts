import { useInfiniteQuery } from '@tanstack/react-query';

import { queryKeys } from '@/lib/query/queryKeys';
import { exploreService } from '@/services';

export function useExploreData(categoryId?: string) {
  return useInfiniteQuery({
    queryKey: queryKeys.explore.data(categoryId),
    initialPageParam: 0,
    queryFn: ({ pageParam }) => exploreService.getExploreData(categoryId, pageParam),
    getNextPageParam: (lastPage) => lastPage.nextOffset ?? undefined,
    select: (data) => {
      const feed = data.pages.flatMap((page) => page.feed);
      const seenProductIds = new Set<string>();
      const recentProducts = feed
        .filter((item) => item.product && item.category)
        .filter((item) => {
          if (seenProductIds.has(item.pick.productId)) return false;
          seenProductIds.add(item.pick.productId);
          return true;
        })
        .map((item) => ({ product: item.product!, category: item.category! }))
        .slice(0, 8);

      return {
        pages: data.pages,
        pageParams: data.pageParams,
        openCategories: data.pages[0]?.openCategories ?? [],
        selectedCategoryId: categoryId ?? null,
        feed,
        recentProducts,
      };
    },
  });
}
