import { useMutation } from '@tanstack/react-query';

import { authService, profileService } from '@/services';

export function useCompleteOAuth() {
  return useMutation({
    mutationFn: async (url: string) => {
      const user = await authService.completeOAuthFromUrl(url);

      if (!user) return null;

      const profile = await profileService.getById(user.id);
      return { user, profile };
    },
  });
}
