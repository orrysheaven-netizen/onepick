import type { QueryClient } from '@tanstack/react-query';

import { queryKeys } from './queryKeys';

export async function invalidatePickData(queryClient: QueryClient) {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: queryKeys.home.all }),
    queryClient.invalidateQueries({ queryKey: queryKeys.products.all }),
    queryClient.invalidateQueries({ queryKey: queryKeys.picks.all }),
    queryClient.invalidateQueries({ queryKey: queryKeys.profiles.all }),
    queryClient.invalidateQueries({ queryKey: queryKeys.explore.all }),
  ]);
}
