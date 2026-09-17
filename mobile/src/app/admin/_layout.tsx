import { Redirect, Slot, usePathname } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AdminShell, adminStyles } from '@/components/admin/admin-shell';
import { beginKakaoAdminSignIn, checkAdminSession, signOutAdmin } from '@/lib/admin-api';

type AuthState = 'checking' | 'signedOut' | 'signedIn';

export default function AdminLayout() {
  const pathname = usePathname();
  const [authState, setAuthState] = useState<AuthState>('checking');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    checkAdminSession()
      .then((ok) => setAuthState(ok ? 'signedIn' : 'signedOut'))
      .catch((caught) => {
        setError(caught instanceof Error ? caught.message : '관리자 인증에 실패했습니다.');
        setAuthState('signedOut');
      });
  }, []);

  if (Platform.OS !== 'web') {
    return (
      <SafeAreaView style={styles.centered}>
        <View style={[adminStyles.card, styles.messageCard]}>
          <Text style={adminStyles.pageTitle}>OnePick Admin</Text>
          <Text style={adminStyles.pageDescription}>관리자 화면은 현재 데스크톱 웹에서 운영하도록 구성되어 있습니다.</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (authState === 'checking') {
    return (
      <SafeAreaView style={styles.centered}>
        <ActivityIndicator />
        <Text style={styles.checkingText}>관리자 권한을 확인하고 있습니다.</Text>
      </SafeAreaView>
    );
  }

  if (authState === 'signedOut') {
    const submit = () => {
      setSubmitting(true);
      setError('');
      try {
        beginKakaoAdminSignIn();
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : '카카오 로그인을 시작하지 못했습니다.');
        setSubmitting(false);
      }
    };

    return (
      <SafeAreaView style={styles.loginPage}>
        <View style={styles.loginCard}>
          <Text style={styles.logo}>OnePick</Text>
          <Text style={styles.adminLabel}>ADMIN</Text>
          <Text style={styles.loginTitle}>관리자 로그인</Text>
          <Text style={styles.loginDescription}>관리자 allowlist에 등록된 카카오 계정만 접근할 수 있습니다.</Text>

          {!!error && <Text accessibilityRole="alert" style={[adminStyles.error, { marginBottom: 14 }]}>{error}</Text>}

          <Pressable
            accessibilityRole="button"
            disabled={submitting}
            onPress={submit}
            style={[styles.kakaoButton, submitting && { opacity: 0.55 }]}
          >
            <Text style={styles.kakaoButtonText}>{submitting ? '카카오로 이동 중...' : '카카오로 관리자 로그인'}</Text>
          </Pressable>

          <Text style={styles.loginHint}>로그인 후 Supabase에서 관리자 권한을 다시 확인합니다.</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (pathname === '/admin') {
    return <Redirect href="/admin/dashboard" />;
  }

  return (
    <AdminShell onSignOut={() => {
      signOutAdmin();
      setAuthState('signedOut');
    }}>
      <Slot />
    </AdminShell>
  );
}

const styles = StyleSheet.create({
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#F8F9FB', padding: 24 },
  checkingText: { marginTop: 12, color: '#6B7280', fontSize: 13 },
  messageCard: { width: '100%', maxWidth: 520 },
  loginPage: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#F8F9FB', padding: 24 },
  loginCard: { width: '100%', maxWidth: 420, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#E5E7EB', borderRadius: 14, padding: 28 },
  logo: { color: '#111827', fontSize: 25, fontWeight: '900', letterSpacing: -1 },
  adminLabel: { marginTop: 3, color: '#9CA3AF', fontSize: 10, fontWeight: '800', letterSpacing: 2.4 },
  loginTitle: { marginTop: 34, color: '#111827', fontSize: 23, fontWeight: '800' },
  loginDescription: { marginTop: 8, marginBottom: 24, color: '#6B7280', fontSize: 13, lineHeight: 20 },
  kakaoButton: { minHeight: 46, borderRadius: 9, alignItems: 'center', justifyContent: 'center', backgroundColor: '#FEE500', paddingHorizontal: 16 },
  kakaoButtonText: { color: '#191919', fontSize: 14, fontWeight: '700' },
  loginHint: { marginTop: 14, color: '#9CA3AF', fontSize: 11, lineHeight: 17, textAlign: 'center' },
});
