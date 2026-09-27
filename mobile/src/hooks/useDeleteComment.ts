import { useMutation, useQueryClient } from '@tanstack/react-query';

import { queryKeys } from '@/lib/query/queryKeys';
import { commentService } from '@/services';

export function useDeleteComment(pickId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (commentId: string) => commentService.removeComment(commentId),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.comments.byPick(pickId) }),
        // Every tab of the "댓글" screen.
        queryClient.invalidateQueries({ queryKey: ['comments', 'user'] }),
      ]);
    },
  });
}
