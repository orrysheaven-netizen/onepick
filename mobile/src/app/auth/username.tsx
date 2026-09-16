import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppError } from '@/errors/appError';
import { useAuthSession } from '@/hooks/useAuthSession';
import { useCreateProfile } from '@/hooks/useCreateProfile';
import { getAuthIntent, getPostAuthRoute, type AuthReturnParams } from '@/lib/auth/authIntent';

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
  const router = useRouter();
  const params = useLocalSearchParams<AuthReturnParams>();
  const intent = getAuthIntent(params);
  const { user, isLoading, error: sessionError, retry: retrySession } = useAuthSession();
  const createProfile = useCreateProfile();
  const [username, setUsername] = useState('');
  const normalized = username.trim().toLowerCase();
  const valid = USERNAME_PATTERN.test(normalized);

  const handleSave = async () => {
    if (!user || !valid || createProfile.isPending) return;

    try {
      await createProfile.mutateAsync(normalized);
      router.replace(getPostAuthRoute(intent));
    } catch {
      // Mutation state renders the error.
    }
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      <View style={styles.content}>
        <Text style={styles.eyebrow}>ONEPICK</Text>
        <Text style={styles.title}>사용자명만{ '\n' }정하면 끝이에요</Text>
        <Text style={styles.subtitle}>프로필에서 보일 고유한 이름입니다. 나중에 수정할 수 있어요.</Text>

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

        {!isLoading && user ? (
          <>
            <View style={styles.inputHeader}>
              <Text style={styles.label}>사용자명</Text>
              <Text style={styles.counter}>{normalized.length}/20</Text>
            </View>
            <TextInput
              autoCapitalize="none"
              autoCorrect={false}
              maxLength={20}
              onChangeText={setUsername}
              placeholder="onepick_user"
              placeholderTextColor="#AAA39C"
              style={styles.input}
              value={username}
            />
            <Text style={styles.helper}>영문 소문자, 숫자, 밑줄(_)만 사용할 수 있어요.</Text>

            {createProfile.isError ? (
              <View style={styles.errorBox}>
                <Text style={styles.errorText}>{getMessage(createProfile.error)}</Text>
              </View>
            ) : null}

            <Pressable
              disabled={!valid || createProfile.isPending}
              onPress={() => void handleSave()}
              style={({ pressed }) => [styles.primaryButton, (!valid || createProfile.isPending) && styles.disabled, pressed && valid && styles.pressed]}>
              <Text style={styles.primaryButtonText}>{createProfile.isPending ? '사용자명 저장 중...' : '이 사용자명으로 시작'}</Text>
            </Pressable>
          </>
        ) : null}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#FAF8F5' },
  content: { flex: 1, width: '100%', maxWidth: 640, alignSelf: 'center', paddingHorizontal: 24, paddingTop: 62 },
  eyebrow: { color: '#D96D4B', fontSize: 12, fontWeight: '800', letterSpacing: 2.8 },
  title: { color: '#202124', fontSize: 31, lineHeight: 38, fontWeight: '800', letterSpacing: -0.8, marginTop: 10 },
  subtitle: { color: '#8E8A85', fontSize: 14, lineHeight: 21, marginTop: 13, maxWidth: 380 },
  statusText: { color: '#8E8A85', fontSize: 13, marginTop: 34 },
  inputHeader: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 34, marginBottom: 10 },
  label: { color: '#202124', fontSize: 14, fontWeight: '800' },
  counter: { color: '#8E8A85', fontSize: 11 },
  input: { minHeight: 54, borderRadius: 16, backgroundColor: '#FFFFFF', paddingHorizontal: 16, color: '#202124', fontSize: 16 },
  helper: { color: '#8E8A85', fontSize: 11, marginTop: 8 },
  primaryButton: { minHeight: 54, borderRadius: 17, backgroundColor: '#D96D4B', alignItems: 'center', justifyContent: 'center', marginTop: 24 },
  primaryButtonText: { color: '#FFFFFF', fontSize: 15, fontWeight: '800' },
  errorBox: { backgroundColor: '#FFF0EB', borderRadius: 14, padding: 13, marginTop: 14 },
  errorText: { color: '#A9482D', fontSize: 12, lineHeight: 18, marginTop: 12 },
  disabled: { opacity: 0.4 },
  pressed: { opacity: 0.7 },
});
