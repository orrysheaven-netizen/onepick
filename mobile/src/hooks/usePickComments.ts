import { useQuery } from '@tanstack/react-query';

import { queryKeys } from '@/lib/query/queryKeys';
import { commentService } from '@/services';

export function usePickComments(pickId?: string) {
  return useQuery({
    queryKey: pickId ? queryKeys.comments.byPick(pickId) : ['comments', 'pick', 'missing'],
    queryFn: () => commentService.getComments(pickId!),
    enabled: Boolean(pickId),
  });
}
