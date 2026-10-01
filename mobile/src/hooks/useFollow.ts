import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { queryKeys } from '@/lib/query/queryKeys';
import type { PickChannel, ReadCursor } from '@/repositories/interfaces/readRepository';
import type { FollowConnectionCursor, FollowConnectionDirection } from '@/types/domain/safety';
import { followService } from '@/services/followServiceInstance';

export function useFollowState(userId: string | undefined, profileId: string | undefined) {
  const enabled = Boolean(userId && profileId && userId !== profileId);
  return useQuery({
    queryKey: userId && profileId ? queryKeys.follows.state(userId, profileId) : ['follows', 'state', 'missing'],
    queryFn: () => followService.isFollowing(userId!, profileId!),
    enabled,
    retry: false,
  });
}

export function useFollowCounts(userId: string | undefined) {
  return useQuery({
    queryKey: userId ? queryKeys.follows.counts(userId) : ['follows', 'counts', 'missing'],
    queryFn: () => followService.getCounts(userId!),
    enabled: Boolean(userId),
    retry: false,
  });
}

export function useProfileFollowCounts(profileId: string | undefined) {
  return useQuery({
    queryKey: profileId ? queryKeys.follows.publicCounts(profileId) : ['follows', 'public-counts', 'missing'],
    queryFn: () => followService.getPublicCounts(profileId!),
    enabled: Boolean(profileId),
    retry: false,
  });
}

export function useFollowConnections(
  profileId: string | undefined,
  direction: FollowConnectionDirection,
  enabled = true,
) {
  return useInfiniteQuery({
    enabled: enabled && Boolean(profileId),
    queryKey: profileId
      ? queryKeys.follows.connections(profileId, direction)
      : ['follows', 'connections', 'missing', direction],
    initialPageParam: null as FollowConnectionCursor | null,
    queryFn: ({ pageParam }) => followService.getConnections(profileId!, direction, pageParam),
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    select: (data) => ({
      items: data.pages.flatMap((page) => page.items),
    }),
  });
}

export function useFollowActions(userId: string | undefined, profileId: string) {
  const client = useQueryClient();
  const stateKey = userId ? queryKeys.follows.state(userId, profileId) : null;

  // Optimistic toggle: the button flips at once and rolls back if the server refuses.
  const run = (next: boolean) => ({
    mutationFn: () => (next ? followService.follow(userId!, profileId) : followService.unfollow(userId!, profileId)),
    onMutate: async () => {
      if (!stateKey) return { previous: undefined as boolean | undefined };
      await client.cancelQueries({ queryKey: stateKey });
      const previous = client.getQueryData<boolean>(stateKey);
      client.setQueryData(stateKey, next);
      return { previous };
    },
    onError: (_error: unknown, _vars: void, context?: { previous: boolean | undefined }) => {
      if (stateKey && context) client.setQueryData(stateKey, context.previous);
    },
    onSettled: async () => {
      if (!userId) return;
      await Promise.all([
        client.invalidateQueries({ queryKey: queryKeys.follows.all }),
      ]);
    },
  });

  const follow = useMutation(run(true));
  const unfollow = useMutation(run(false));
  return { follow, unfollow };
}

export function useFollowingFeed(
  userId: string | undefined,
  enabled = true,
  channel: PickChannel | null = null,
  rootSlug: string | null = null,
) {
  return useInfiniteQuery({
    enabled: enabled && Boolean(userId),
    queryKey: userId ? queryKeys.follows.feed(userId, channel, rootSlug) : ['follows', 'feed', 'missing'],
    initialPageParam: null as ReadCursor | null,
    queryFn: ({ pageParam }) => followService.getFollowingFeed(userId!, pageParam, channel, rootSlug),
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    select: (data) => ({
      items: data.pages.flatMap((page) => page.items),
    }),
  });
}
