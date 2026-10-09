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
import { OnePick, OnePickRadius, OnePickSpace, OnePickType } from '@/constants/onepick';
import type { SocialAuthProvider } from '@/types/domain/auth';
import { Icon } from '@/components/ui';

const PROVIDER_LABEL: Record<SocialAuthProvider, string> = {
  kakao: '카카오',
  apple: 'Apple',
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
        <Pressable accessibilityRole="button" accessibilityLabel="뒤로 가기"
          onPress={() => router.canGoBack() ? router.back() : router.replace('/')} style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}>
          <Icon name="back" />
        </Pressable>

        <View style={styles.brand}><OnePickBrand /></View>
        <Text accessibilityRole="header" style={styles.title}>로그인하고 계속하기</Text>

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
            accessibilityLabel="Apple로 계속하기"
            disabled={socialSignIn.isPending}
            onPress={() => void handleProvider('apple')}
            style={({ pressed }) => [styles.providerButton, styles.appleButton, pressed && styles.pressed, socialSignIn.isPending && styles.disabled]}>
            <Text style={styles.appleButtonText}>{socialSignIn.isPending && activeProvider === 'apple' ? 'Apple 로그인 중...' : 'Apple로 계속하기'}</Text>
          </Pressable>
        </View>

        {socialSignIn.isError ? (
          <View style={styles.errorBox}>
            <Text accessibilityRole="alert" style={styles.errorText}>{getMessage(socialSignIn.error, activeProvider)}</Text>
          </View>
        ) : null}
        {socialSignIn.isSuccess && !socialSignIn.data ? (
          <Text accessibilityLiveRegion="polite" style={styles.note}>{Platform.OS === 'web' ? `${pendingLabel} 로그인 화면으로 이동해요.` : '로그인을 취소했어요. 준비되면 다시 시작해주세요.'}</Text>
        ) : null}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: OnePick.bgDefault },
  content: { flex: 1, width: '100%', maxWidth: OnePick.maxWidth, alignSelf: 'center', paddingHorizontal: OnePickSpace.gutter },
  backButton: { width: 44, height: 56, justifyContent: 'center' },
  brand: { marginTop: 10 },
  title: { ...OnePickType.pageTitle, color: OnePick.textPrimary, marginTop: 24 },
  providerStack: { gap: OnePickSpace.md, marginTop: OnePickSpace.xxl },
  providerButton: { minHeight: 52, borderRadius: OnePickRadius.md, alignItems: 'center', justifyContent: 'center', paddingHorizontal: OnePickSpace.lg },
  kakaoButton: { backgroundColor: OnePick.kakao },
  kakaoButtonText: { ...OnePickType.bodyMedium, color: OnePick.kakaoText },
  appleButton: { backgroundColor: OnePick.apple },
  appleButtonText: { ...OnePickType.bodyMedium, color: OnePick.appleText },
  errorBox: { backgroundColor: OnePick.dangerSoft, borderRadius: OnePickRadius.md, padding: 14, marginTop: OnePickSpace.lg },
  errorText: { ...OnePickType.caption, color: OnePick.textDanger },
  note: { ...OnePickType.caption, color: OnePick.textSecondary, textAlign: 'center', marginTop: OnePickSpace.lg },
  disabled: { opacity: 0.55 },
  pressed: { opacity: 0.7 },
});
