import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { queryKeys } from '@/lib/query/queryKeys';
import { profileAiReviewService } from '@/services';
import type { ProfileAiReview } from '@/types/domain/profileAiReview';

export function useProfileAiReview(profileId?: string, viewerId?: string) {
  return useQuery({
    queryKey: profileId
      ? queryKeys.profiles.aiReview(profileId, viewerId)
      : ['profiles', 'ai-review', 'missing'],
    queryFn: () => profileAiReviewService.get(profileId!),
    enabled: Boolean(profileId),
    staleTime: 0,
    // An open foreground profile also notices server-side automatic hiding.
    // This does not retract content a visitor has already viewed or copied.
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
  });
}

export function useGenerateProfileAiReview(profileId: string, pickCount: number, viewerId?: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => profileAiReviewService.generate(profileId, pickCount),
    onSuccess: (review) => {
      queryClient.setQueryData<ProfileAiReview | null>(
        queryKeys.profiles.aiReview(profileId, viewerId), review,
      );
    },
    // A rejected stale generation must refresh the old card too.
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['profiles', 'ai-review', profileId] }),
  });
}

export function useSetProfileAiReviewVisibility(profileId: string, viewerId?: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (isVisible: boolean) => profileAiReviewService.setVisibility(profileId, isVisible),
    onSuccess: (review) => {
      queryClient.setQueryData<ProfileAiReview | null>(
        queryKeys.profiles.aiReview(profileId, viewerId), review,
      );
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['profiles', 'ai-review', profileId] }),
  });
}
