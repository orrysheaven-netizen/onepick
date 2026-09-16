import { useMutation, useQueryClient } from '@tanstack/react-query';

import { queryKeys } from '@/lib/query/queryKeys';
import type { ChangePickInput } from '@/repositories/interfaces/pickRepository';
import { pickService } from '@/services';

export function useChoosePick() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: ChangePickInput) => pickService.choosePick(input),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.home.all }),
        queryClient.invalidateQueries({ queryKey: queryKeys.products.all }),
        queryClient.invalidateQueries({ queryKey: queryKeys.picks.all }),
      ]);
    },
  });
}
