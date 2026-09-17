import { useInfiniteQuery } from '@tanstack/react-query';

import { queryKeys } from '@/lib/query/queryKeys';
import type { ReadCursor } from '@/repositories/interfaces/readRepository';
import { profileService } from '@/services';

export function useMyPickHistory(userId?: string) {
  return useInfiniteQuery({
    queryKey: queryKeys.profiles.history(userId),
    initialPageParam: null as ReadCursor | null,
    queryFn: ({ pageParam }) => profileService.getMyPickHistory(userId!, pageParam),
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    select: (data) => data.pages.flatMap((page) => page.items),
    enabled: Boolean(userId),
  });
}

export function useMyProductRequests(userId?: string) {
  return useInfiniteQuery({
    queryKey: queryKeys.profiles.requests(userId),
    initialPageParam: null as ReadCursor | null,
    queryFn: ({ pageParam }) => profileService.getMyProductRequests(userId!, pageParam),
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    select: (data) => data.pages.flatMap((page) => page.items),
    enabled: Boolean(userId),
  });
}
