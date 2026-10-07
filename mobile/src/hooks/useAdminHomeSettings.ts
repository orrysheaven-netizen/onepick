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


const dailyQuestionKey = (userId?: string) => ['admin', 'home-daily-question', userId] as const;

export function useAdminDailyQuestionSettings(userId?: string) {
  return useQuery({
    queryKey: dailyQuestionKey(userId),
    queryFn: () => adminService.getHomeDailyQuestionSettings(),
    enabled: Boolean(userId),
    retry: false,
  });
}

export function useUpdateAdminDailyQuestion(userId?: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (categoryId: string | null) => adminService.setHomeDailyQuestionCategoryId(categoryId),
    onSuccess: async (categoryId) => {
      client.setQueryData<Awaited<ReturnType<typeof adminService.getHomeDailyQuestionSettings>>>(dailyQuestionKey(userId),
        (previous) => previous ? { ...previous, categoryId } : previous);
      await Promise.all([
        client.invalidateQueries({ queryKey: dailyQuestionKey(userId) }),
        client.invalidateQueries({ queryKey: queryKeys.home.all }),
      ]);
    },
  });
}
