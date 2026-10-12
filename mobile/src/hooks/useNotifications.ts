import { useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { collectReplyBanner } from '@/lib/home/earlyHome';
import { notificationService, type NotificationCursor } from '@/services/notificationService';

export const notificationKeys = {
  user: (userId?: string) => ['notifications', userId ?? 'signed-out'] as const,
  count: (userId?: string) => [...notificationKeys.user(userId), 'count'] as const,
  list: (userId?: string) => [...notificationKeys.user(userId), 'list'] as const,
  homeReplies: (userId?: string) => [...notificationKeys.user(userId), 'home-replies'] as const,
  preferences: (userId?: string) => [...notificationKeys.user(userId), 'preferences'] as const,
};

function useAppActive() {
  const [active, setActive] = useState(AppState.currentState !== 'background' && AppState.currentState !== 'inactive');
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => setActive(state === 'active'));
    return () => subscription.remove();
  }, []);
  return active;
}

export function useNotificationCount(userId?: string, enabled = true) {
  const active = useAppActive();
  return useQuery({
    queryKey: notificationKeys.count(userId),
    enabled: Boolean(userId) && enabled && active,
    queryFn: () => notificationService.unreadCount(userId!),
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
    staleTime: 20_000,
    retry: 1,
  });
}

export function useNotifications(userId?: string, enabled = true) {
  const active = useAppActive();
  return useInfiniteQuery({
    queryKey: notificationKeys.list(userId),
    enabled: Boolean(userId) && enabled && active,
    initialPageParam: null as NotificationCursor | null,
    queryFn: ({ pageParam }) => notificationService.page(userId!, pageParam),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    refetchIntervalInBackground: false,
    staleTime: 30_000,
    retry: 1,
  });
}

/**
 * Home's "내 원픽에 새 답글" banner: a complete unread-reply count read on its own (see
 * collectReplyBanner), so it never depends on the inbox tab's loaded pages. Lives under the
 * user's notification key, so marking a group read refreshes it like the inbox.
 */
export function useHomeReplyBanner(userId?: string, enabled = true) {
  const active = useAppActive();
  return useQuery({
    queryKey: notificationKeys.homeReplies(userId),
    enabled: Boolean(userId) && enabled && active,
    queryFn: () => collectReplyBanner<NotificationCursor>({
      unreadCount: () => notificationService.unreadCount(userId!),
      page: (cursor) => notificationService.page(userId!, cursor),
    }),
    staleTime: 30_000,
    retry: 1,
  });
}

export function useReadNotificationGroup(userId?: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async ({ groupId, snapshot }: { groupId: string; snapshot: string }) => {
      if (!userId) throw new Error('Sign in required');
      await notificationService.markGroupRead(userId, groupId, snapshot);
    },
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: notificationKeys.user(userId) });
    },
  });
}

export function useNotificationPreferences(userId?: string) {
  return useQuery({
    queryKey: notificationKeys.preferences(userId),
    enabled: Boolean(userId),
    queryFn: () => notificationService.preferences(userId!),
    retry: false,
  });
}

export function useSetFolloweePickChange(userId?: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (enabled: boolean) => {
      if (!userId) throw new Error('Sign in required');
      await notificationService.setFolloweePickChange(userId, enabled);
    },
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: notificationKeys.preferences(userId) });
    },
  });
}

