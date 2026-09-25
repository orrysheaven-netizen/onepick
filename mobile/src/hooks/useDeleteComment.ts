import { useMutation, useQueryClient } from '@tanstack/react-query';

import { queryKeys } from '@/lib/query/queryKeys';
import { commentService } from '@/services';

export function useDeleteComment(pickId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (commentId: string) => commentService.removeComment(commentId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.comments.byPick(pickId) });
    },
  });
}
