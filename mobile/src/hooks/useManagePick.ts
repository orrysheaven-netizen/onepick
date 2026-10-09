import { useMutation, useQueryClient } from '@tanstack/react-query';

import type { PickChannel } from '@/lib/items/pickChannel';
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
    mutationFn: (input: { categoryId: string; channel?: PickChannel | null; pickId?: string }) => pickService.removePick(input.categoryId, input.channel, input.pickId),
    onSuccess,
  });
  const deleteReview = useMutation({
    mutationFn: (pickId: string) => pickService.deleteReview(pickId),
    onSuccess,
  });

  return { updateReview, removePick, deleteReview };
}

