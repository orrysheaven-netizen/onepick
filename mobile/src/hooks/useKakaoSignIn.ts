import { useMutation } from '@tanstack/react-query';

import { authService, profileService } from '@/services';

export function useKakaoSignIn() {
  return useMutation({
    mutationFn: async (redirectTo: string) => {
      const user = await authService.signInWithKakao(redirectTo);

      if (!user) return null;

      const profile = await profileService.getById(user.id);
      return { user, profile };
    },
  });
}
