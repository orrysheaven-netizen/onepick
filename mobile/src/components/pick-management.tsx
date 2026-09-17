import { useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { AppError } from '@/errors/appError';
import { useManagePick } from '@/hooks/useManagePick';
import type { Pick } from '@/types/domain/pick';

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

export function PickManagement({ pick, categoryName, onRemoved }: {
  pick: Pick;
  categoryName: string;
  onRemoved: () => void;
}) {
  const { updateReview, removePick } = useManagePick();
  const [mode, setMode] = useState<'idle' | 'edit' | 'remove'>('idle');
  const [review, setReview] = useState(pick.oneLineReview);
  const [saved, setSaved] = useState(false);
  const submitting = useRef(false);
  const isBusy = updateReview.isPending || removePick.isPending;
  const trimmedReview = review.trim();
  const canSave = trimmedReview.length >= 1 && trimmedReview.length <= 100;
  const error = mode === 'edit' ? updateReview.error : mode === 'remove' ? removePick.error : null;

  const open = (nextMode: 'edit' | 'remove') => {
    if (submitting.current) return;
    updateReview.reset();
    removePick.reset();
    setSaved(false);
    setReview(pick.oneLineReview);
    setMode(nextMode);
  };

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
      await removePick.mutateAsync(pick.categoryId);
      onRemoved();
    } catch {
      // Mutation state displays the error without leaving the confirmation.
    } finally {
      submitting.current = false;
    }
  };

  return (
    <View style={styles.card}>
      <Text style={styles.title}>내 원픽 관리</Text>
      {mode === 'idle' ? (
        <>
          {saved ? <Text accessibilityLiveRegion="polite" style={styles.description}>한줄평을 저장했어요.</Text> : null}
          <Pressable accessibilityRole="button" onPress={() => open('edit')} style={styles.button}>
            <Text style={styles.buttonText}>한줄평 수정</Text>
          </Pressable>
          <Pressable accessibilityRole="button" onPress={() => open('remove')} style={styles.secondaryButton}>
            <Text style={styles.secondaryText}>원픽 선택 해제</Text>
          </Pressable>
        </>
      ) : mode === 'edit' ? (
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
          <Pressable
            accessibilityRole="button"
            disabled={!canSave || isBusy}
            onPress={() => void saveReview()}
            style={[styles.button, (!canSave || isBusy) && styles.disabled]}>
            {isBusy ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.buttonText}>한줄평 저장</Text>}
          </Pressable>
        </>
      ) : (
        <>
          <Text style={styles.description}>{categoryName}의 현재 원픽 선택을 해제할까요? 이전 선택 기록은 남고, 이 카테고리에서 다시 원픽을 고를 수 있어요.</Text>
          <Pressable
            accessibilityRole="button"
            disabled={isBusy}
            onPress={() => void confirmRemoval()}
            style={[styles.button, styles.removeButton, isBusy && styles.disabled]}>
            {isBusy ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.buttonText}>선택 해제하고 홈으로</Text>}
          </Pressable>
        </>
      )}
      {error ? <Text accessibilityRole="alert" style={styles.error}>{getErrorMessage(error)}</Text> : null}
      {mode !== 'idle' ? (
        <Pressable accessibilityRole="button" disabled={isBusy} onPress={() => setMode('idle')} style={[styles.secondaryButton, isBusy && styles.disabled]}>
          <Text style={styles.secondaryText}>취소</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderColor: '#E3E5EA', backgroundColor: '#FFFFFF', borderRadius: 20, padding: 18, marginTop: 14 },
  title: { color: '#202124', fontSize: 16, fontWeight: '800' },
  description: { color: '#5F5A54', fontSize: 13, lineHeight: 20, marginTop: 10 },
  input: { minHeight: 96, borderRadius: 15, backgroundColor: '#F5F6F8', padding: 13, color: '#202124', fontSize: 14, lineHeight: 20, textAlignVertical: 'top', marginTop: 12 },
  counter: { color: '#747985', fontSize: 12, textAlign: 'right', marginTop: 6 },
  button: { minHeight: 46, borderRadius: 14, backgroundColor: '#4945ED', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 14, marginTop: 12 },
  buttonText: { color: '#FFFFFF', fontSize: 13, fontWeight: '800' },
  secondaryButton: { minHeight: 44, alignItems: 'center', justifyContent: 'center', marginTop: 6 },
  secondaryText: { color: '#5F6470', fontSize: 13, fontWeight: '700' },
  removeButton: { backgroundColor: '#A9482D' },
  disabled: { opacity: 0.4 },
  error: { color: '#A9482D', fontSize: 12, lineHeight: 18, marginTop: 10 },
});
