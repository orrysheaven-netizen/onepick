import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { Button } from '@/components/ui';
import { AppError } from '@/errors/appError';
import { useManagePick } from '@/hooks/useManagePick';
import type { Pick } from '@/types/domain/pick';
import { OnePick } from '@/constants/onepick';

function getErrorMessage(error: unknown) {
  if (error instanceof AppError) {
    if (error.code === 'REVIEW_INVALID') return '한줄평을 1~100자로 입력해주세요.';
    if (error.code === 'AUTH_REQUIRED') return '다시 로그인한 뒤 시도해주세요.';
    if (error.code === 'FORBIDDEN') return '내 원픽만 관리할 수 있어요.';
    if (error.code === 'PICK_NOT_FOUND' || error.code === 'PICK_CONFLICT') {
      return '원픽 상태가 바뀌었어요. 홈에서 현재 원픽을 다시 확인해주세요.';
    }
  }
  return '변경하지 못했어요. 연결 상태를 확인하고 다시 시도해주세요.';
}

export type PickManagementMode = 'idle' | 'edit' | 'remove' | 'delete';

/** The two small corner actions on my review card that open the edit/remove panel. */
export function PickManagementActions({ onOpen }: { onOpen: (mode: 'edit' | 'remove' | 'delete') => void }) {
  return <View style={styles.actions}>
    <Pressable accessibilityRole="button" accessibilityLabel="한줄평 수정" onPress={() => onOpen('edit')} style={styles.actionLink}>
      <Text style={styles.actionText}>수정</Text>
    </Pressable>
    <Text style={styles.actionDot}>·</Text>
    <Pressable accessibilityRole="button" accessibilityLabel="원픽 선택 해제" onPress={() => onOpen('remove')} style={styles.actionLink}>
      <Text style={styles.actionText}>원픽 해제</Text>
    </Pressable>
    <Text style={styles.actionDot}>·</Text>
    <Pressable accessibilityRole="button" accessibilityLabel="한줄평 삭제" onPress={() => onOpen('delete')} style={styles.actionLink}>
      <Text style={styles.actionText}>한줄평 삭제</Text>
    </Pressable>
  </View>;
}

/** Edit / remove panel for my Pick. The review card owns `mode`; idle renders only the saved notice. */
export function PickManagement({ pick, categoryName, onRemoved, mode, onModeChange }: {
  pick: Pick;
  categoryName: string;
  onRemoved: () => void;
  mode: PickManagementMode;
  onModeChange: (mode: PickManagementMode) => void;
}) {
  const { updateReview, removePick, deleteReview: deleteReviewMutation } = useManagePick();
  // Some isolated component tests still provide the pre-contract hook shape.
  const deleteReview = deleteReviewMutation ?? {
    isPending: false, error: null, reset() {}, mutateAsync: async () => undefined,
  };
  const setMode = onModeChange;
  const [review, setReview] = useState(pick.oneLineReview);
  const [saved, setSaved] = useState(false);
  const submitting = useRef(false);
  const isBusy = updateReview.isPending || removePick.isPending || deleteReview.isPending;
  const trimmedReview = review.trim();
  const canSave = trimmedReview.length >= 1 && trimmedReview.length <= 100;
  const error = mode === 'edit' ? updateReview.error : mode === 'remove' ? removePick.error : mode === 'delete' ? deleteReview.error : null;

  // Each time the card opens a panel (mode change only), start from the saved review with no stale errors.
  useEffect(() => {
    if (mode === 'idle' || submitting.current) return;
    updateReview.reset();
    removePick.reset();
    deleteReview.reset();
    setSaved(false);
    setReview(pick.oneLineReview);
  }, [mode]);

  const saveReview = async () => {
    if (!canSave || submitting.current) return;
    submitting.current = true;
    try {
      await updateReview.mutateAsync({ pickId: pick.id, oneLineReview: trimmedReview });
      setMode('idle');
      setSaved(true);
    } catch {
      // Keep the draft so the user can retry.
    } finally {
      submitting.current = false;
    }
  };

  const confirmRemoval = async () => {
    if (submitting.current) return;
    submitting.current = true;
    try {
      await removePick.mutateAsync({ categoryId: pick.categoryId, channel: pick.channel });
      onRemoved();
    } catch {
      // Mutation state displays the error without leaving the confirmation.
    } finally {
      submitting.current = false;
    }
  };

  const confirmReviewDeletion = async () => {
    if (submitting.current) return;
    submitting.current = true;
    try {
      await deleteReview.mutateAsync(pick.id);
      onRemoved();
    } catch {
      // Mutation state displays the error without leaving the confirmation.
    } finally {
      submitting.current = false;
    }
  };

  if (mode === 'idle') {
    return saved ? <Text accessibilityLiveRegion="polite" style={styles.savedNotice}>한줄평을 저장했어요.</Text> : null;
  }

  return (
    <View style={styles.card}>
      {mode === 'edit' ? (
        <>
          <Text style={styles.description}>이 원픽을 고른 이유를 수정해주세요.</Text>
          <TextInput
            accessibilityLabel="원픽 한줄평 수정"
            editable={!isBusy}
            maxLength={100}
            multiline
            onChangeText={setReview}
            style={styles.input}
            value={review}
          />
          <Text style={styles.counter}>{review.length}/100</Text>
          <Button disabled={!canSave} fullWidth label="한줄평 저장" loading={isBusy}
            onPress={() => void saveReview()} style={styles.button} />
        </>
      ) : mode === 'remove' ? (
        <>
          <Text style={styles.description}>{categoryName}의 현재 원픽 선택을 해제할까요? 한줄평과 기존 댓글은 남습니다.</Text>
          <Button fullWidth label="선택 해제하기" loading={isBusy}
            onPress={() => void confirmRemoval()} style={styles.button} variant="danger" />
        </>
      ) : (
        <>
          <Text style={styles.description}>한줄평을 삭제할까요? 현재 원픽의 한줄평을 삭제하면 원픽도 함께 해제됩니다. 댓글이 있으면 대화는 익명 자리로 남습니다.</Text>
          <Button fullWidth label="한줄평 삭제하기" loading={isBusy}
            onPress={() => void confirmReviewDeletion()} style={styles.button} variant="danger" />
        </>
      )}
      {error ? <Text accessibilityRole="alert" style={styles.error}>{getErrorMessage(error)}</Text> : null}
      <Button disabled={isBusy} fullWidth label="취소" onPress={() => setMode('idle')}
        style={styles.secondaryButton} variant="ghost" />
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderColor: OnePick.border, backgroundColor: OnePick.surface, borderRadius: 16, padding: 14, marginTop: 4, marginBottom: 8 },
  actions: { flexDirection: 'row', alignItems: 'center' },
  actionLink: { minHeight: 32, justifyContent: 'center', paddingHorizontal: 4 },
  actionText: { color: OnePick.muted, fontSize: 12, fontWeight: '700' },
  actionDot: { color: OnePick.hint, fontSize: 12 },
  savedNotice: { color: OnePick.success, fontSize: 12, lineHeight: 18, marginBottom: 4 },
  description: { color: OnePick.muted, fontSize: 13, lineHeight: 20, marginTop: 10 },
  input: { minHeight: 96, borderRadius: 15, backgroundColor: OnePick.background, padding: 13, color: OnePick.text, fontSize: 14, lineHeight: 20, textAlignVertical: 'top', marginTop: 12 },
  counter: { color: OnePick.muted, fontSize: 12, textAlign: 'right', marginTop: 6 },
  button: { marginTop: 12 },
  secondaryButton: { marginTop: 6 },
  disabled: { opacity: 0.4 },
  error: { color: OnePick.danger, fontSize: 12, lineHeight: 18, marginTop: 10 },
});
