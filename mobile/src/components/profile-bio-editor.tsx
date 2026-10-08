import { useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useAuthSession } from '@/hooks/useAuthSession';
import { DIALOG_CANCEL_LABEL } from '@/components/ui/dialog-labels';
import { useUpdateProfileBio } from '@/hooks/useUpdateProfileBio';
import { MAX_PROFILE_BIO_LENGTH, profileBioLength, ProfileBioValidationError } from '@/lib/profileBio';
import { OnePick } from '@/constants/onepick';

type Props = { profileUserId: string; bio?: string | null };

export function ProfileBioEditor(props: Props) {
  const auth = useAuthSession();
  if (auth.isLoading || auth.error || !auth.user || auth.user.id !== props.profileUserId) return null;
  return <BioEditor key={`${auth.user.id}:${props.profileUserId}`} {...props} />;
}

function BioEditor({ profileUserId, bio }: Props) {
  const mutation = useUpdateProfileBio(profileUserId);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const inFlight = useRef(false);
  const length = profileBioLength(draft);
  const tooLong = length > MAX_PROFILE_BIO_LENGTH;
  const disabled = mutation.isPending || tooLong || draft === (bio ?? '');

  const startEditing = () => {
    if (inFlight.current) return;
    setDraft(bio ?? '');
    setError(''); setNotice(''); setEditing(true);
  };
  const cancel = () => {
    if (inFlight.current) return;
    setEditing(false); setDraft(''); setError('');
  };
  const save = async () => {
    if (inFlight.current || disabled) return;
    inFlight.current = true;
    setError(''); setNotice('');
    try {
      const saved = await mutation.mutateAsync(draft);
      setEditing(false); setDraft('');
      setNotice(saved.bio ? '자기소개를 저장했어요.' : '자기소개를 비웠어요.');
    } catch (cause) {
      setError(cause instanceof ProfileBioValidationError ? cause.message : '저장하지 못했어요. 내용은 그대로 있어요. 로그인과 연결 상태를 확인한 뒤 다시 시도해주세요.');
    } finally { inFlight.current = false; }
  };

  return <View style={styles.card}>
    <View style={styles.heading}>
      <Text style={styles.title}>자기소개 <Text style={styles.optional}>선택</Text></Text>
      {!editing ? <Pressable accessibilityRole="button" accessibilityLabel={bio ? '자기소개 수정' : '자기소개 추가'}
        onPress={startEditing} style={({ pressed }) => [styles.action, pressed && styles.disabled]}>
        <Text style={styles.actionText}>{bio ? '수정' : '추가'}</Text>
      </Pressable> : null}
    </View>
    {editing ? <>
      <Text style={styles.hint}>다른 사람이 내 프로필에서 볼 수 있는 공개 소개예요.</Text>
      <TextInput accessibilityLabel="자기소개 입력" multiline textAlignVertical="top"
        placeholder="라면과 영화를 좋아해요. 오래 좋아한 것들을 모읍니다."
        placeholderTextColor={OnePick.textSecondary} value={draft}
        onChangeText={(value) => { setDraft(value); setError(''); }}
        editable={!mutation.isPending} maxLength={Math.max(MAX_PROFILE_BIO_LENGTH * 2, (bio ?? '').length)}
        style={styles.input} />
      <Text style={[styles.counter, tooLong && styles.error]}>{length}/{MAX_PROFILE_BIO_LENGTH}자</Text>
      {tooLong ? <Text accessibilityRole="alert" style={styles.error}>자기소개는 {MAX_PROFILE_BIO_LENGTH}자 이내로 입력해주세요.</Text> : null}
      <Text style={styles.hint}>내용을 비우고 저장하면 자기소개가 삭제돼요.</Text>
      <View style={styles.buttons}>
        <Pressable accessibilityRole="button" accessibilityLabel="자기소개 저장" disabled={disabled}
          onPress={() => void save()} style={[styles.save, disabled && styles.disabled]}>
          {mutation.isPending ? <ActivityIndicator color={OnePick.onAccent} accessibilityLabel="자기소개 저장 중" /> : <Text style={styles.saveText}>저장하기</Text>}
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="자기소개 편집 취소" disabled={mutation.isPending}
          onPress={cancel} style={[styles.action, mutation.isPending && styles.disabled]}><Text style={styles.actionText}>{DIALOG_CANCEL_LABEL}</Text></Pressable>
        {draft ? <Pressable accessibilityRole="button" accessibilityLabel="자기소개 내용 지우기" disabled={mutation.isPending}
          onPress={() => { if (!inFlight.current) { setDraft(''); setError(''); } }}
          style={[styles.action, mutation.isPending && styles.disabled]}><Text style={styles.clearText}>내용 지우기</Text></Pressable> : null}
      </View>
    </> : bio ? <Text style={styles.bio}>{bio}</Text> : <Text style={styles.hint}>좋아하는 것과 나의 취향을 간단히 소개해보세요.</Text>}
    {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
    {notice ? <Text accessibilityLiveRegion="polite" style={styles.hint}>{notice}</Text> : null}
  </View>;
}

const styles = StyleSheet.create({
  card: { backgroundColor: OnePick.surface, borderWidth: 1, borderColor: OnePick.border, borderRadius: 20, padding: 16, marginBottom: 18 },
  heading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 44 },
  title: { color: OnePick.text, fontSize: 15, fontWeight: '800' },
  optional: { color: OnePick.muted, fontSize: 12, fontWeight: '400' },
  bio: { color: OnePick.muted, fontSize: 14, lineHeight: 22, marginTop: 4 },
  hint: { color: OnePick.muted, fontSize: 12, lineHeight: 18, marginTop: 6 },
  input: { minHeight: 104, borderWidth: 1, borderColor: OnePick.border, borderRadius: 12, padding: 12,
    marginTop: 12, color: OnePick.text, backgroundColor: OnePick.sunken, fontSize: 14, lineHeight: 22 },
  counter: { color: OnePick.muted, fontSize: 12, textAlign: 'right', marginTop: 6 },
  buttons: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginTop: 8 },
  action: { minHeight: 44, paddingHorizontal: 8, justifyContent: 'center' },
  actionText: { color: OnePick.accent, fontSize: 13, fontWeight: '700' },
  clearText: { color: OnePick.muted, fontSize: 12 },
  save: { minHeight: 44, paddingHorizontal: 18, borderRadius: 12, backgroundColor: OnePick.accent, justifyContent: 'center' },
  saveText: { color: OnePick.onAccent, fontSize: 13, fontWeight: '800' },
  error: { color: OnePick.danger, fontSize: 12, lineHeight: 18, marginTop: 8 },
  disabled: { opacity: 0.5 },
});
