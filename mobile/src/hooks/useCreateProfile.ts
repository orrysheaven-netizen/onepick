import { useMutation, useQueryClient } from '@tanstack/react-query';

import { queryKeys } from '@/lib/query/queryKeys';
import { profileService } from '@/services';

export function useCreateProfile(expectedUserId?: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (username: string) => profileService.createProfile(username, expectedUserId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.profiles.all });
    },
  });
}
