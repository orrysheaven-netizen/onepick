import { useQuery } from '@tanstack/react-query';

import { queryKeys } from '@/lib/query/queryKeys';
import { profileTasteCompositionService } from '@/services/profileTasteCompositionService';

export function useProfileTasteComposition(profileId?: string) {
  return useQuery({
    queryKey: profileId
      ? queryKeys.profileTaste.composition(profileId)
      : ['profile-taste', 'composition', 'missing'],
    queryFn: () => profileTasteCompositionService.get(profileId!),
    enabled: Boolean(profileId),
    staleTime: 30_000,
  });
}
