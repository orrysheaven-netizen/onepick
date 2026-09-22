import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

import { queryKeys } from '@/lib/query/queryKeys';
import { placeCatalogService } from '@/services';

const SEARCH_DELAY_MS = 250;
const FRESH_RESULT_MS = 10 * 60_000;

export function usePlaceCatalogSearch(searchText: string, enabled: boolean) {
  const cleanQuery = searchText.trim().replace(/\s+/g, ' ');
  const [settledQuery, setSettledQuery] = useState('');
  const queryClient = useQueryClient();
  const key = queryKeys.placeCatalog.search(cleanQuery);
  const cached = queryClient.getQueryState(key);
  const age = cached ? Date.now() - cached.dataUpdatedAt : Infinity;
  const fresh = Boolean(cached?.status === 'success' && cached.data !== undefined
    && !cached.isInvalidated && age >= 0 && age < FRESH_RESULT_MS);
  const valid = enabled && cleanQuery.length >= 2 && cleanQuery.length <= 80;

  useEffect(() => {
    const timeout = setTimeout(() => setSettledQuery(cleanQuery), SEARCH_DELAY_MS);
    return () => clearTimeout(timeout);
  }, [cleanQuery]);

  const isWaiting = valid && cleanQuery !== settledQuery && !fresh;
  const query = useQuery({
    queryKey: key,
    queryFn: ({ signal }) => placeCatalogService.search(cleanQuery, signal),
    enabled: valid && !isWaiting,
    staleTime: FRESH_RESULT_MS,
  });

  return { ...query, isWaiting, valid, cleanQuery };
}

export function useSelectPlaceCatalogItem() {
  return useMutation({
    mutationFn: ({ catalogId, categoryId }: { catalogId: string; categoryId: string }) =>
      placeCatalogService.selectPlace(catalogId, categoryId),
  });
}
