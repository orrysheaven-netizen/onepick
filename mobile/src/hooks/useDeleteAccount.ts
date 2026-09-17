import { useMutation, useQueryClient } from '@tanstack/react-query';

import { authService } from '@/services';

export function useDeleteAccount() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => authService.deleteAccount(),
    onSuccess: async () => {
      await queryClient.cancelQueries();
      queryClient.clear();
    },
  });
}
