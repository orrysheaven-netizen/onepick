import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { queryKeys } from '@/lib/query/queryKeys';
import { onboardingService, type OnboardingAction } from '@/services/onboardingService';

export function useOnboardingProgress(userId?: string) {
  return useQuery({
    queryKey: userId ? queryKeys.onboarding.progress(userId) : ['onboarding', 'anonymous'],
    queryFn: () => onboardingService.getProgress(userId!),
    enabled: Boolean(userId),
  });
}

export function useSetOnboardingCurrent(userId?: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (categoryId: string) => onboardingService.setCurrent(categoryId),
    onSuccess: () => userId && client.invalidateQueries({ queryKey: queryKeys.onboarding.progress(userId) }),
  });
}

export function useRecordOnboardingAction(userId?: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ categoryId, action }: { categoryId: string; action: OnboardingAction }) =>
      onboardingService.recordAction(categoryId, action),
    onSuccess: async () => {
      if (userId) await client.invalidateQueries({ queryKey: queryKeys.onboarding.progress(userId) });
      await client.invalidateQueries({ queryKey: queryKeys.profiles.all });
    },
  });
}

export function usePauseOnboarding(userId?: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => onboardingService.pause(),
    onSuccess: () => userId && client.invalidateQueries({ queryKey: queryKeys.onboarding.progress(userId) }),
  });
}

export function useCompleteOnboarding(userId?: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => onboardingService.complete(),
    onSuccess: async () => {
      if (userId) await client.invalidateQueries({ queryKey: queryKeys.onboarding.progress(userId) });
      await client.invalidateQueries({ queryKey: queryKeys.profiles.all });
    },
  });
}
