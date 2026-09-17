import { Slot } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AdminShell, adminStyles } from '@/components/admin/admin-shell';
import { checkAdminSession, signInAdmin, signOutAdmin } from '@/lib/admin-api';

type AuthState = 'checking' | 'signedOut' | 'signedIn';

export default function AdminLayout() {
  const [authState, setAuthState] = useState<AuthState>('checking');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    checkAdminSession().then((ok) => setAuthState(ok ? 'signedIn' : 'signedOut'));
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
    const submit = async () => {
      if (!email.trim() || !password) {
        setError('이메일과 비밀번호를 입력해 주세요.');
        return;
      }
      setSubmitting(true);
      setError('');
      try {
        await signInAdmin(email.trim(), password);
        setPassword('');
        setAuthState('signedIn');
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : '로그인에 실패했습니다.');
      } finally {
        setSubmitting(false);
      }
    };

    return (
      <SafeAreaView style={styles.loginPage}>
        <View style={styles.loginCard}>
          <Text style={styles.logo}>OnePick</Text>
          <Text style={styles.adminLabel}>ADMIN</Text>
          <Text style={styles.loginTitle}>관리자 로그인</Text>
          <Text style={styles.loginDescription}>Supabase 관리자 allowlist에 등록된 계정만 접근할 수 있습니다.</Text>

          <Text style={adminStyles.label}>이메일</Text>
          <TextInput
            accessibilityLabel="관리자 이메일"
            autoCapitalize="none"
            autoComplete="email"
            keyboardType="email-address"
            value={email}
            onChangeText={setEmail}
            style={adminStyles.input}
            placeholder="admin@example.com"
          />

          <Text style={[adminStyles.label, { marginTop: 16 }]}>비밀번호</Text>
          <TextInput
            accessibilityLabel="관리자 비밀번호"
            autoCapitalize="none"
            secureTextEntry
            value={password}
            onChangeText={setPassword}
            onSubmitEditing={submit}
            style={adminStyles.input}
            placeholder="비밀번호"
          />

          {!!error && <Text accessibilityRole="alert" style={[adminStyles.error, { marginTop: 14 }]}>{error}</Text>}

          <Pressable disabled={submitting} onPress={submit} style={[adminStyles.primaryButton, { marginTop: 22 }, submitting && { opacity: 0.5 }]}>
            <Text style={adminStyles.primaryButtonText}>{submitting ? '확인 중...' : '로그인'}</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
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
});
