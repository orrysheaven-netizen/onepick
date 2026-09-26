import { useMutation, useQueryClient } from '@tanstack/react-query';

import { invalidatePickData } from '@/lib/query/invalidatePickData';
import type { UpdatePickReviewInput } from '@/repositories/interfaces/pickRepository';
import { pickService } from '@/services';

export function useManagePick() {
  const queryClient = useQueryClient();
  const onSuccess = () => invalidatePickData(queryClient);

  const updateReview = useMutation({
    mutationFn: (input: UpdatePickReviewInput) => pickService.updateReview(input),
    onSuccess,
  });
  const removePick = useMutation({
    mutationFn: ({ categoryId, channel }: { categoryId: string; channel?: 'offline' | 'online' | 'recipe' }) => pickService.removePick(categoryId, channel),
    onSuccess,
  });

  return { updateReview, removePick };
}
