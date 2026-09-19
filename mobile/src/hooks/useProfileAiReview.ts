import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ProfileAiReviewVersion } from '@/lib/profileAiPublication';
import type { ProfileAiTone } from '@/lib/profileAiTone';
import { queryKeys } from '@/lib/query/queryKeys';
import { profileAiReviewService } from '@/services';
import type { ProfileAiReview } from '@/types/domain/profileAiReview';

export function useProfileAiReview(profileId?: string, viewerId?: string) {
  return useQuery({
    queryKey: profileId ? queryKeys.profiles.aiReview(profileId, viewerId) : ['profiles', 'ai-review', 'missing'],
    queryFn: () => profileAiReviewService.get(profileId!), enabled: Boolean(profileId),
    staleTime: 0, refetchInterval: 30_000, refetchIntervalInBackground: false,
  });
}

type GenerationRequest = { count: number; tone: ProfileAiTone };
export function useGenerateProfileAiReview(profileId: string, viewerId?: string) {
  const queryClient = useQueryClient();
  return useMutation({
    // The two-button UI always passes a captured tone. The numeric form preserves
    // compatibility with earlier internal callers and uses the service default.
    mutationFn: (request: GenerationRequest | number) => typeof request === 'number'
      ? profileAiReviewService.generate(profileId, request)
      : profileAiReviewService.generate(profileId, request.count, request.tone),
    retry: false,
    onSuccess: (review) => {
      queryClient.setQueryData<ProfileAiReview | null>(queryKeys.profiles.aiReview(profileId, viewerId), review);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['profiles', 'ai-review', profileId] }),
  });
}

type VisibilityChange =
  | { isVisible: false; expectedReview?: ProfileAiReviewVersion }
  | { isVisible: true; expectedReview: ProfileAiReviewVersion };

export function useSetProfileAiReviewVisibility(profileId: string, _viewerId?: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ isVisible, expectedReview }: VisibilityChange) =>
      profileAiReviewService.setVisibility(profileId, isVisible, expectedReview),
    retry: false,
    onSettled: () => {
      try {
        void queryClient.invalidateQueries({ queryKey: ['profiles', 'ai-review', profileId] }).catch(() => {});
      } catch { /* Display errors cannot reverse acknowledged visibility writes. */ }
    },
  });
}
