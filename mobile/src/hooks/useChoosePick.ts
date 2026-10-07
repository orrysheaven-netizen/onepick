import { useMutation, useQueryClient } from '@tanstack/react-query';

import { armFirstPickNotice, captureTrustedCurrentPicks } from '@/lib/home/firstPickNotice';
import { invalidatePickData } from '@/lib/query/invalidatePickData';
import type { ChangePickInput } from '@/repositories/interfaces/pickRepository';
import { observabilityService, pickService } from '@/services';

export function useChoosePick() {
  const queryClient = useQueryClient();

  return useMutation({
    // Pre-save Picks for the first-Pick notice, read before the save can invalidate them.
    onMutate: () => ({ priorPicks: captureTrustedCurrentPicks(queryClient) }),
    mutationFn: (input: ChangePickInput) => pickService.choosePick(input),
    onSuccess: (pick, _input, context) => {
      armFirstPickNotice(pick.userId, pick.id, context?.priorPicks.get(pick.userId));
      invalidatePickData(queryClient);
      void observabilityService.captureProductEvent({
        eventName: 'pick_created',
        pickId: pick.id,
        itemId: pick.itemId,
        categoryId: pick.categoryId,
        source: 'choose_pick',
        path: '/pick/choose',
      });
    },
  });
}

