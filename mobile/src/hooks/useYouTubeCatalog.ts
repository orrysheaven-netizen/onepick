import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

import { queryKeys } from '@/lib/query/queryKeys';
import { youtubeVideoUrl } from '@/lib/youtube/videoLink';
import { youtubeCatalogService } from '@/services';
import type { YouTubeVideoEntry } from '@/types/domain/youtubeCatalog';

const SEARCH_DELAY_MS = 300;
const FRESH_RESULT_MS = 10 * 60_000;

export function useYouTubeCatalogSearch(searchText: string, enabled: boolean) {
  const cleanQuery = searchText.trim().replace(/\s+/g, ' ');
  const [settledQuery, setSettledQuery] = useState('');
  const queryClient = useQueryClient();
  const key = queryKeys.youtubeCatalog.search(cleanQuery);
  const cached = queryClient.getQueryState(key);
  const age = cached ? Date.now() - cached.dataUpdatedAt : Infinity;
  const fresh = Boolean(cached?.status === 'success' && cached.data !== undefined
    && !cached.isInvalidated && age >= 0 && age < FRESH_RESULT_MS);
  const valid = enabled && cleanQuery.length >= 2 && cleanQuery.length <= 1000;

  useEffect(() => {
    const timeout = setTimeout(() => setSettledQuery(cleanQuery), SEARCH_DELAY_MS);
    return () => clearTimeout(timeout);
  }, [cleanQuery]);

  const isWaiting = valid && cleanQuery !== settledQuery && !fresh;
  const query = useQuery({
    queryKey: key,
    queryFn: ({ signal }) => youtubeCatalogService.search(cleanQuery, signal),
    enabled: valid && !isWaiting,
    staleTime: FRESH_RESULT_MS,
  });

  return { ...query, isWaiting, valid, cleanQuery };
}

export function useImportYouTubeChannel() {
  return useMutation({ mutationFn: (externalId: string) => youtubeCatalogService.importChannel(externalId) });
}

/** Recipe video preview for a parsed video ID; the canonical link drops share/tracking params. */
export function useYouTubeVideoLookup(videoId: string | null, enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.youtubeCatalog.video(videoId ?? ''),
    queryFn: ({ signal }) => youtubeCatalogService.lookupVideo(youtubeVideoUrl(videoId!), signal),
    enabled: enabled && Boolean(videoId),
    staleTime: FRESH_RESULT_MS,
    retry: false,
  });
}

export function useImportYouTubeVideo() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (externalId: string) => youtubeCatalogService.importVideo(externalId),
    // Mark the cached preview as registered instead of refetching it (each lookup spends YouTube quota).
    onSuccess: (item, externalId) => {
      queryClient.setQueryData<YouTubeVideoEntry>(queryKeys.youtubeCatalog.video(externalId),
        (current) => current ? { ...current, existingItemId: item.itemId } : current);
    },
  });
}
