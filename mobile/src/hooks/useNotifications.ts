import { useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { notificationService, type NotificationCursor } from '@/services/notificationService';

export const notificationKeys = {
  user: (userId?: string) => ['notifications', userId ?? 'signed-out'] as const,
  count: (userId?: string) => [...notificationKeys.user(userId), 'count'] as const,
  list: (userId?: string) => [...notificationKeys.user(userId), 'list'] as const,
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
    refetchInterval: 20000,
    refetchIntervalInBackground: false,
    staleTime: 0,
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
    refetchInterval: 20000,
    refetchIntervalInBackground: false,
    staleTime: 0,
  });
}

export function useReadNotification(userId?: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (commentId: string) => {
      if (!userId) throw new Error('Sign in required');
      await notificationService.markRead(userId, commentId);
    },
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: notificationKeys.user(userId) });
    },
  });
}
