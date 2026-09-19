import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ProfileAiReviewVersion } from '@/lib/profileAiPublication';
import type { ProfileAiTone } from '@/lib/profileAiTone';
import { queryKeys } from '@/lib/query/queryKeys';
import { profileAiReviewService } from '@/services';
import type { ProfileAiReview } from '@/types/domain/profileAiReview';

export function useProfileAiReview(profileId?: string, viewerId?: string, active = true) {
  return useQuery({
    queryKey: profileId ? queryKeys.profiles.aiReview(profileId, viewerId) : ['profiles', 'ai-review', 'missing'],
    queryFn: () => profileAiReviewService.get(profileId!),
    enabled: Boolean(profileId) && active,
    // Visibility/stale changes matter while the profile is on screen, so keep
    // this lightweight poll. Route focus and native AppState stop it off-screen.
    staleTime: 30_000,
    refetchInterval: active ? 30_000 : false,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: false,
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
    onSettled: () => {
      // The generation response is already the canonical full comment. Mark
      // other viewer caches stale without waiting for or starting another read.
      try {
        void queryClient.invalidateQueries({
          queryKey: ['profiles', 'ai-review', profileId],
          refetchType: 'none',
        }).catch(() => {});
      } catch { /* Cache invalidation must not delay a confirmed generation. */ }
    },
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
