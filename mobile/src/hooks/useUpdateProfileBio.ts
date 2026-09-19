import { useMutation, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query/queryKeys';
import { profileBioService } from '@/services/profileBioService';

type ProfileCache = { profile?: { id: string; bio: string | null } };

export function useUpdateProfileBio(profileUserId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: string) => profileBioService.update(profileUserId, input),
    onSuccess: async (saved) => {
      // Patch only this profile and preserve Picks, pagination and other users.
      // Both my profile and already-cached public profile views update together.
      client.setQueriesData<ProfileCache>({ queryKey: queryKeys.profiles.all }, (previous) =>
        previous?.profile?.id === saved.userId
          ? { ...previous, profile: { ...previous.profile, bio: saved.bio } }
          : previous);
      await client.invalidateQueries({ queryKey: queryKeys.profiles.all });
    },
  });
}
