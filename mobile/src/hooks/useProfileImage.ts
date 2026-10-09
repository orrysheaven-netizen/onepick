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
    // Refresh domains that embed a profile; leave catalogs, settings, auth and
    // unrelated admin queries untouched.
    const profileDomains: readonly string[] = [
      queryKeys.profiles.all[0], queryKeys.home.all[0], queryKeys.explore.all[0],
      queryKeys.follows.all[0], queryKeys.comments.all[0], queryKeys.items.all[0],
      queryKeys.picks.all[0], queryKeys.providers.all[0],
    ];
    await client.invalidateQueries({
      predicate: ({ queryKey }) => profileDomains.includes(String(queryKey[0]))
        || (queryKey[0] === 'notifications' && queryKey[2] === 'list'),
    });
  };
  // Starting one action clears the other's failure notice, so a failed 바꾸기 does not
  // keep showing after a successful 삭제하기 (and the reverse). react-query only resets a
  // mutation's error on its own next run.
  const change = useMutation({
    mutationFn: () => profileImageService.chooseAndSave(profileUserId, currentUrl),
    onMutate: (): void => { clear.reset(); },
    onSuccess,
  });
  const clear = useMutation({
    mutationFn: () => profileImageService.clear(profileUserId, currentUrl),
    onMutate: (): void => { change.reset(); },
    onSuccess,
  });
  return { change, clear, isPending: change.isPending || clear.isPending, error: change.error ?? clear.error };
}
