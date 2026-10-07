import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppError } from '@/errors/appError';
import { useAuthSession } from '@/hooks/useAuthSession';
import { useCreateProfile } from '@/hooks/useCreateProfile';
import { getAuthIntent, getPostAuthRoute, type AuthIntent, type AuthReturnParams } from '@/lib/auth/authIntent';
import { Button, Icon } from '@/components/ui';
import { OnePick, OnePickRadius, OnePickSpace, OnePickType } from '@/constants/onepick';

const USERNAME_PATTERN = /^[a-z0-9_]{3,20}$/;

function getMessage(error: unknown) {
  if (error instanceof AppError) {
    if (error.code === 'USERNAME_TAKEN') return '이미 사용 중인 아이디예요.';
    if (error.code === 'USERNAME_INVALID') return '영문 소문자, 숫자, 밑줄(_)로 3~20자를 입력해주세요.';
    if (error.code === 'AUTH_REQUIRED') return '로그인 상태를 다시 확인해주세요.';
  }

  return '아이디를 저장하지 못했어요. 다시 시도해주세요.';
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
    // MVP sign-up has no taste onboarding: a new account goes straight back to what it started.
    router.replace(getPostAuthRoute(intent));
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
      <KeyboardAvoidingView style={styles.content} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <Pressable accessibilityRole="button" accessibilityLabel="뒤로 가기"
          onPress={() => router.canGoBack() ? router.back() : router.replace('/')} style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}>
          <Icon name="back" />
        </Pressable>

        <View style={styles.body}>
          <Text accessibilityRole="header" style={styles.title}>아이디를 정해주세요.</Text>

          {isLoading ? <Text style={styles.statusText}>로그인 상태 확인 중...</Text> : null}
          {!isLoading && (sessionError || !user) ? (
            <>
              <Text style={styles.errorText}>{sessionError ? '로그인 상태를 확인하지 못했어요.' : '로그인이 필요해요.'}</Text>
              <Button size="lg" fullWidth style={styles.inlineAction} label={sessionError ? '다시 확인하기' : '로그인하고 계속'}
                onPress={() => sessionError ? retrySession() : router.replace({ pathname: '/auth/login', params: { ...intent } })} />
            </>
          ) : null}

          {!isLoading && !sessionError && user && saved ? <>
            <Text accessibilityLiveRegion="polite" style={styles.statusText}>아이디를 저장했어요.</Text>
            <Button size="lg" fullWidth style={styles.inlineAction} label="원래 작업으로 계속" onPress={continueToIntent} />
          </> : null}
          {!isLoading && !sessionError && user && !saved ? (
            <>
              <TextInput
                accessibilityLabel="아이디"
                autoCapitalize="none"
                autoCorrect={false}
                editable={!createProfile.isPending && phase.current !== 'saving'}
                maxLength={20}
                onChangeText={(value) => {
                  if (phase.current !== 'idle') return;
                  setUsername(value); setSaveError(null);
                }}
                onSubmitEditing={() => void handleSave()}
                placeholder="onepick_user"
                placeholderTextColor={OnePick.textSecondary}
                returnKeyType="done"
                style={[styles.input, error ? styles.inputError : null]}
                value={username}
              />
              {error ? <Text accessibilityRole="alert" style={styles.errorText}>{getMessage(error)}</Text>
                : <Text style={styles.helper}>영문 소문자, 숫자, 밑줄(_) 3~20자</Text>}
              {error instanceof AppError && error.code === 'AUTH_REQUIRED' ? <Button variant="secondary" size="sm" style={styles.recovery} label="다시 로그인하고 계속"
                onPress={() => router.replace({ pathname: '/auth/login', params: { ...intent } })} /> : null}
            </>
          ) : null}
        </View>

        {!isLoading && !sessionError && user && !saved ? (
          <View style={styles.footer}>
            <Button size="lg" fullWidth
              disabled={!valid || createProfile.isPending || phase.current !== 'idle'}
              label={createProfile.isPending || phase.current === 'saving' ? '아이디 저장 중...' : '이 아이디로 시작하기'}
              onPress={() => void handleSave()} />
          </View>
        ) : null}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: OnePick.bgDefault },
  content: { flex: 1, width: '100%', maxWidth: OnePick.maxWidth, alignSelf: 'center', paddingHorizontal: OnePickSpace.gutter },
  backButton: { width: 44, height: 56, justifyContent: 'center' },
  body: { flex: 1, paddingTop: 10 },
  title: { ...OnePickType.pageTitle, color: OnePick.textPrimary, marginBottom: 18 },
  statusText: { ...OnePickType.body, color: OnePick.textSecondary },
  input: { ...OnePickType.body, minHeight: 52, borderRadius: OnePickRadius.md, borderWidth: 1, borderColor: OnePick.bgSubtle, backgroundColor: OnePick.bgSubtle, paddingHorizontal: 14, color: OnePick.textPrimary },
  inputError: { borderColor: OnePick.textDanger },
  helper: { ...OnePickType.caption, color: OnePick.textSecondary, marginTop: OnePickSpace.lg },
  errorText: { ...OnePickType.caption, color: OnePick.textDanger, marginTop: OnePickSpace.lg },
  inlineAction: { marginTop: OnePickSpace.xxl },
  recovery: { alignSelf: 'flex-start', marginTop: OnePickSpace.md },
  footer: { paddingTop: 6, paddingBottom: OnePickSpace.lg },
  pressed: { opacity: 0.7 },
});
