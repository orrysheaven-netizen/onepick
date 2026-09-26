import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

import { queryKeys } from '@/lib/query/queryKeys';
import { itemService } from '@/services/itemServiceInstance';

const SEARCH_DELAY_MS = 150;
const FRESH_RESULT_MS = 30_000;

/** The dish a search names (미역국) split into 오프라인 맛집 / 온라인 맛집 / 레시피. */
export function useDishChannels(searchText: string, userId?: string, enabled = true) {
  const normalizedQuery = searchText.trim().replace(/\s+/g, ' ');
  const [settledQuery, setSettledQuery] = useState('');

  useEffect(() => {
    const timeout = setTimeout(() => setSettledQuery(normalizedQuery), SEARCH_DELAY_MS);
    return () => clearTimeout(timeout);
  }, [normalizedQuery]);

  return useQuery({
    queryKey: queryKeys.items.dishChannels(settledQuery, userId),
    queryFn: () => itemService.getDishChannelOverview(settledQuery),
    enabled: enabled && settledQuery.replace(/\s/g, '').length >= 2 && settledQuery === normalizedQuery,
    staleTime: FRESH_RESULT_MS,
    retry: false,
  });
}
