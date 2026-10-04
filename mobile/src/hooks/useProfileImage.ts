import { useMutation, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query/queryKeys';
import { profileImageService, type SavedProfileImage } from '@/services/profileImageService';

type ProfileCache = { profile?: { id: string; profileImageUrl: string | null } };

/** Change or remove my profile photo; every cached view of my profile updates together. */
export function useProfileImage(profileUserId: string, currentUrl: string | null) {
  const client = useQueryClient();
  const onSuccess = async (saved: SavedProfileImage | null) => {
    if (!saved) return;
    client.setQueriesData<ProfileCache>({ queryKey: queryKeys.profiles.all }, (previous) =>
      previous?.profile?.id === saved.userId
        ? { ...previous, profile: { ...previous.profile, profileImageUrl: saved.profileImageUrl } }
        : previous);
    await client.invalidateQueries();
  };
  const change = useMutation({ mutationFn: () => profileImageService.chooseAndSave(profileUserId, currentUrl), onSuccess });
  const clear = useMutation({ mutationFn: () => profileImageService.clear(profileUserId, currentUrl), onSuccess });
  return { change, clear, isPending: change.isPending || clear.isPending, error: change.error ?? clear.error };
}
