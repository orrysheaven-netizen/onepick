import { useEffect, useRef } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { AppError } from '@/errors/appError';
import { useFollowActions, useFollowState } from '@/hooks/useFollow';
import { OnePick } from '@/constants/onepick';

function errorText(error: unknown) {
  if (error instanceof AppError) {
    if (error.code === 'FOLLOW_SELF') return '내 계정은 팔로우할 수 없어요.';
    if (error.code === 'FOLLOW_BLOCKED') return '차단 관계에서는 팔로우할 수 없어요.';
    if (error.code === 'PROFILE_NOT_FOUND') return '사용자 정보를 찾을 수 없어요.';
    if (error.code === 'AUTH_REQUIRED') return '로그인 후 팔로우할 수 있어요.';
  }
  return '잠시 후 다시 시도해주세요.';
}

/**
 * One-way follow toggle for another person's profile. No follower counts are
 * shown here on purpose; the profile owner sees their own counts elsewhere.
 */
export function FollowButton({
  viewerUserId,
  profileUserId,
  username,
  onRequireLogin,
  autoFollow = false,
  onFollowed,
}: {
  viewerUserId?: string;
  profileUserId: string;
  username: string;
  onRequireLogin?: () => void;
  autoFollow?: boolean;
  onFollowed?: () => void;
}) {
  const state = useFollowState(viewerUserId, profileUserId);
  const { follow, unfollow } = useFollowActions(viewerUserId, profileUserId);

  if (viewerUserId === profileUserId) return null;

  const following = state.data === true;
  const pending = follow.isPending || unfollow.isPending;
  const error = follow.error ?? unfollow.error;
  const autoAttempted = useRef(false);
  const followedNotified = useRef(false);

  useEffect(() => {
    autoAttempted.current = false;
    followedNotified.current = false;
  }, [autoFollow, profileUserId, viewerUserId]);

  useEffect(() => {
    if (!autoFollow || !viewerUserId || viewerUserId === profileUserId || state.isPending || pending || autoAttempted.current) return;
    if (state.data === true) {
      autoAttempted.current = true;
      if (!followedNotified.current) {
        followedNotified.current = true;
        onFollowed?.();
      }
      return;
    }
    if (state.data !== false) return;
    autoAttempted.current = true;
    follow.mutate(undefined, {
      onSuccess: () => {
        if (!followedNotified.current) {
          followedNotified.current = true;
          onFollowed?.();
        }
      },
    });
  }, [autoFollow, follow, onFollowed, pending, profileUserId, state.data, state.isPending, viewerUserId]);

  const handlePress = () => {
    if (!viewerUserId) {
      onRequireLogin?.();
      return;
    }
    if (pending) return;
    follow.reset();
    unfollow.reset();
    if (following) unfollow.mutate();
    else follow.mutate();
  };

  return (
    <View style={styles.container}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ selected: following, busy: pending }}
        accessibilityLabel={following ? `@${username} 팔로우 취소` : `@${username} 팔로우`}
        disabled={pending || (Boolean(viewerUserId) && state.isPending)}
        onPress={handlePress}
        style={({ pressed }) => [styles.button, following && styles.buttonFollowing, pressed && styles.pressed]}>
        {pending || (viewerUserId && state.isPending) ? (
          <ActivityIndicator size="small" color={following ? OnePick.muted : OnePick.onAccent} />
        ) : (
          <Text style={[styles.text, following && styles.textFollowing]}>{following ? '팔로잉' : '팔로우'}</Text>
        )}
      </Pressable>
      {error ? <Text accessibilityRole="alert" style={styles.error}>{errorText(error)}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { alignItems: 'flex-start' },
  button: { minHeight: 40, minWidth: 92, alignItems: 'center', justifyContent: 'center', borderRadius: 12, backgroundColor: OnePick.accent, paddingHorizontal: 16 },
  buttonFollowing: { backgroundColor: OnePick.surface, borderWidth: 1, borderColor: OnePick.border },
  text: { color: OnePick.onAccent, fontSize: 13, fontWeight: '800' },
  textFollowing: { color: OnePick.muted },
  error: { color: OnePick.danger, fontSize: 12, lineHeight: 16, marginTop: 6 },
  pressed: { opacity: 0.7 },
});
