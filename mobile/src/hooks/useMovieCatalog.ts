import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

import { queryKeys } from '@/lib/query/queryKeys';
import { movieCatalogService } from '@/services';

const SEARCH_DELAY_MS = 200;
const FRESH_RESULT_MS = 30_000;

export function useMovieCatalogSearch(searchText: string, enabled: boolean) {
  const normalizedQuery = searchText.trim().replace(/\s+/g, ' ');
  const [settledQuery, setSettledQuery] = useState('');
  const queryClient = useQueryClient();
  const key = queryKeys.movieCatalog.search(normalizedQuery);
  const cached = queryClient.getQueryState(key);
  const age = cached ? Date.now() - cached.dataUpdatedAt : Infinity;
  const fresh = Boolean(cached?.status === 'success' && cached.data !== undefined
    && !cached.isInvalidated && age >= 0 && age < FRESH_RESULT_MS);

  useEffect(() => {
    const timeout = setTimeout(() => setSettledQuery(normalizedQuery), SEARCH_DELAY_MS);
    return () => clearTimeout(timeout);
  }, [normalizedQuery]);

  const valid = enabled && normalizedQuery.length >= 2 && normalizedQuery.length <= 60;
  const isWaiting = valid && normalizedQuery !== settledQuery && !fresh;
  const query = useQuery({
    queryKey: key,
    queryFn: ({ signal }) => movieCatalogService.search(normalizedQuery, signal),
    enabled: valid && !isWaiting,
    staleTime: FRESH_RESULT_MS,
  });

  return { ...query, isWaiting };
}

export function useImportMovieCatalogItem() {
  // A selected-item import is a mutation, not a cancellable typeahead read.
  return useMutation({ mutationFn: (externalId: string) => movieCatalogService.importMovie(externalId) });
}
