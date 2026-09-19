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
    staleTime: 60_000,
  });
}

export function useGenerateProfileAiReview(profileId: string, pickCount: number, viewerId?: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => profileAiReviewService.generate(profileId, pickCount),
    onSuccess: async (review) => {
      queryClient.setQueryData<ProfileAiReview | null>(
        queryKeys.profiles.aiReview(profileId, viewerId),
        review,
      );
      await queryClient.invalidateQueries({ queryKey: ['profiles', 'ai-review', profileId] });
    },
  });
}

export function useSetProfileAiReviewVisibility(profileId: string, viewerId?: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (isVisible: boolean) => profileAiReviewService.setVisibility(profileId, isVisible),
    onSuccess: async (review) => {
      queryClient.setQueryData<ProfileAiReview | null>(
        queryKeys.profiles.aiReview(profileId, viewerId),
        review,
      );
      await queryClient.invalidateQueries({ queryKey: ['profiles', 'ai-review', profileId] });
    },
  });
}
