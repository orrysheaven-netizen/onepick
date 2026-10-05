import { useMutation, useQueryClient } from '@tanstack/react-query';

import { armFirstPickNotice } from '@/lib/home/firstPickNotice';
import { invalidatePickData } from '@/lib/query/invalidatePickData';
import type { ChangePickInput } from '@/repositories/interfaces/pickRepository';
import { observabilityService, pickService } from '@/services';

export function useChoosePick() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: ChangePickInput) => pickService.choosePick(input),
    onSuccess: (pick) => {
      armFirstPickNotice(pick.userId, pick.id);
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
