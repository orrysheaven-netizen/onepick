import { useQuery } from '@tanstack/react-query';

import { queryKeys } from '@/lib/query/queryKeys';
import { providerProfileService } from '@/services/providerProfileService';

export function useProviderProfile(providerId?: string) {
  return useQuery({
    queryKey: queryKeys.providers.detail(providerId),
    enabled: Boolean(providerId),
    queryFn: () => providerProfileService.get(providerId!),
    staleTime: 60_000,
    retry: 1,
  });
}
