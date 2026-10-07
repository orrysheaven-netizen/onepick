import { useInfiniteQuery, useMutation, useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

import type { PickChannel } from '@/lib/items/pickChannel';
import { registrationService } from '@/services';
import { storeFirstService, type StoreCandidate, type StoreForSuggestion } from '@/services/storeFirstService';

const SEARCH_DELAY_MS = 250;

/** Entry prefill from an existing store profile. Server IDs are re-read; names are never trusted as identity. */
export function useProviderStorePrefill(providerId: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: ['store-first', 'provider-prefill', providerId ?? 'missing'],
    queryFn: () => storeFirstService.providerStore(providerId!),
    enabled: enabled && Boolean(providerId),
    staleTime: 10 * 60_000,
    retry: false,
  });
}

/** Step 1: stores (매장, catalog) or online sellers by name, debounced. */
export function useStoreSearch(channel: PickChannel, searchText: string, enabled: boolean) {
  const clean = searchText.trim().replace(/\s+/g, ' ');
  const [settled, setSettled] = useState('');
  useEffect(() => {
    const timeout = setTimeout(() => setSettled(clean), SEARCH_DELAY_MS);
    return () => clearTimeout(timeout);
  }, [clean]);
  const minimum = channel === 'online' ? 1 : 2;
  const valid = enabled && clean.length >= minimum && clean.length <= 100;
  const isWaiting = valid && clean !== settled;
  const query = useInfiniteQuery({
    queryKey: ['store-first', 'search-page', channel, settled],
    initialPageParam: null as string | null,
    queryFn: async ({ signal, pageParam }) => channel === 'online'
      ? { items: await storeFirstService.searchSellers(settled, signal), nextCursor: null }
      : storeFirstService.searchStorePage(settled, pageParam, signal),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    enabled: valid && !isWaiting,
    staleTime: 10 * 60_000,
    retry: false,
  });
  return {
    ...query,
    data: valid && !isWaiting ? query.data?.pages.flatMap((page) => page.items) : undefined,
    valid, isWaiting, minimum,
  };
}

/** Step 2: every food menu the user may choose by hand. */
export function useMenuOptions(enabled: boolean) {
  return useQuery({
    queryKey: ['store-first', 'menus'],
    queryFn: () => storeFirstService.menuOptions(),
    enabled,
    staleTime: 10 * 60_000,
  });
}

/** Step 2: AI category suggestions for the menu name the user typed. */
export function useMenuSuggestions(store: StoreForSuggestion | null, storeKey: string, menuName: string, enabled: boolean) {
  const cleanMenuName = menuName.trim().replace(/\s+/g, ' ');
  return useQuery({
    queryKey: ['store-first', 'menu-ai', storeKey, cleanMenuName],
    queryFn: () => storeFirstService.suggestMenus(store!, cleanMenuName),
    enabled: enabled && Boolean(store) && cleanMenuName.length >= 1 && cleanMenuName.length <= 40,
    staleTime: Infinity,
    retry: false,
  });
}

export function useSelectStoreItem() {
  return useMutation({
    mutationFn: ({ categoryId, store }: { categoryId: string; store: StoreCandidate }) =>
      storeFirstService.selectItem(categoryId, store),
  });
}

/** A menu that does not exist yet travels with the request as the category hint. */
export function useSetMenuHint() {
  return useMutation({
    mutationFn: (input: { userId: string; itemId: string; label: string }) => registrationService.setCategoryHint(input),
  });
}

export function useSuggestMapLink() {
  return useMutation({
    mutationFn: ({ itemId, url }: { itemId: string; url: string }) => storeFirstService.suggestMapLink(itemId, url),
  });
}
