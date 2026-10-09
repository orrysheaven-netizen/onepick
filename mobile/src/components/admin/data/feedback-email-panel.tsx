import { useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { adminStyles } from '@/components/admin/admin-shell';
import { OnePick } from '@/constants/onepick';
import { useAuthSession } from '@/hooks/useAuthSession';
import { useFeedbackEmail, useSaveFeedbackEmail } from '@/hooks/useFeedbackEmail';
import { normalizeFeedbackEmail } from '@/lib/feedback/email';

export function FeedbackEmailPanel() {
  const { user, isLoading, error } = useAuthSession();
  if (isLoading) return <ActivityIndicator accessibilityLabel="로그인 상태를 확인하고 있어요" />;
  if (!user || error) return <Text accessibilityRole="alert" style={adminStyles.error}>관리자 로그인 상태를 다시 확인해주세요.</Text>;
  // Discard drafts and pending UI results when the signed-in account changes.
  return <FeedbackEmailForm key={user.id} />;
}

export function FeedbackEmailForm() {
  const query = useFeedbackEmail();
  const mutation = useSaveFeedbackEmail();
  const [draft, setDraft] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const busy = useRef(false);
  const save = async () => {
    if (busy.current || mutation.isPending || query.data === undefined) return;
    let email: string | null;
    try { email = normalizeFeedbackEmail(draft ?? query.data); }
    catch { setMessage('수신할 이메일 주소 한 개를 올바르게 입력해주세요.'); return; }
    busy.current = true;
    setMessage('');
    try {
      await mutation.mutateAsync(email);
      setDraft(null);
      setMessage(email ? '의견 수신 이메일을 저장했어요.' : '의견 수신 이메일을 비웠어요.');
    } catch {
      setMessage('저장하지 못했어요. 입력한 주소를 유지했으니 관리자 인증과 연결 상태를 확인한 뒤 다시 시도해주세요.');
    } finally { busy.current = false; }
  };
  return <View style={[adminStyles.card, styles.card]}>
    <Text style={adminStyles.sectionTitle}>의견을 받을 이메일을 설정해요</Text>
    <Text style={styles.hint}>홈에서 의견을 보내면 이 주소로 메일 작성 화면이 열려요. 사용자에게 공개할 수신용 주소를 입력해주세요.</Text>
    <Text style={styles.hint}>주소를 비워 저장하면 의견 보내기 연결을 해제해요.</Text>
    {query.isPending ? <ActivityIndicator accessibilityLabel="이메일 설정을 불러오고 있어요" /> : null}
    {query.isError ? <>
      <Text accessibilityRole="alert" style={adminStyles.error}>이메일 설정을 불러오지 못했어요.</Text>
      <Pressable accessibilityRole="button" disabled={query.isFetching || mutation.isPending}
        onPress={() => void query.refetch()} style={styles.button}>
        <Text style={styles.buttonText}>다시 불러와요</Text>
      </Pressable>
    </> : null}
    {query.data !== undefined ? <>
      <Text style={adminStyles.label}>의견 수신 이메일</Text>
      <TextInput accessibilityLabel="의견 수신 이메일" value={draft ?? query.data ?? ''}
        keyboardType="email-address" autoCapitalize="none" autoCorrect={false} maxLength={254}
        placeholder="이메일 주소를 입력해주세요" placeholderTextColor={OnePick.textSecondary}
        editable={!mutation.isPending} onChangeText={(value) => { setDraft(value); setMessage(''); }}
        onSubmitEditing={() => void save()} style={[adminStyles.input, styles.input]} />
      <Pressable accessibilityRole="button" disabled={mutation.isPending} onPress={() => void save()}
        style={[styles.button, mutation.isPending && styles.disabled]}>
        <Text style={styles.buttonText}>{mutation.isPending ? '저장하고 있어요' : '저장해요'}</Text>
      </Pressable>
    </> : null}
    {message ? <Text accessibilityRole="alert" style={styles.hint}>{message}</Text> : null}
  </View>;
}

const styles = StyleSheet.create({
  card: { gap: 12 },
  hint: { color: OnePick.textSecondary, fontSize: 14, lineHeight: 21 },
  input: { fontSize: 16, minHeight: 44 },
  button: { minHeight: 44, justifyContent: 'center', alignItems: 'center', padding: 12, borderRadius: 12, backgroundColor: OnePick.accentSoft },
  buttonText: { color: OnePick.textPrimary, fontSize: 14, fontWeight: '600' },
  disabled: { opacity: 0.5 },
});
