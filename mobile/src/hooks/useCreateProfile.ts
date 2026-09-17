import { useMutation, useQueryClient } from '@tanstack/react-query';

import { queryKeys } from '@/lib/query/queryKeys';
import { profileService } from '@/services';

export function useCreateProfile() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (username: string) => profileService.createProfile(username),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.profiles.all });
    },
  });
}
