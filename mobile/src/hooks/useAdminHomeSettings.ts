import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query/queryKeys';
import { adminService } from '@/services';

const homeSettingsKey = (userId?: string) => ['admin', 'home-settings', userId] as const;

export function useAdminHomeSettings(userId?: string) {
  return useQuery({
    queryKey: homeSettingsKey(userId),
    queryFn: () => adminService.getHomeMinimumPickCount(),
    enabled: Boolean(userId),
    retry: false,
  });
}

export function useUpdateAdminHomeSettings(userId?: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (count: number) => adminService.setHomeMinimumPickCount(count),
    onSuccess: async (count) => {
      client.setQueryData(homeSettingsKey(userId), count);
      await client.invalidateQueries({ queryKey: queryKeys.home.all });
    },
  });
}
