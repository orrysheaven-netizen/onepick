import { useQuery } from '@tanstack/react-query';

import { queryKeys } from '@/lib/query/queryKeys';
import { profileService } from '@/services';

export function useMyProfile(userId?: string) {
  return useQuery({
    queryKey: userId ? queryKeys.profiles.mine(userId) : ['profiles', 'mine', 'anonymous'],
    queryFn: () => profileService.getMyProfile(userId!),
    enabled: Boolean(userId),
  });
}
