import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { AppError } from '@/errors/appError';
import { useSafetyActions } from '@/hooks/useSafety';

function errorText(error: unknown) {
  if (error instanceof AppError) {
    if (error.code === 'BLOCK_SELF') return '내 계정은 차단할 수 없습니다.';
    if (error.code === 'PROFILE_NOT_FOUND') return '사용자 정보를 찾을 수 없습니다.';
  }
  return '차단하지 못했습니다. 다시 시도해주세요.';
}

export function BlockUserButton({
  blockerUserId,
  blockedUserId,
  username,
  onBlocked,
}: {
  blockerUserId?: string;
  blockedUserId: string;
  username: string;
  onBlocked?: () => void;
}) {
  const { blockUser } = useSafetyActions();
  const [confirming, setConfirming] = useState(false);

  if (!blockerUserId || blockerUserId === blockedUserId) return null;

  const handlePress = async () => {
    if (!confirming) {
      setConfirming(true);
      blockUser.reset();
      return;
    }

    try {
      await blockUser.mutateAsync({ blockerUserId, blockedUserId });
      onBlocked?.();
    } catch {
      // Mutation state renders the failure and keeps confirmation available.
    }
  };

  return (
    <View style={styles.container}>
      {confirming ? <Text style={styles.confirm}>@{username}님을 차단할까요? 서로의 공개 콘텐츠가 보이지 않게 됩니다.</Text> : null}
      {blockUser.isError ? <Text style={styles.error}>{errorText(blockUser.error)}</Text> : null}
      <View style={styles.row}>
        <Pressable
          accessibilityRole="button"
          disabled={blockUser.isPending}
          onPress={() => void handlePress()}
          style={({ pressed }) => [styles.button, confirming && styles.dangerButton, pressed && styles.pressed]}>
          {blockUser.isPending ? (
            <ActivityIndicator size="small" color={confirming ? '#FFFFFF' : undefined} />
          ) : (
            <Text style={[styles.buttonText, confirming && styles.dangerText]}>{confirming ? '차단 확인' : '차단'}</Text>
          )}
        </Pressable>
        {confirming && !blockUser.isPending ? (
          <Pressable onPress={() => setConfirming(false)} style={({ pressed }) => [styles.cancelButton, pressed && styles.pressed]}>
            <Text style={styles.cancelText}>취소</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { alignSelf: 'stretch' },
  confirm: { color: '#7A4B3F', fontSize: 11, lineHeight: 17, marginBottom: 8 },
  error: { color: '#A9482D', fontSize: 10, lineHeight: 16, marginBottom: 8 },
  row: { flexDirection: 'row', gap: 8 },
  button: { minHeight: 40, minWidth: 60, alignItems: 'center', justifyContent: 'center', borderRadius: 12, borderWidth: 1, borderColor: '#DDD5CD', paddingHorizontal: 12 },
  dangerButton: { backgroundColor: '#A9482D', borderColor: '#A9482D' },
  buttonText: { color: '#7D756E', fontSize: 11, fontWeight: '800' },
  dangerText: { color: '#FFFFFF' },
  cancelButton: { minHeight: 40, justifyContent: 'center', borderRadius: 12, paddingHorizontal: 12 },
  cancelText: { color: '#7D756E', fontSize: 11, fontWeight: '700' },
  pressed: { opacity: 0.65 },
});
