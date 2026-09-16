import { useMutation, useQueryClient } from '@tanstack/react-query';

import { invalidatePickData } from '@/lib/query/invalidatePickData';
import type { ChangePickInput } from '@/repositories/interfaces/pickRepository';
import { pickService } from '@/services';

export function useChoosePick() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: ChangePickInput) => pickService.choosePick(input),
    onSuccess: () => invalidatePickData(queryClient),
  });
}
