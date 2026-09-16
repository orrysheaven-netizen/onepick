import { useQuery } from '@tanstack/react-query';

import { queryKeys } from '@/lib/query/queryKeys';
import { profileService } from '@/services';

export function usePublicProfile(username?: string, currentUserId?: string) {
  const normalizedUsername = username?.trim().toLowerCase();

  return useQuery({
    queryKey: normalizedUsername
      ? queryKeys.profiles.byUsername(normalizedUsername)
      : ['profiles', 'username', 'missing'],
    queryFn: () => profileService.getProfileByUsername(normalizedUsername!, currentUserId),
    enabled: Boolean(normalizedUsername),
  });
}
