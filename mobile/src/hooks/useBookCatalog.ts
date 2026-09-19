import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

import { queryKeys } from '@/lib/query/queryKeys';
import { bookCatalogService } from '@/services';

const SEARCH_DELAY_MS = 300;
const FRESH_RESULT_MS = 10 * 60_000;

export function useBookCatalogSearch(title: string, author: string, enabled: boolean) {
  const cleanTitle = title.trim().replace(/\s+/g, ' ');
  const cleanAuthor = author.trim().replace(/\s+/g, ' ');
  const scope = `${cleanTitle}\n${cleanAuthor}`;
  const [settledScope, setSettledScope] = useState('');
  const queryClient = useQueryClient();
  const key = queryKeys.bookCatalog.search(cleanTitle, cleanAuthor);
  const cached = queryClient.getQueryState(key);
  const age = cached ? Date.now() - cached.dataUpdatedAt : Infinity;
  const fresh = Boolean(cached?.status === 'success' && cached.data !== undefined
    && !cached.isInvalidated && age >= 0 && age < FRESH_RESULT_MS);
  const valid = enabled && cleanTitle.length >= 1 && cleanTitle.length <= 100
    && cleanAuthor.length <= 100 && (cleanTitle.length >= 2 || cleanAuthor.length >= 2);

  useEffect(() => {
    const timeout = setTimeout(() => setSettledScope(scope), SEARCH_DELAY_MS);
    return () => clearTimeout(timeout);
  }, [scope]);

  const isWaiting = valid && scope !== settledScope && !fresh;
  const query = useQuery({
    queryKey: key,
    queryFn: ({ signal }) => bookCatalogService.search(cleanTitle, cleanAuthor, signal),
    enabled: valid && !isWaiting,
    staleTime: FRESH_RESULT_MS,
  });
  return { ...query, isWaiting, valid, cleanTitle, cleanAuthor };
}

export function useImportBookCatalogItem() {
  return useMutation({ mutationFn: (externalId: string) => bookCatalogService.importBook(externalId) });
}
