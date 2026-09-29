import { useInfiniteQuery, useQuery } from '@tanstack/react-query';

import { queryKeys } from '@/lib/query/queryKeys';
import { providerProfileService } from '@/services/providerProfileService';

export function useBrandProfile(brandId?: string) {
  return useQuery({
    queryKey: ['brands', brandId ?? 'missing', 'profile'],
    enabled: Boolean(brandId),
    queryFn: () => providerProfileService.brand(brandId!),
    staleTime: 60_000,
    retry: 1,
  });
}

export function useBrandBranches(brandId?: string) {
  return useInfiniteQuery({
    queryKey: ['brands', brandId ?? 'missing', 'branches'],
    enabled: Boolean(brandId),
    initialPageParam: null as import('@/services/providerProfileService').BrandBranchCursor | null,
    queryFn: ({ pageParam }) => providerProfileService.brandBranches(brandId!, pageParam),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    staleTime: 60_000,
    retry: 1,
  });
}

export function useProviderProfile(providerId?: string) {
  return useQuery({
    queryKey: queryKeys.providers.detail(providerId),
    enabled: Boolean(providerId),
    queryFn: () => providerProfileService.get(providerId!),
    staleTime: 60_000,
    retry: 1,
  });
}
