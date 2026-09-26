import { useMutation, useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

import type { PickChannel } from '@/lib/items/pickChannel';
import { registrationService } from '@/services';
import { storeFirstService, type StoreCandidate, type StoreForSuggestion } from '@/services/storeFirstService';

const SEARCH_DELAY_MS = 250;

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
  const query = useQuery({
    queryKey: ['store-first', 'search', channel, settled],
    queryFn: ({ signal }) => channel === 'online'
      ? storeFirstService.searchSellers(settled, signal)
      : storeFirstService.searchStores(settled, signal),
    enabled: valid && !isWaiting,
    staleTime: 10 * 60_000,
  });
  return { ...query, valid, isWaiting, minimum };
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

/** Step 2: AI menu suggestions for the chosen store. Failure falls back to manual choice. */
export function useMenuSuggestions(store: StoreForSuggestion | null, storeKey: string, enabled: boolean) {
  return useQuery({
    queryKey: ['store-first', 'menu-ai', storeKey],
    queryFn: () => storeFirstService.suggestMenus(store!),
    enabled: enabled && Boolean(store),
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
