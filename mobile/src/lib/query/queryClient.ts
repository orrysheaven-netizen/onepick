import { QueryClient } from '@tanstack/react-query';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      // Keep results for a whole session of browsing. Going Home → detail →
      // back used to drop the cached page and re-render an empty loading state;
      // the retained data now paints immediately while the refetch runs.
      gcTime: 30 * 60_000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
    mutations: {
      retry: 0,
    },
  },
});
