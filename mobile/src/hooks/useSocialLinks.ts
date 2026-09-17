import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { SocialLink, SocialPlatform } from '@/lib/socialLinks';
import { socialLinksService } from '@/services/socialLinksService';

export const socialLinksKey = (profileUserId: string, viewerId?: string) =>
  ['profile-social-links', viewerId ?? 'anonymous', profileUserId] as const;

export function useSocialLinks(profileUserId: string, viewerId?: string) {
  return useQuery({
    queryKey: socialLinksKey(profileUserId, viewerId),
    queryFn: () => socialLinksService.list(profileUserId),
    enabled: Boolean(profileUserId),
    staleTime: 0,
  });
}

type Change = { platform: SocialPlatform; input: string; remove?: false }
  | { platform: SocialPlatform; remove: true };

export function useChangeSocialLink(profileUserId: string, viewerId?: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (change: Change) => change.remove
      ? socialLinksService.remove(profileUserId, change.platform)
      : socialLinksService.save(profileUserId, change.platform, change.input),
    onSuccess: async (saved, change) => {
      queryClient.setQueryData<SocialLink[]>(socialLinksKey(profileUserId, viewerId), (previous) => [
        ...(previous ?? []).filter((link) => link.platform !== change.platform),
        ...(saved ? [saved] : []),
      ]);
      await queryClient.invalidateQueries({ queryKey: ['profile-social-links'] });
    },
  });
}
