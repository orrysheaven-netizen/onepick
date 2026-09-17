import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

import { queryKeys } from '@/lib/query/queryKeys';
import { itemService } from '@/services';

export function useItemSearch(searchText: string, categoryId?: string) {
  const normalizedQuery = searchText.trim();
  const [settledQuery, setSettledQuery] = useState('');

  useEffect(() => {
    const timeout = setTimeout(() => setSettledQuery(normalizedQuery), 300);
    return () => clearTimeout(timeout);
  }, [normalizedQuery]);

  const isWaiting = normalizedQuery !== settledQuery;
  const query = useQuery({
    queryKey: queryKeys.items.search(normalizedQuery, categoryId),
    queryFn: () => itemService.search(normalizedQuery, categoryId),
    enabled: normalizedQuery.length > 0 && !isWaiting,
  });

  return { ...query, isWaiting, hasSearchText: normalizedQuery.length > 0 };
}
