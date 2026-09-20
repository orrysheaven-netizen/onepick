import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

import { queryKeys } from '@/lib/query/queryKeys';
import { musicCatalogService } from '@/services';

const SEARCH_DELAY_MS = 300;
const FRESH_RESULT_MS = 10 * 60_000;

export function useMusicCatalogSearch(title: string, artist: string, enabled: boolean) {
  const cleanTitle = title.trim().replace(/\s+/g, ' ');
  const cleanArtist = artist.trim().replace(/\s+/g, ' ');
  const scope = `${cleanTitle}\n${cleanArtist}`;
  const [settledScope, setSettledScope] = useState('');
  const queryClient = useQueryClient();
  const key = queryKeys.musicCatalog.search(cleanTitle, cleanArtist);
  const cached = queryClient.getQueryState(key);
  const age = cached ? Date.now() - cached.dataUpdatedAt : Infinity;
  const fresh = Boolean(cached?.status === 'success' && cached.data !== undefined
    && !cached.isInvalidated && age >= 0 && age < FRESH_RESULT_MS);
  const valid = enabled && cleanTitle.length >= 1 && cleanTitle.length <= 100
    && cleanArtist.length <= 100 && (cleanTitle.length >= 2 || cleanArtist.length >= 2);

  useEffect(() => {
    const timeout = setTimeout(() => setSettledScope(scope), SEARCH_DELAY_MS);
    return () => clearTimeout(timeout);
  }, [scope]);

  const isWaiting = valid && scope !== settledScope && !fresh;
  const query = useQuery({
    queryKey: key,
    queryFn: ({ signal }) => musicCatalogService.search(cleanTitle, cleanArtist, signal),
    enabled: valid && !isWaiting,
    staleTime: FRESH_RESULT_MS,
  });
  return { ...query, isWaiting, valid, cleanTitle, cleanArtist };
}

export function useImportMusicCatalogItem() {
  return useMutation({ mutationFn: (externalId: string) => musicCatalogService.importRecording(externalId) });
}
