import { useInfiniteQuery } from '@tanstack/react-query';

import { queryKeys } from '@/lib/query/queryKeys';
import type { ReadCursor } from '@/repositories/interfaces/readRepository';
import { commentService } from '@/services';

export function usePickComments(pickId?: string) {
  return useInfiniteQuery({
    queryKey: pickId ? queryKeys.comments.byPick(pickId) : ['comments', 'pick', 'missing'],
    initialPageParam: null as ReadCursor | null,
    queryFn: ({ pageParam }) => commentService.getComments(pickId!, pageParam),
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    enabled: Boolean(pickId),
    select: (data) => data.pages.flatMap((page) => page.items),
  });
}
