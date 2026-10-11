import { useMutation, useQueryClient } from '@tanstack/react-query';

import { removeProfileAvatar, saveProfileAvatar, type ProfileAvatarDraft } from '@/lib/profile/profileAvatarUpload';
import { queryKeys } from '@/lib/query/queryKeys';

type ProfileCache = { profile?: { id: string; profileImageUrl: string | null } };

function useAfterSave(userId: string) {
  const client = useQueryClient();
  return (path: string | null) => {
    // Patch every cached copy of this account's profile, then refresh in the background.
    client.setQueriesData<ProfileCache>({ queryKey: queryKeys.profiles.all }, (previous) =>
      previous?.profile?.id === userId ? { ...previous, profile: { ...previous.profile, profileImageUrl: path } } : previous);
    void client.invalidateQueries({ queryKey: queryKeys.profiles.all });
    // Home rows carry the author's photo path too (only active queries refetch).
    void client.invalidateQueries({ queryKey: queryKeys.home.all });
  };
}

export function useSaveProfileAvatar(userId: string) {
  const afterSave = useAfterSave(userId);
  return useMutation({
    mutationFn: ({ draft, previousPath }: { draft: ProfileAvatarDraft; previousPath: string | null }) =>
      saveProfileAvatar(userId, draft, previousPath),
    onSuccess: (path) => afterSave(path),
  });
}

export function useRemoveProfileAvatar(userId: string) {
  const afterSave = useAfterSave(userId);
  return useMutation({
    mutationFn: (previousPath: string | null) => removeProfileAvatar(userId, previousPath),
    onSuccess: () => afterSave(null),
  });
}
