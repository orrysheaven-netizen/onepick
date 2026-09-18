import { useMutation, useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

import { queryKeys } from '@/lib/query/queryKeys';
import { movieCatalogService } from '@/services';

export function useMovieCatalogSearch(searchText: string, enabled: boolean) {
  const normalizedQuery = searchText.trim().replace(/\s+/g, ' ');
  const [settledQuery, setSettledQuery] = useState('');

  useEffect(() => {
    const timeout = setTimeout(() => setSettledQuery(normalizedQuery), 300);
    return () => clearTimeout(timeout);
  }, [normalizedQuery]);

  const isWaiting = enabled && normalizedQuery !== settledQuery;
  const query = useQuery({
    queryKey: queryKeys.movieCatalog.search(normalizedQuery),
    queryFn: () => movieCatalogService.search(normalizedQuery),
    enabled: enabled && normalizedQuery.length >= 2 && normalizedQuery.length <= 60 && !isWaiting,
  });

  return { ...query, isWaiting };
}

export function useImportMovieCatalogItem() {
  return useMutation({ mutationFn: (externalId: string) => movieCatalogService.importMovie(externalId) });
}
