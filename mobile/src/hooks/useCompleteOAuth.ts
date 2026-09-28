import { useMutation } from '@tanstack/react-query';

import { authService, profileService } from '@/services';

export function useCompleteOAuth() {
  return useMutation({
    mutationFn: async (url: string) => {
      const user = await authService.completeOAuthFromUrl(url);

      if (!user) return null;

      // The sign-in already succeeded; a failed profile lookup must not show "login failed"
      // (the code is spent, so retrying the callback cannot recover). One retry, then report
      // the profile as unknown (undefined) rather than missing (null).
      const profile = await profileService.getById(user.id)
        .catch(() => profileService.getById(user.id))
        .catch(() => undefined);
      return { user, profile };
    },
  });
}
