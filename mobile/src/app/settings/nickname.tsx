import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Icon, StateCard } from '@/components/ui';
import { OnePick, OnePickRadius, OnePickSpace, OnePickType } from '@/constants/onepick';
import { useAuthSession } from '@/hooks/useAuthSession';
import { useMyProfile } from '@/hooks/useMyProfile';
import { useUpdateProfileNickname } from '@/hooks/useUpdateProfileNickname';
import {
  MAX_PROFILE_NICKNAME_LENGTH,
  nicknameQuestionPreview,
  normalizeProfileNickname,
  profileNicknameLength,
  ProfileNicknameValidationError,
} from '@/lib/profileNickname';

function NicknameForm({ userId, nickname }: { userId: string; nickname: string | null }) {
  const router = useRouter();
  const mutation = useUpdateProfileNickname(userId);
  const [draft, setDraft] = useState(nickname ?? '');
  const [error, setError] = useState('');
  const saving = useRef(false);
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);
  const length = profileNicknameLength(draft);
  const tooLong = length > MAX_PROFILE_NICKNAME_LENGTH;
  const unchanged = draft.trim() === (nickname ?? '');
  const disabled = mutation.isPending || saving.current || tooLong || unchanged;

  const goBack = () => router.canGoBack() ? router.back() : router.replace('/settings');

  const save = async () => {
    if (disabled || saving.current) return;
    saving.current = true;
    setError('');
    try {
      normalizeProfileNickname(draft);
      await mutation.mutateAsync(draft);
      if (mounted.current) goBack();
    } catch (cause) {
      if (mounted.current) setError(cause instanceof ProfileNicknameValidationError
        ? cause.message
        : '닉네임을 저장하지 못했어요. 입력한 내용은 그대로 있어요. 다시 시도해주세요.');
    } finally {
      saving.current = false;
    }
  };

  return (
    <KeyboardAvoidingView style={styles.page} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={styles.header}>
        <Pressable accessibilityRole="button" accessibilityLabel="뒤로 가기" onPress={goBack}
          style={styles.backButton}>
          <Icon name="back" />
        </Pressable>
        <Text style={styles.headerTitle}>닉네임 수정</Text>
        <View style={styles.backButton} />
      </View>
      <View style={styles.content}>
        <View style={styles.labelRow}>
          <Text style={styles.label}>닉네임</Text>
          <Text accessibilityLabel={`닉네임 ${length}자, 최대 15자`} style={styles.counter}>{length}/15</Text>
        </View>
        <View style={styles.inputBox}>
          <TextInput
            accessibilityLabel="닉네임 입력"
            autoCapitalize="none"
            autoCorrect={false}
            value={draft}
            onChangeText={(value) => { setDraft(value); setError(''); }}
            editable={!mutation.isPending}
            placeholder="닉네임을 입력해주세요."
            placeholderTextColor={OnePick.textSecondary}
            style={styles.input}
            returnKeyType="done"
          />
          {draft.length > 0 ? (
            <Pressable accessibilityRole="button" accessibilityLabel="닉네임 입력 지우기"
              disabled={mutation.isPending} onPress={() => { setDraft(''); setError(''); }}
              style={styles.clearButton}>
              <Text style={styles.clearText}>×</Text>
            </Pressable>
          ) : null}
        </View>
        <Text style={styles.hint}>홈, 프로필, 댓글에 보여줄 이름이에요.</Text>
        {tooLong ? <Text accessibilityRole="alert" style={styles.error}>닉네임은 15자 이내로 입력해주세요.</Text> : null}
        {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
        <View style={styles.preview}>
          <Text style={styles.previewLabel}>이렇게 보여요</Text>
          <Text style={styles.previewText} numberOfLines={2}>{nicknameQuestionPreview(draft)}</Text>
        </View>
      </View>
      <View style={styles.footer}>
        <Pressable accessibilityRole="button" accessibilityLabel="닉네임 저장하기"
          disabled={disabled} onPress={() => void save()} style={[styles.saveButton, disabled && styles.disabled]}>
          {mutation.isPending ? <ActivityIndicator color={OnePick.onAction} /> :
            <Text style={styles.saveText}>저장하기</Text>}
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

export default function NicknameEditScreen() {
  const { user, isLoading, error } = useAuthSession();
  const profile = useMyProfile(user?.id);
  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      {isLoading ? <StateCard loading title="로그인 상태를 확인하고 있어요." /> :
        !user || error ? <StateCard title="로그인이 필요해요." text="로그인 후 닉네임을 수정할 수 있어요." /> :
        profile.isPending ? <StateCard loading title="닉네임을 불러오고 있어요." /> :
        profile.isError || !profile.data ?
          <StateCard title="닉네임을 불러오지 못했어요." text="잠시 후 다시 시도해주세요."
            action={{ label: '다시 불러오기', variant: 'secondary', onPress: () => void profile.refetch() }} /> :
          <NicknameForm key={user.id} userId={user.id} nickname={profile.data.profile.nickname} />}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: OnePick.bgDefault },
  page: { flex: 1, width: '100%', maxWidth: OnePick.maxWidth, alignSelf: 'center' },
  header: { height: 56, paddingHorizontal: OnePickSpace.lg, flexDirection: 'row', alignItems: 'center' },
  backButton: { width: 48, height: 44, justifyContent: 'center' },
  headerTitle: { ...OnePickType.headline, color: OnePick.textPrimary, flex: 1, textAlign: 'center' },
  content: { flex: 1, paddingTop: OnePickSpace.xxl, paddingHorizontal: OnePickSpace.lg },
  labelRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: OnePickSpace.sm },
  label: { ...OnePickType.bodyMedium, color: OnePick.textPrimary },
  counter: { ...OnePickType.caption, color: OnePick.textSecondary },
  inputBox: { minHeight: 52, backgroundColor: OnePick.bgSubtle, borderRadius: OnePickRadius.md, paddingLeft: OnePickSpace.lg, paddingRight: OnePickSpace.xs, flexDirection: 'row', alignItems: 'center' },
  input: { ...OnePickType.body, flex: 1, minWidth: 0, paddingVertical: OnePickSpace.md, color: OnePick.textPrimary },
  clearButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  clearText: { ...OnePickType.title, color: OnePick.textSecondary },
  hint: { ...OnePickType.caption, color: OnePick.textSecondary, marginTop: OnePickSpace.sm },
  error: { ...OnePickType.caption, color: OnePick.textDanger, marginTop: OnePickSpace.sm },
  preview: { backgroundColor: OnePick.bgSubtle, borderRadius: OnePickRadius.md, padding: OnePickSpace.lg, gap: OnePickSpace.sm, marginTop: OnePickSpace.xxl },
  previewLabel: { ...OnePickType.caption, color: OnePick.textSecondary },
  previewText: { ...OnePickType.headline, color: OnePick.textPrimary },
  footer: { paddingHorizontal: OnePickSpace.lg, paddingTop: OnePickSpace.lg, paddingBottom: OnePickSpace.lg },
  saveButton: { height: 52, backgroundColor: OnePick.actionPrimary, borderRadius: OnePickRadius.md, alignItems: 'center', justifyContent: 'center' },
  saveText: { ...OnePickType.bodyMedium, color: OnePick.onAction },
  disabled: { opacity: 0.45 },
});
