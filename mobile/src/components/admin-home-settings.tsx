import { useRef, useState } from 'react';
import { AdminDailyQuestionSettings } from '@/components/admin-daily-question-settings';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useAdminHomeSettings, useUpdateAdminHomeSettings } from '@/hooks/useAdminHomeSettings';
import { OnePick } from '@/constants/onepick';

export function AdminHomeSettings({ userId }: { userId?: string }) {
  const query = useAdminHomeSettings(userId);
  const mutation = useUpdateAdminHomeSettings(userId);
  const [draft, setDraft] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const busy = useRef(false);
  const save = async () => {
    if (busy.current || mutation.isPending || query.data === undefined) return;
    const value = (draft ?? String(query.data)).trim();
    const count = Number(value);
    if (!/^\d+$/.test(value) || !Number.isInteger(count) || count < 1 || count > 100000) {
      setMessage('기준 인원은 1~100000 사이의 정수로 입력해주세요.');
      return;
    }
    busy.current = true;
    setMessage('');
    try {
      await mutation.mutateAsync(count);
      setDraft(null);
      setMessage(`구버전 상품 집계 기준을 ${count}명 이상으로 저장했습니다.`);
    } catch {
      setMessage('저장하지 못했습니다. 입력값을 유지했으니 다시 시도해주세요.');
    } finally { busy.current = false; }
  };
  return <>
    <AdminDailyQuestionSettings key={userId ?? 'signed-out'} userId={userId} />
    <View style={styles.card}>
    <Text style={styles.heading}>구버전 상품 집계 설정</Text>
    <Text style={styles.hint}>새 홈은 사람별 원픽을 보여주며 최소 선택 인원을 적용하지 않습니다. 아래 기준은 구버전 상품 모아보기와의 호환용으로만 유지합니다. 탐색 TOP 3에도 적용하지 않습니다.</Text>
    {query.isPending ? <ActivityIndicator accessibilityLabel="구버전 상품 집계 설정 불러오는 중" /> : null}
    {query.isError ? <>
      <Text accessibilityRole="alert" style={styles.message}>상품 집계 설정을 불러오지 못했습니다.</Text>
      <Pressable accessibilityRole="button" disabled={query.isFetching} onPress={() => void query.refetch()} style={styles.button}><Text style={styles.buttonText}>설정 다시 불러오기</Text></Pressable>
    </> : null}
    {query.data !== undefined ? <>
      <Text style={styles.label}>구버전 최소 선택 인원 · 현재 {query.data}명</Text>
      <TextInput accessibilityLabel="구버전 상품 집계 최소 선택 인원" keyboardType="number-pad" maxLength={6}
        value={draft ?? String(query.data)} editable={!mutation.isPending}
        onChangeText={(value) => { setDraft(value); setMessage(''); }} style={styles.input} />
      <Pressable accessibilityRole="button" disabled={mutation.isPending} onPress={() => void save()}
        style={[styles.button, mutation.isPending && styles.disabled]}>
        <Text style={styles.buttonText}>{mutation.isPending ? '저장 중…' : '구버전 집계 기준 저장'}</Text>
      </Pressable>
    </> : null}
    {message ? <Text accessibilityRole="alert" style={styles.message}>{message}</Text> : null}
  </View></>;
}

const styles = StyleSheet.create({
  card: { backgroundColor: OnePick.surface, borderWidth: 1, borderColor: OnePick.border, borderRadius: 18, padding: 18, marginVertical: 12, gap: 12 },
  heading: { color: OnePick.text, fontSize: 18, fontWeight: '700' },
  hint: { color: OnePick.muted, fontSize: 13, lineHeight: 20 },
  label: { color: OnePick.text, fontSize: 14, fontWeight: '600' },
  input: { minHeight: 46, borderWidth: 1, borderColor: OnePick.border, borderRadius: 12, paddingHorizontal: 14, fontSize: 16, color: OnePick.text },
  button: { minHeight: 44, justifyContent: 'center', alignItems: 'center', padding: 12, borderRadius: 12, backgroundColor: OnePick.accentSoft },
  buttonText: { color: OnePick.accent, fontSize: 14, fontWeight: '700' },
  message: { color: OnePick.muted, fontSize: 13, lineHeight: 20 },
  disabled: { opacity: 0.5 },
});

