import { useMutation, useQueryClient } from '@tanstack/react-query';

import { invalidatePickData } from '@/lib/query/invalidatePickData';
import type { RemovePickInput, UpdatePickReviewInput } from '@/repositories/interfaces/pickRepository';
import { pickService } from '@/services';

export function useManagePick() {
  const queryClient = useQueryClient();
  const onSuccess = () => invalidatePickData(queryClient);

  const updateReview = useMutation({
    mutationFn: (input: UpdatePickReviewInput) => pickService.updateReview(input),
    onSuccess,
  });
  const removePick = useMutation({
    mutationFn: (input: RemovePickInput) => pickService.removePick(input),
    onSuccess,
  });
  const setRepresentative = useMutation({
    mutationFn: (pickId: string) => pickService.setRepresentative(pickId),
    onSuccess,
  });

  return { updateReview, removePick, setRepresentative };
}
