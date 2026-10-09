import { useMutation, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query/queryKeys';
import { profileNicknameService } from '@/services/profileNicknameService';

type ProfileCache = { profile?: { id: string; nickname: string | null } };

export function useUpdateProfileNickname(profileUserId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: string) => profileNicknameService.update(profileUserId, input),
    onSuccess: async (saved) => {
      // Never change another account's cached profile or its stable username.
      client.setQueriesData<ProfileCache>({ queryKey: queryKeys.profiles.all }, (previous) =>
        previous?.profile?.id === saved.userId
          ? { ...previous, profile: { ...previous.profile, nickname: saved.nickname } }
          : previous);
      await client.invalidateQueries({ queryKey: queryKeys.profiles.all });
    },
  });
}
