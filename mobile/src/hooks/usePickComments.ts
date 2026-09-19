import { useInfiniteQuery } from '@tanstack/react-query';

import { queryKeys } from '@/lib/query/queryKeys';
import type { ReadCursor } from '@/repositories/interfaces/readRepository';
import { commentService } from '@/services';

export function usePickComments(pickId?: string, viewerId?: string) {
  return useInfiniteQuery({
    // Visibility depends on the viewer's blocks and session. Keep the existing
    // prefix so comment writes still invalidate every viewer's cached pages.
    queryKey: [...queryKeys.comments.byPick(pickId ?? 'missing'), viewerId ?? 'anonymous'],
    initialPageParam: null as ReadCursor | null,
    queryFn: ({ pageParam }) => commentService.getComments(pickId!, pageParam),
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    enabled: Boolean(pickId),
    select: (data) => {
      const seen = new Set<string>();
      return data.pages.flatMap((page) => page.items).filter(({ comment }) => {
        if (seen.has(comment.id)) return false;
        seen.add(comment.id);
        return true;
      });
    },
  });
}
