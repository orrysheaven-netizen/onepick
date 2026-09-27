import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

import { queryKeys } from '@/lib/query/queryKeys';
import { itemService } from '@/services/itemServiceInstance';

const SEARCH_DELAY_MS = 150;
const FRESH_RESULT_MS = 30_000;

export function useItemSearch(searchText: string, categoryId?: string, categoryIds?: string[]) {
  const normalizedQuery = searchText.trim().replace(/\s+/g, ' ');
  const [settledQuery, setSettledQuery] = useState('');
  const queryClient = useQueryClient();
  const key = queryKeys.items.search(normalizedQuery, categoryId, categoryIds);
  const cached = queryClient.getQueryState(key);
  const age = cached ? Date.now() - cached.dataUpdatedAt : Infinity;
  // Only an exact-key, recent successful result may bypass the typing delay.
  // Invalidated photos/catalog entries and failed reads must be checked again.
  const fresh = Boolean(cached?.status === 'success' && cached.data !== undefined
    && !cached.isInvalidated && age >= 0 && age < FRESH_RESULT_MS);

  useEffect(() => {
    const timeout = setTimeout(() => setSettledQuery(normalizedQuery), SEARCH_DELAY_MS);
    return () => clearTimeout(timeout);
  }, [normalizedQuery]);

  const hasSearchText = normalizedQuery.length > 0;
  const isWaiting = hasSearchText && normalizedQuery !== settledQuery && !fresh;
  const query = useQuery({
    queryKey: key,
    queryFn: ({ signal }) => categoryIds === undefined
      ? itemService.search(normalizedQuery, categoryId, signal)
      : itemService.search(normalizedQuery, undefined, signal, categoryIds),
    enabled: hasSearchText && !isWaiting && (categoryIds === undefined || categoryIds.length > 0),
    staleTime: FRESH_RESULT_MS,
  });

  return { ...query, isWaiting, hasSearchText };
}
