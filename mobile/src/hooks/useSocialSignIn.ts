import { useMutation } from '@tanstack/react-query';

import { authService, profileService } from '@/services';
import type { SocialAuthProvider } from '@/types/domain/auth';

type SocialSignInInput = {
  provider: SocialAuthProvider;
  redirectTo: string;
};

export function useSocialSignIn() {
  return useMutation({
    mutationFn: async ({ provider, redirectTo }: SocialSignInInput) => {
      const user = await authService.signInWithProvider(provider, redirectTo);

      if (!user) return null;

      const profile = await profileService.getById(user.id);
      return { user, profile };
    },
  });
}
