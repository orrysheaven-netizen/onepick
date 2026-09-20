import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

import { queryKeys } from '@/lib/query/queryKeys';
import { movieCatalogService } from '@/services';
import type { CatalogMediaType } from '@/types/domain/movieCatalog';

const SEARCH_DELAY_MS = 200;
const FRESH_RESULT_MS = 30_000;

export function useMovieCatalogSearch(searchText: string, enabled: boolean, mediaType: CatalogMediaType = 'movie') {
  const normalizedQuery = searchText.trim().replace(/\s+/g, ' ');
  const [settledQuery, setSettledQuery] = useState('');
  const queryClient = useQueryClient();
  const key = mediaType === 'movie' ? queryKeys.movieCatalog.search(normalizedQuery)
    : [...queryKeys.movieCatalog.search(normalizedQuery), 'tv'];
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
    queryFn: ({ signal }) => mediaType === 'movie' ? movieCatalogService.search(normalizedQuery, signal)
      : movieCatalogService.search(normalizedQuery, signal, mediaType),
    enabled: valid && !isWaiting,
    staleTime: FRESH_RESULT_MS,
  });

  return { ...query, isWaiting };
}

export function useImportMovieCatalogItem(mediaType: CatalogMediaType = 'movie') {
  return useMutation({ mutationFn: (externalId: string) => mediaType === 'movie'
    ? movieCatalogService.importMovie(externalId) : movieCatalogService.importMovie(externalId, mediaType) });
}
