import * as Linking from 'expo-linking';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useCompleteOAuth } from '@/hooks/useCompleteOAuth';

export default function AuthCallbackScreen() {
  const router = useRouter();
  const url = Linking.useURL();
  const params = useLocalSearchParams<{
    action?: string;
    productId?: string;
    categoryId?: string;
  }>();
  const completeOAuth = useCompleteOAuth();
  const handled = useRef(false);

  useEffect(() => {
    if (!url || handled.current) return;
    handled.current = true;

    void completeOAuth
      .mutateAsync(url)
      .then((result) => {
        if (!result) {
          router.replace('/');
          return;
        }

        const nextParams = {
          action: params.action ?? 'choose_pick',
          productId: params.productId ?? '',
          categoryId: params.categoryId ?? '',
        };

        if (!result.profile) {
          router.replace({ pathname: '/auth/username', params: nextParams });
          return;
        }

        if (nextParams.action === 'choose_pick' && nextParams.productId && nextParams.categoryId) {
          router.replace({
            pathname: '/pick/choose',
            params: {
              productId: nextParams.productId,
              categoryId: nextParams.categoryId,
            },
          });
          return;
        }

        router.replace('/');
      })
      .catch(() => {
        // Mutation state below renders the callback failure.
      });
  }, [completeOAuth, params.action, params.categoryId, params.productId, router, url]);

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      <View style={styles.content}>
        {completeOAuth.isError ? (
          <>
            <Text style={styles.title}>로그인을 완료하지 못했어요</Text>
            <Text style={styles.subtitle}>앱으로 돌아가 다시 로그인해주세요.</Text>
          </>
        ) : (
          <>
            <ActivityIndicator />
            <Text style={styles.title}>로그인을 마무리하고 있어요</Text>
            <Text style={styles.subtitle}>잠시 후 원래 원픽 화면으로 돌아갑니다.</Text>
          </>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#FAF8F5' },
  content: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 28 },
  title: { color: '#202124', fontSize: 20, fontWeight: '800', marginTop: 18, textAlign: 'center' },
  subtitle: { color: '#8E8A85', fontSize: 13, lineHeight: 20, textAlign: 'center', marginTop: 9 },
});
