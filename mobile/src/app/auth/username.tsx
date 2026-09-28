import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppError } from '@/errors/appError';
import { useAuthSession } from '@/hooks/useAuthSession';
import { useCreateProfile } from '@/hooks/useCreateProfile';
import { getAuthIntent, getPostAuthRoute, type AuthIntent, type AuthReturnParams } from '@/lib/auth/authIntent';
import { OnePickBrand } from '@/components/onepick-brand';
import { Button } from '@/components/ui';
import { OnePick } from '@/constants/onepick';

const USERNAME_PATTERN = /^[a-z0-9_]{3,20}$/;

function getMessage(error: unknown) {
  if (error instanceof AppError) {
    if (error.code === 'USERNAME_TAKEN') return '이미 사용 중인 사용자명이에요.';
    if (error.code === 'USERNAME_INVALID') return '영문 소문자, 숫자, 밑줄로 3~20자를 입력해주세요.';
    if (error.code === 'AUTH_REQUIRED') return '로그인 상태를 다시 확인해주세요.';
  }

  return '사용자명을 저장하지 못했어요. 다시 시도해주세요.';
}

// Intents with no action left in flight: a brand-new account starts taste onboarding instead.
// view_profile belongs here because following still needs a second press after returning, so a
// new account would otherwise land on a stranger's profile owning nothing itself. Intents that do
// carry an action (comment_pick, choose_*, request_item) keep resuming it.
const ONBOARDING_INTENTS = new Set<AuthIntent['action']>(['home', 'join_from_profile', 'view_profile']);

export default function UsernameScreen() {
  const auth = useAuthSession();
  const params = useLocalSearchParams<AuthReturnParams>();
  const intent = getAuthIntent(params);
  return <UsernameForm key={`${auth.user?.id ?? 'anonymous'}:${JSON.stringify(intent)}`} auth={auth} intent={intent} />;
}

function UsernameForm({ auth, intent }: { auth: ReturnType<typeof useAuthSession>; intent: AuthIntent }) {
  const router = useRouter();
  const { user, isLoading, error: sessionError, retry: retrySession } = auth;
  const createProfile = useCreateProfile(user?.id);
  const [username, setUsername] = useState('');
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<unknown>(null);
  const phase = useRef<'idle' | 'saving' | 'saved'>('idle');
  const mounted = useRef(true);
  const navigated = useRef(false);
  const latestSession = useRef({ userId: user?.id, ready: !isLoading && !sessionError });
  latestSession.current = { userId: user?.id, ready: !isLoading && !sessionError };
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  const normalized = username.trim().toLowerCase();
  const valid = USERNAME_PATTERN.test(normalized);
  const available = () => mounted.current && Boolean(user) && latestSession.current.ready && latestSession.current.userId === user?.id;
  const continueToIntent = () => {
    if (!available() || phase.current !== 'saved' || navigated.current) return;
    navigated.current = true;
    router.replace(ONBOARDING_INTENTS.has(intent.action) ? '/onboarding' : getPostAuthRoute(intent));
  };

  const handleSave = async () => {
    if (!available() || !user || !valid || phase.current !== 'idle' || createProfile.isPending) return;
    phase.current = 'saving';
    setSaveError(null);
    try {
      const result = await createProfile.mutateAsync(normalized);
      if (result.id !== user.id) throw new AppError('AUTH_REQUIRED');
      phase.current = 'saved';
      if (!mounted.current) return;
      setSaved(true);
      // Never let the old account/intent's completion redirect the current screen.
      continueToIntent();
    } catch (error) {
      if (mounted.current) setSaveError(error);
    } finally {
      if (phase.current === 'saving') phase.current = 'idle';
    }
  };
  const error = saveError ?? createProfile.error;

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      <View style={styles.content}>
        {intent.action === 'follow_profile' ? <>
          <View style={styles.intentHeader}>
            <Text style={styles.intentHeaderTitle}>사용자명 만들기</Text>
          </View>
          <Text style={styles.intentCaption}>로그인 완료 · @{intent.username}님 팔로우를 이어서 해요</Text>
          <Text style={styles.intentTitle}>사용자명을 정해 주세요</Text>
        </> : <>
          <View style={styles.brand}><OnePickBrand /></View>
          <Text style={styles.title}>사용자명만{ '\n' }정하면 끝이에요</Text>
          <Text style={styles.subtitle}>원픽과 공개 프로필에 표시할 고유한 이름입니다.</Text>
        </>}

        {isLoading ? <Text style={styles.statusText}>로그인 상태 확인 중...</Text> : null}
        {!isLoading && (sessionError || !user) ? (
          <>
            <Text style={styles.errorText}>{sessionError ? '로그인 상태를 확인하지 못했어요.' : '로그인이 필요해요.'}</Text>
            <Button size="lg" fullWidth style={styles.primaryAction} label={sessionError ? '다시 확인하기' : '로그인하고 계속'}
              onPress={() => sessionError ? retrySession() : router.replace({ pathname: '/auth/login', params: { ...intent } })} />
          </>
        ) : null}

        {!isLoading && !sessionError && user && saved ? <>
          <Text accessibilityLiveRegion="polite" style={styles.statusText}>사용자명 설정을 확인했어요.</Text>
          <Button size="lg" fullWidth style={styles.primaryAction} label="원래 작업으로 계속" onPress={continueToIntent} />
        </> : null}
        {!isLoading && !sessionError && user && !saved ? (
          <>
            <View style={styles.inputHeader}>
              <Text style={styles.label}>사용자명</Text>
              <Text style={styles.counter}>{normalized.length}/20</Text>
            </View>
            <TextInput
              accessibilityLabel="사용자명"
              autoCapitalize="none"
              autoCorrect={false}
              editable={!createProfile.isPending && phase.current !== 'saving'}
              maxLength={20}
              onChangeText={(value) => {
                if (phase.current !== 'idle') return;
                setUsername(value); setSaveError(null);
              }}
              placeholder="onepick_user"
              placeholderTextColor={OnePick.hint}
              style={styles.input}
              value={username}
            />
            <Text style={styles.helper}>{intent.action === 'follow_profile'
              ? '영문 소문자·숫자·밑줄 3–20자 · 프로필 주소가 돼요'
              : '영문 소문자, 숫자, 밑줄(_)만 사용할 수 있어요.'}</Text>

            {error ? <View style={styles.errorBox}><Text accessibilityRole="alert" style={styles.errorText}>{getMessage(error)}</Text></View> : null}
            {error instanceof AppError && error.code === 'AUTH_REQUIRED' ? <Button variant="secondary" size="sm" style={styles.recovery} label="다시 로그인하고 계속"
              onPress={() => router.replace({ pathname: '/auth/login', params: { ...intent } })} /> : null}
            <Button size="lg" fullWidth style={styles.primaryAction}
              disabled={!valid || createProfile.isPending || phase.current !== 'idle'}
              label={createProfile.isPending || phase.current === 'saving' ? '사용자명 저장 중...' : intent.action === 'follow_profile' ? '저장하고 계속' : '이 사용자명으로 시작'}
              onPress={() => void handleSave()} />
          </>
        ) : null}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: OnePick.background },
  content: { flex: 1, width: '100%', maxWidth: OnePick.maxWidth, alignSelf: 'center', paddingHorizontal: 20, paddingTop: 56 },
  brand: { marginBottom: 4 },
  intentHeader: { height: 56, alignItems: 'center', justifyContent: 'center', marginHorizontal: -20, marginTop: -56, marginBottom: 12 },
  intentHeaderTitle: { color: OnePick.text, fontSize: 16, lineHeight: 24, fontWeight: '700' },
  intentCaption: { color: OnePick.muted, fontSize: 12, lineHeight: 18, marginTop: 12 },
  intentTitle: { color: OnePick.text, fontSize: 22, lineHeight: 30, fontWeight: '700', marginTop: 16 },
  title: { color: OnePick.text, fontSize: 26, lineHeight: 34, fontWeight: '800', letterSpacing: -0.6, marginTop: 10 },
  subtitle: { color: OnePick.muted, fontSize: 15, lineHeight: 22, marginTop: 12 },
  statusText: { color: OnePick.muted, fontSize: 14, lineHeight: 20, marginTop: 28 },
  inputHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', marginTop: 28, marginBottom: 8 },
  label: { color: OnePick.text, fontSize: 15, lineHeight: 22, fontWeight: '700' },
  counter: { color: OnePick.muted, fontSize: 12 },
  input: { minHeight: 52, borderRadius: 12, borderWidth: 1, borderColor: OnePick.border, backgroundColor: OnePick.surface, paddingHorizontal: 16, color: OnePick.text, fontSize: 16 },
  helper: { color: OnePick.muted, fontSize: 12, lineHeight: 16, marginTop: 8 },
  primaryAction: { marginTop: 24 },
  recovery: { alignSelf: 'flex-start', marginTop: 12 },
  errorBox: { backgroundColor: OnePick.dangerSoft, borderRadius: 12, padding: 14, marginTop: 14 },
  errorText: { color: OnePick.danger, fontSize: 13, lineHeight: 18, marginTop: 12 },
  pressed: { opacity: 0.7 },
});
