import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { profileAiService } from '@/services/profileAiService';

const statusKey = (userId: string) => ['profile-ai', 'status', userId] as const;
const commentKey = (profileId: string) => ['profile-ai', 'comment', profileId] as const;

export function useProfileAiStatus(userId?: string) {
  return useQuery({
    queryKey: userId ? statusKey(userId) : ['profile-ai', 'status', 'anonymous'],
    queryFn: () => profileAiService.getStatus(),
    enabled: Boolean(userId),
  });
}

export function useProfileAiComment(profileId?: string) {
  return useQuery({
    queryKey: profileId ? commentKey(profileId) : ['profile-ai', 'comment', 'missing'],
    queryFn: () => profileAiService.getComment(profileId!),
    enabled: Boolean(profileId),
  });
}

export function useGenerateProfileAi(userId?: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => profileAiService.generate(),
    onSuccess: async () => {
      if (!userId) return;
      await Promise.all([
        client.invalidateQueries({ queryKey: statusKey(userId) }),
        client.invalidateQueries({ queryKey: commentKey(userId) }),
      ]);
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
      if (!profileId) return;
      await Promise.all([
        client.invalidateQueries({ queryKey: statusKey(profileId) }),
        client.invalidateQueries({ queryKey: commentKey(profileId) }),
      ]);
    },
  });
}
