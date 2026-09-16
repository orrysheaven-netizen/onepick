import { useInfiniteQuery } from '@tanstack/react-query';

import { queryKeys } from '@/lib/query/queryKeys';
import { commentService } from '@/services';

export function usePickComments(pickId?: string) {
  return useInfiniteQuery({
    queryKey: pickId ? queryKeys.comments.byPick(pickId) : ['comments', 'pick', 'missing'],
    initialPageParam: 0,
    queryFn: ({ pageParam }) => commentService.getComments(pickId!, pageParam),
    getNextPageParam: (lastPage) => lastPage.nextOffset ?? undefined,
    enabled: Boolean(pickId),
    select: (data) => data.pages.flatMap((page) => page.items),
  });
}
