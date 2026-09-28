import { StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/ui';
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
}: {
  viewerUserId?: string;
  profileUserId: string;
  username: string;
  onRequireLogin?: () => void;
}) {
  const state = useFollowState(viewerUserId, profileUserId);
  const { follow, unfollow } = useFollowActions(viewerUserId, profileUserId);

  if (viewerUserId === profileUserId) return null;

  const following = state.data === true;
  const pending = follow.isPending || unfollow.isPending;
  const loading = pending || Boolean(viewerUserId && state.isPending);
  const error = follow.error ?? unfollow.error;

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
      <Button
        accessibilityLabel={following ? `@${username} 팔로우 취소` : `@${username} 팔로우`}
        disabled={loading}
        label={following ? '팔로잉' : '팔로우'}
        loading={loading}
        onPress={handlePress}
        selected={following}
        size="sm"
        variant={following ? 'secondary' : 'primary'}
      />
      {error ? <Text accessibilityRole="alert" style={styles.error}>{errorText(error)}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { alignItems: 'flex-start' },
  error: { color: OnePick.danger, fontSize: 12, lineHeight: 16, marginTop: 6 },
});
