import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { queryKeys } from '@/lib/query/queryKeys';
import { profileAiService } from '@/services/profileAiService';

export function useProfileAiStatus(userId?: string) {
  return useQuery({
    queryKey: userId ? queryKeys.profileAi.status(userId) : ['profile-ai', 'status', 'anonymous'],
    queryFn: () => profileAiService.getStatus(),
    enabled: Boolean(userId),
  });
}

export function useProfileAiComment(profileId?: string) {
  return useQuery({
    queryKey: profileId ? queryKeys.profileAi.comment(profileId) : ['profile-ai', 'comment', 'missing'],
    queryFn: () => profileAiService.getComment(profileId!),
    enabled: Boolean(profileId),
  });
}

export function useGenerateProfileAi(userId?: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => profileAiService.generate(),
    onSuccess: async () => {
      if (userId) {
        await Promise.all([
          client.invalidateQueries({ queryKey: queryKeys.profileAi.status(userId) }),
          client.invalidateQueries({ queryKey: queryKeys.profileAi.comment(userId) }),
        ]);
      }
    },
  });
}

export function useSetProfileAiVisibility(profileId?: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (isVisible: boolean) => {
      if (!profileId) throw new Error('PROFILE_REQUIRED');
      return profileAiService.setVisible(profileId, isVisible);
    },
    onSuccess: async () => {
      if (profileId) {
        await Promise.all([
          client.invalidateQueries({ queryKey: queryKeys.profileAi.status(profileId) }),
          client.invalidateQueries({ queryKey: queryKeys.profileAi.comment(profileId) }),
        ]);
      }
    },
  });
}
