import { useMutation, useQueryClient } from '@tanstack/react-query';

import { clearPickDraft } from '@/lib/pick/pickDraft';
import { authService } from '@/services';

export function useSignOut() {
  const queryClient = useQueryClient();

  return useMutation({
    // Explicit sign-out discards the in-progress Pick draft; an expired session does not
    // pass through here, so the same account can still resume after re-login (#475).
    mutationFn: async () => {
      await authService.signOut();
      clearPickDraft();
    },
    onSuccess: async () => {
      await queryClient.cancelQueries();
      queryClient.clear();
    },
  });
}
