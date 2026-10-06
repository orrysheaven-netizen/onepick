import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { AppError } from '@/errors/appError';
import { DIALOG_CLOSE_LABEL } from '@/components/ui/dialog-labels';
import { useFollowActions, useFollowState } from '@/hooks/useFollow';
import { OnePick, OnePickType } from '@/constants/onepick';

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
  fullWidth = false,
  initialFollowing,
}: {
  viewerUserId?: string;
  profileUserId: string;
  username: string;
  onRequireLogin?: () => void;
  autoFollow?: boolean;
  onFollowed?: () => void;
  fullWidth?: boolean;
  initialFollowing?: boolean;
}) {
  const state = useFollowState(viewerUserId, profileUserId, initialFollowing);
  const { follow, unfollow } = useFollowActions(viewerUserId, profileUserId);
  const isSelf = viewerUserId === profileUserId;

  const following = state.data === true;
  const pending = follow.isPending || unfollow.isPending;
  const error = follow.error ?? unfollow.error;
  const [confirmingUnfollow, setConfirmingUnfollow] = useState(false);
  const autoAttempted = useRef(false);
  const followedNotified = useRef(false);

  useEffect(() => {
    autoAttempted.current = false;
    followedNotified.current = false;
    setConfirmingUnfollow(false);
  }, [autoFollow, profileUserId, viewerUserId]);

  useEffect(() => {
    if (!following) setConfirmingUnfollow(false);
  }, [following]);

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

  // Keep every hook unconditional even when this row belongs to the viewer.
  if (isSelf) return null;

  const handlePress = () => {
    if (!viewerUserId) {
      onRequireLogin?.();
      return;
    }
    if (pending) return;
    follow.reset();
    unfollow.reset();
    if (following) {
      setConfirmingUnfollow(true);
      return;
    }
    follow.mutate();
  };

  const confirmUnfollow = () => {
    if (pending || !viewerUserId || !following) return;
    follow.reset();
    unfollow.reset();
    unfollow.mutate(undefined, {
      onSuccess: () => setConfirmingUnfollow(false),
    });
  };

  return (
    <View style={[styles.container, fullWidth && styles.containerFullWidth]}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ selected: following, busy: pending }}
        accessibilityLabel={following ? `@${username} 팔로잉, 팔로우 취소 옵션 열기` : `@${username} 팔로우`}
        disabled={pending || (Boolean(viewerUserId) && state.isPending)}
        onPress={handlePress}
        style={({ pressed }) => [styles.button, fullWidth && styles.buttonFullWidth, following && styles.buttonFollowing, pressed && styles.pressed]}>
        {pending || (viewerUserId && state.isPending) ? (
          <ActivityIndicator size="small" color={following ? OnePick.muted : OnePick.onAccent} />
        ) : (
          <Text style={[styles.text, fullWidth && styles.textFullWidth, following && styles.textFollowing]}>{following ? '팔로잉' : '팔로우'}</Text>
        )}
      </Pressable>
      {confirmingUnfollow && following ? (
        <View accessibilityRole="menu" style={[styles.confirmRow, fullWidth && styles.confirmRowFullWidth]}>
          <Pressable
            accessibilityRole="menuitem"
            accessibilityLabel={`@${username} 팔로우 취소 확인`}
            disabled={pending}
            onPress={confirmUnfollow}
            style={({ pressed }) => [styles.confirmAction, pressed && styles.pressed]}>
            <Text style={styles.confirmText}>팔로우 취소</Text>
          </Pressable>
          <Pressable
            accessibilityRole="menuitem"
            accessibilityLabel="팔로우 취소 확인 닫기"
            disabled={pending}
            onPress={() => setConfirmingUnfollow(false)}
            style={({ pressed }) => [styles.cancelAction, pressed && styles.pressed]}>
            <Text style={styles.cancelText}>{DIALOG_CLOSE_LABEL}</Text>
          </Pressable>
        </View>
      ) : null}
      {error ? <Text accessibilityRole="alert" style={styles.error}>{errorText(error)}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { alignItems: 'flex-start' },
  containerFullWidth: { alignSelf: 'stretch', width: '100%' },
  button: { minHeight: 44, minWidth: 92, alignItems: 'center', justifyContent: 'center', borderRadius: 12, backgroundColor: OnePick.accent, paddingHorizontal: 16 },
  buttonFullWidth: { width: '100%', height: 52, minHeight: 52, backgroundColor: OnePick.actionPrimary },
  buttonFollowing: { backgroundColor: OnePick.surface, borderWidth: 1, borderColor: OnePick.border },
  text: { color: OnePick.onAccent, fontSize: 13, fontWeight: '700' },
  textFullWidth: { ...OnePickType.bodyMedium },
  textFollowing: { color: OnePick.muted },
  confirmRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6 },
  confirmRowFullWidth: { alignSelf: 'stretch', justifyContent: 'flex-end' },
  confirmAction: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 12, borderRadius: 10, borderWidth: 1, borderColor: OnePick.danger },
  confirmText: { color: OnePick.danger, fontSize: 12, fontWeight: '700' },
  cancelAction: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 12, borderRadius: 10 },
  cancelText: { color: OnePick.muted, fontSize: 12, fontWeight: '700' },
  error: { color: OnePick.danger, fontSize: 12, lineHeight: 16, marginTop: 6 },
  pressed: { opacity: 0.7 },
});
