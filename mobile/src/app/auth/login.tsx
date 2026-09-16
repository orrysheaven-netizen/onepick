import * as Linking from 'expo-linking';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppError } from '@/errors/appError';
import { useKakaoSignIn } from '@/hooks/useKakaoSignIn';
import { getAuthIntent, getPostAuthRoute, type AuthReturnParams } from '@/lib/auth/authIntent';

function getMessage(error: unknown) {
  if (error instanceof AppError && error.code === 'AUTH_FAILED') {
    return '카카오 로그인을 완료하지 못했어요. 설정을 확인한 뒤 다시 시도해주세요.';
  }

  return '로그인 중 문제가 발생했어요. 다시 시도해주세요.';
}

export default function LoginScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<AuthReturnParams>();
  const intent = getAuthIntent(params);
  const kakaoSignIn = useKakaoSignIn();

  const handleKakao = async () => {
    if (kakaoSignIn.isPending) return;
    const redirectTo = Linking.createURL('auth/callback', {
      queryParams: { ...intent },
    });

    try {
      const result = await kakaoSignIn.mutateAsync(redirectTo);

      if (!result) return;
      router.replace(getPostAuthRoute(intent, !result.profile));
    } catch {
      // Mutation state renders the error. Avoid an unhandled mutateAsync rejection.
    }
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      <View style={styles.content}>
        <Pressable onPress={() => router.back()} style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}>
          <Text style={styles.backText}>‹</Text>
        </Pressable>

        <Text style={styles.eyebrow}>ONEPICK</Text>
        <Text style={styles.title}>로그인하고{ '\n' }원픽을 이어가세요</Text>
        <Text style={styles.subtitle}>
          {intent.action === 'choose_pick'
            ? '선택한 제품을 기억해두고 로그인 뒤 한줄평 화면으로 돌아옵니다.'
            : intent.action === 'comment_pick'
              ? '로그인 뒤 보고 있던 원픽으로 돌아가 댓글을 남길 수 있어요.'
              : '로그인하면 나의 원픽을 모으고 사람들과 선택을 나눌 수 있어요.'}
        </Text>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>간편 로그인</Text>
          <Pressable
            disabled={kakaoSignIn.isPending}
            onPress={() => void handleKakao()}
            style={({ pressed }) => [styles.kakaoButton, pressed && styles.pressed, kakaoSignIn.isPending && styles.disabled]}>
            <Text style={styles.kakaoButtonText}>{kakaoSignIn.isPending ? '카카오 로그인 중...' : '카카오로 계속하기'}</Text>
          </Pressable>

          {kakaoSignIn.isError ? (
            <View style={styles.errorBox}>
              <Text style={styles.errorText}>{getMessage(kakaoSignIn.error)}</Text>
            </View>
          ) : null}
          {kakaoSignIn.isSuccess && !kakaoSignIn.data ? <Text style={styles.note}>로그인을 취소했어요. 준비되면 다시 시작해주세요.</Text> : null}
        </View>

        <Text style={styles.note}>처음 로그인하면 사용할 사용자명만 정하면 됩니다.</Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#FAF8F5' },
  content: { flex: 1, width: '100%', maxWidth: 640, alignSelf: 'center', paddingHorizontal: 24 },
  backButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', marginLeft: -10, marginTop: 5 },
  backText: { color: '#202124', fontSize: 36, lineHeight: 38, fontWeight: '300' },
  eyebrow: { color: '#D96D4B', fontSize: 12, fontWeight: '800', letterSpacing: 2.8, marginTop: 36 },
  title: { color: '#202124', fontSize: 31, lineHeight: 38, fontWeight: '800', letterSpacing: -0.8, marginTop: 10 },
  subtitle: { color: '#8E8A85', fontSize: 14, lineHeight: 21, marginTop: 13, maxWidth: 380 },
  card: { backgroundColor: '#FFFFFF', borderRadius: 22, padding: 20, marginTop: 34 },
  cardTitle: { color: '#202124', fontSize: 15, fontWeight: '800' },
  kakaoButton: { minHeight: 54, borderRadius: 16, backgroundColor: '#FEE500', alignItems: 'center', justifyContent: 'center', marginTop: 16 },
  kakaoButtonText: { color: '#191919', fontSize: 15, fontWeight: '800' },
  errorBox: { backgroundColor: '#FFF0EB', borderRadius: 14, padding: 13, marginTop: 14 },
  errorText: { color: '#A9482D', fontSize: 12, lineHeight: 18 },
  note: { color: '#8E8A85', fontSize: 11, lineHeight: 17, textAlign: 'center', marginTop: 18 },
  disabled: { opacity: 0.55 },
  pressed: { opacity: 0.7 },
});
