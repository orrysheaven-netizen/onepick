import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppError } from '@/errors/appError';
import { useAuthSession } from '@/hooks/useAuthSession';
import { useCreateProfile } from '@/hooks/useCreateProfile';
import { getAuthIntent, getPostAuthRoute, type AuthIntent, type AuthReturnParams } from '@/lib/auth/authIntent';
import { OnePickBrand } from '@/components/onepick-brand';
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
    router.replace(intent.action === 'home' ? '/onboarding' : getPostAuthRoute(intent));
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
        <View style={styles.brand}><OnePickBrand /></View>
        <Text style={styles.title}>사용자명만{ '\n' }정하면 끝이에요</Text>
        <Text style={styles.subtitle}>원픽과 공개 프로필에 표시할 고유한 이름입니다.</Text>

        {isLoading ? <Text style={styles.statusText}>로그인 상태 확인 중...</Text> : null}
        {!isLoading && (sessionError || !user) ? (
          <>
            <Text style={styles.errorText}>{sessionError ? '로그인 상태를 확인하지 못했어요.' : '로그인이 필요해요.'}</Text>
            <Pressable
              accessibilityRole="button"
              onPress={() => sessionError ? retrySession() : router.replace({ pathname: '/auth/login', params: { ...intent } })}
              style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed]}>
              <Text style={styles.primaryButtonText}>{sessionError ? '다시 확인하기' : '로그인하고 계속'}</Text>
            </Pressable>
          </>
        ) : null}

        {!isLoading && !sessionError && user && saved ? <>
          <Text accessibilityLiveRegion="polite" style={styles.statusText}>사용자명 설정을 확인했어요.</Text>
          <Pressable accessibilityRole="button" onPress={continueToIntent} style={styles.primaryButton}>
            <Text style={styles.primaryButtonText}>원래 작업으로 계속</Text>
          </Pressable>
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
            <Text style={styles.helper}>영문 소문자, 숫자, 밑줄(_)만 사용할 수 있어요.</Text>

            {error ? <View style={styles.errorBox}><Text accessibilityRole="alert" style={styles.errorText}>{getMessage(error)}</Text></View> : null}
            {error instanceof AppError && error.code === 'AUTH_REQUIRED' ? <Pressable accessibilityRole="button"
              onPress={() => router.replace({ pathname: '/auth/login', params: { ...intent } })} style={styles.primaryButton}>
              <Text style={styles.primaryButtonText}>다시 로그인하고 계속</Text>
            </Pressable> : null}
            <Pressable
              accessibilityRole="button"
              disabled={!valid || createProfile.isPending || phase.current !== 'idle'}
              onPress={() => void handleSave()}
              style={({ pressed }) => [styles.primaryButton, (!valid || createProfile.isPending || phase.current !== 'idle') && styles.disabled, pressed && valid && styles.pressed]}>
              <Text style={styles.primaryButtonText}>{createProfile.isPending || phase.current === 'saving' ? '사용자명 저장 중...' : '이 사용자명으로 시작'}</Text>
            </Pressable>
          </>
        ) : null}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: OnePick.background },
  content: { flex: 1, width: '100%', maxWidth: 640, alignSelf: 'center', paddingHorizontal: 24, paddingTop: 62 },
  brand: { marginBottom: 4 },
  title: { color: OnePick.text, fontSize: 31, lineHeight: 38, fontWeight: '800', letterSpacing: -0.8, marginTop: 10 },
  subtitle: { color: OnePick.muted, fontSize: 14, lineHeight: 21, marginTop: 13, maxWidth: 380 },
  statusText: { color: OnePick.muted, fontSize: 13, marginTop: 34 },
  inputHeader: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 34, marginBottom: 10 },
  label: { color: OnePick.text, fontSize: 14, fontWeight: '800' },
  counter: { color: OnePick.muted, fontSize: 12 },
  input: { minHeight: 54, borderRadius: 16, backgroundColor: OnePick.surface, paddingHorizontal: 16, color: OnePick.text, fontSize: 16 },
  helper: { color: OnePick.muted, fontSize: 12, marginTop: 8 },
  primaryButton: { minHeight: 54, borderRadius: 17, backgroundColor: OnePick.accent, alignItems: 'center', justifyContent: 'center', marginTop: 24 },
  primaryButtonText: { color: OnePick.onAccent, fontSize: 15, fontWeight: '800' },
  errorBox: { backgroundColor: OnePick.dangerSoft, borderRadius: 14, padding: 13, marginTop: 14 },
  errorText: { color: OnePick.danger, fontSize: 12, lineHeight: 18, marginTop: 12 },
  disabled: { opacity: 0.4 },
  pressed: { opacity: 0.7 },
});
