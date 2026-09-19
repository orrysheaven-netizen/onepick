import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import type { ProfileAiReviewVersion } from '@/lib/profileAiPublication';
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
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['profiles', 'ai-review', profileId] }),
  });
}

type VisibilityChange =
  | { isVisible: false; expectedReview?: ProfileAiReviewVersion }
  | { isVisible: true; expectedReview: ProfileAiReviewVersion };

export function useSetProfileAiReviewVisibility(profileId: string, viewerId?: string) {
  const queryClient = useQueryClient();
  return useMutation({
    // Variables are captured by the click, not replaced with a newer query result.
    mutationFn: ({ isVisible, expectedReview }: VisibilityChange) =>
      profileAiReviewService.setVisibility(profileId, isVisible, expectedReview),
    retry: false,
    onSuccess: (review) => {
      queryClient.setQueryData<ProfileAiReview | null>(
        queryKeys.profiles.aiReview(profileId, viewerId), review,
      );
    },
    // Refresh on a version conflict, but never automatically publish the new text.
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['profiles', 'ai-review', profileId] }),
  });
}
