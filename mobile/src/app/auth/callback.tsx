import * as Linking from 'expo-linking';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useCompleteOAuth } from '@/hooks/useCompleteOAuth';
import { getAuthIntent, getPostAuthRoute, type AuthReturnParams } from '@/lib/auth/authIntent';
import { observabilityService } from '@/services';
import { OnePick } from '@/constants/onepick';

export default function AuthCallbackScreen() {
  const router = useRouter();
  const url = Linking.useURL();
  const params = useLocalSearchParams<AuthReturnParams>();
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

        const intent = getAuthIntent(params);
        void observabilityService.captureProductEvent({
          eventName: 'auth_completed',
          source: intent.action,
          path: '/auth/callback',
        });
        router.replace(getPostAuthRoute(intent, result.profile === null));
      })
      .catch(() => {
        // Mutation state below renders the callback failure.
      });
  }, [completeOAuth, params, router, url]);

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      <View style={styles.content}>
        {completeOAuth.isError ? (
          <>
            <Text style={styles.title}>로그인을 완료하지 못했어요.</Text>
            <Text style={styles.subtitle}>다시 로그인하면 하려던 작업을 이어갈 수 있어요.</Text>
            <Pressable
              accessibilityRole="button"
              onPress={() => router.replace({ pathname: '/auth/login', params: { ...getAuthIntent(params) } })}
              style={styles.retryButton}>
              <Text style={styles.retryText}>다시 로그인하기</Text>
            </Pressable>
          </>
        ) : (
          <>
            <ActivityIndicator />
            <Text style={styles.title}>로그인을 마무리하고 있어요.</Text>
            <Text style={styles.subtitle}>잠시 후 하려던 작업으로 돌아가요.</Text>
          </>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: OnePick.background },
  content: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 28 },
  title: { color: OnePick.text, fontSize: 20, fontWeight: '800', marginTop: 18, textAlign: 'center' },
  subtitle: { color: OnePick.muted, fontSize: 13, lineHeight: 20, textAlign: 'center', marginTop: 9 },
  retryButton: { minHeight: 48, borderRadius: 15, backgroundColor: OnePick.text, paddingHorizontal: 20, alignItems: 'center', justifyContent: 'center', marginTop: 20 },
  retryText: { color: OnePick.onAccent, fontSize: 13, fontWeight: '800' },
});
