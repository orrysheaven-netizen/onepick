import * as Linking from 'expo-linking';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppError } from '@/errors/appError';
import { useSocialSignIn } from '@/hooks/useSocialSignIn';
import { getAuthIntent, getPostAuthRoute, type AuthReturnParams } from '@/lib/auth/authIntent';
import { observabilityService } from '@/services';
import { OnePickBrand } from '@/components/onepick-brand';
import { OnePick } from '@/constants/onepick';
import type { SocialAuthProvider } from '@/types/domain/auth';

const PROVIDER_LABEL: Record<SocialAuthProvider, string> = {
  kakao: '카카오',
  google: 'Google',
  naver: '네이버',
};

function getMessage(error: unknown, provider: SocialAuthProvider | null) {
  if (error instanceof AppError && error.code === 'AUTH_FAILED') {
    return `${provider ? PROVIDER_LABEL[provider] : '소셜'} 로그인을 완료하지 못했어요. 설정을 확인한 뒤 다시 시도해주세요.`;
  }

  return '로그인 중 문제가 발생했어요. 다시 시도해주세요.';
}

export default function LoginScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<AuthReturnParams>();
  const intent = getAuthIntent(params);
  const socialSignIn = useSocialSignIn();
  const [activeProvider, setActiveProvider] = useState<SocialAuthProvider | null>(null);

  const handleProvider = async (provider: SocialAuthProvider) => {
    if (socialSignIn.isPending) return;
    setActiveProvider(provider);
    void observabilityService.captureProductEvent({
      eventName: 'auth_started',
      source: intent.action,
      path: '/auth/login',
    });
    const redirectTo = Linking.createURL('auth/callback', {
      queryParams: { ...intent },
    });

    try {
      const result = await socialSignIn.mutateAsync({ provider, redirectTo });

      if (!result) return;
      router.replace(getPostAuthRoute(intent, !result.profile));
    } catch {
      // Mutation state renders the error. Avoid an unhandled mutateAsync rejection.
    }
  };

  const pendingLabel = activeProvider ? PROVIDER_LABEL[activeProvider] : '소셜';

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      <View style={styles.content}>
        <Pressable onPress={() => router.back()} style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}>
          <Text style={styles.backText}>‹</Text>
        </Pressable>

        <View style={styles.brand}><OnePickBrand /></View>
        <Text style={styles.title}>로그인하고{ '\n' }원픽을 이어가세요</Text>
        <Text style={styles.subtitle}>
          {intent.action === 'request_item'
            ? '검색한 제품명과 카테고리를 기억해두고 로그인 뒤 제품 등록 요청을 이어갑니다.'
            : intent.action === 'register_pick'
              ? '로그인 뒤 사진을 올리고 나의 원픽을 직접 등록할 수 있어요.'
              : intent.action === 'choose_pick'
                ? '선택한 제품을 기억해두고 로그인 뒤 한줄평 화면으로 돌아옵니다.'
                : intent.action === 'choose_movie'
                  ? '선택한 영화를 기억해두고 로그인 뒤 원픽 등록을 이어갑니다.'
                  : intent.action === 'choose_book'
                    ? '선택한 책을 기억해두고 로그인 뒤 원픽 등록을 이어갑니다.'
                  : intent.action === 'comment_pick'
                    ? '로그인 뒤 보고 있던 원픽으로 돌아가 댓글을 남길 수 있어요.'
                    : '로그인하면 나의 원픽을 모으고 사람들과 선택을 나눌 수 있어요.'}
        </Text>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>간편 로그인</Text>
          <View style={styles.providerStack}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="카카오로 계속하기"
              disabled={socialSignIn.isPending}
              onPress={() => void handleProvider('kakao')}
              style={({ pressed }) => [styles.providerButton, styles.kakaoButton, pressed && styles.pressed, socialSignIn.isPending && styles.disabled]}>
              <Text style={styles.kakaoButtonText}>{socialSignIn.isPending && activeProvider === 'kakao' ? '카카오 로그인 중...' : '카카오로 계속하기'}</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Google로 계속하기"
              disabled={socialSignIn.isPending}
              onPress={() => void handleProvider('google')}
              style={({ pressed }) => [styles.providerButton, styles.googleButton, pressed && styles.pressed, socialSignIn.isPending && styles.disabled]}>
              <Text style={styles.googleButtonText}>{socialSignIn.isPending && activeProvider === 'google' ? 'Google 로그인 중...' : 'Google로 계속하기'}</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="네이버로 계속하기"
              disabled={socialSignIn.isPending}
              onPress={() => void handleProvider('naver')}
              style={({ pressed }) => [styles.providerButton, styles.naverButton, pressed && styles.pressed, socialSignIn.isPending && styles.disabled]}>
              <Text style={styles.naverButtonText}>{socialSignIn.isPending && activeProvider === 'naver' ? '네이버 로그인 중...' : '네이버로 계속하기'}</Text>
            </Pressable>
          </View>

          {socialSignIn.isError ? (
            <View style={styles.errorBox}>
              <Text style={styles.errorText}>{getMessage(socialSignIn.error, activeProvider)}</Text>
            </View>
          ) : null}
          {socialSignIn.isSuccess && !socialSignIn.data ? (
            <Text style={styles.note}>{Platform.OS === 'web' ? `${pendingLabel} 로그인 화면으로 이동합니다.` : '로그인을 취소했어요. 준비되면 다시 시작해주세요.'}</Text>
          ) : null}
        </View>

        <Text style={styles.note}>처음 로그인하면 사용할 사용자명만 정하면 됩니다. 기존 계정은 처음 사용한 로그인 방식을 계속 사용해주세요.</Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: OnePick.background },
  content: { flex: 1, width: '100%', maxWidth: OnePick.maxWidth, alignSelf: 'center', paddingHorizontal: 20 },
  backButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', marginLeft: -10, marginTop: 5 },
  backText: { color: OnePick.text, fontSize: 36, lineHeight: 38, fontWeight: '300' },
  brand: { marginTop: 28, marginBottom: 4 },
  title: { color: OnePick.text, fontSize: 26, lineHeight: 34, fontWeight: '800', letterSpacing: -0.6, marginTop: 10 },
  subtitle: { color: OnePick.muted, fontSize: 15, lineHeight: 22, marginTop: 12 },
  card: { borderWidth: 1, borderColor: OnePick.border, backgroundColor: OnePick.surface, borderRadius: 20, padding: 20, marginTop: 28 },
  cardTitle: { color: OnePick.text, fontSize: 15, lineHeight: 22, fontWeight: '700' },
  providerStack: { gap: 10, marginTop: 14 },
  providerButton: { minHeight: 52, borderRadius: 999, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16 },
  kakaoButton: { backgroundColor: OnePick.kakao },
  kakaoButtonText: { color: OnePick.kakaoText, fontSize: 15, fontWeight: '700' },
  googleButton: { backgroundColor: OnePick.google, borderWidth: 1, borderColor: OnePick.googleBorder },
  googleButtonText: { color: OnePick.googleText, fontSize: 15, fontWeight: '700' },
  naverButton: { backgroundColor: OnePick.naver },
  naverButtonText: { color: OnePick.naverText, fontSize: 15, fontWeight: '700' },
  errorBox: { backgroundColor: OnePick.dangerSoft, borderRadius: 12, padding: 14, marginTop: 14 },
  errorText: { color: OnePick.danger, fontSize: 13, lineHeight: 18 },
  note: { color: OnePick.muted, fontSize: 12, lineHeight: 16, textAlign: 'center', marginTop: 16 },
  disabled: { opacity: 0.55 },
  pressed: { opacity: 0.7 },
});
