import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { AppError } from '@/errors/appError';
import { DIALOG_CLOSE_LABEL } from '@/components/ui/dialog-labels';
import { useSafetyActions } from '@/hooks/useSafety';
import { OnePick } from '@/constants/onepick';

function errorText(error: unknown) {
  if (error instanceof AppError) {
    if (error.code === 'BLOCK_SELF') return '내 계정은 차단할 수 없어요.';
    if (error.code === 'PROFILE_NOT_FOUND') return '사용자 정보를 찾을 수 없어요.';
  }
  return '차단하지 못했어요. 다시 시도해주세요.';
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
      {confirming ? <Text style={styles.confirm}>@{username}님을 차단할까요? 서로의 공개 콘텐츠가 보이지 않게 돼요.</Text> : null}
      {blockUser.isError ? <Text style={styles.error}>{errorText(blockUser.error)}</Text> : null}
      <View style={styles.row}>
        <Pressable
          accessibilityRole="button"
          disabled={blockUser.isPending}
          onPress={() => void handlePress()}
          style={({ pressed }) => [styles.button, confirming && styles.dangerButton, pressed && styles.pressed]}>
          {blockUser.isPending ? (
            <ActivityIndicator size="small" color={confirming ? OnePick.surface : undefined} />
          ) : (
            <Text style={[styles.buttonText, confirming && styles.dangerText]}>차단하기</Text>
          )}
        </Pressable>
        {confirming && !blockUser.isPending ? (
          <Pressable onPress={() => setConfirming(false)} style={({ pressed }) => [styles.cancelButton, pressed && styles.pressed]}>
            <Text style={styles.cancelText}>{DIALOG_CLOSE_LABEL}</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { alignSelf: 'stretch' },
  confirm: { color: OnePick.danger, fontSize: 12, lineHeight: 17, marginBottom: 8 },
  error: { color: OnePick.danger, fontSize: 12, lineHeight: 16, marginBottom: 8 },
  row: { flexDirection: 'row', gap: 8 },
  button: { minHeight: 44, minWidth: 60, alignItems: 'center', justifyContent: 'center', borderRadius: 12, borderWidth: 1, borderColor: OnePick.border, paddingHorizontal: 12 },
  dangerButton: { backgroundColor: OnePick.danger, borderColor: OnePick.danger },
  buttonText: { color: OnePick.muted, fontSize: 12, fontWeight: '800' },
  dangerText: { color: OnePick.onAccent },
  cancelButton: { minHeight: 44, justifyContent: 'center', borderRadius: 12, paddingHorizontal: 12 },
  cancelText: { color: OnePick.muted, fontSize: 12, fontWeight: '700' },
  pressed: { opacity: 0.65 },
});
