import { useRouter } from 'expo-router';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { useAdminAccess } from '@/hooks/useAdmin';
import { useAuthSession } from '@/hooks/useAuthSession';
import { useSignOut } from '@/hooks/useSignOut';

export function SignOutButton() {
  const router = useRouter();
  const { user } = useAuthSession();
  const adminAccess = useAdminAccess(user?.id);
  const signOut = useSignOut();

  return (
    <View style={styles.container}>
      <Pressable
        accessibilityRole="button"
        onPress={() => router.push('/settings')}
        style={({ pressed }) => [styles.settingsButton, pressed && styles.muted]}>
        <Text style={styles.settingsLabel}>계정 설정 · 차단 관리</Text>
      </Pressable>
      {adminAccess.data === true ? (
        <>
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push('/admin/audit')}
            style={({ pressed }) => [styles.adminButton, pressed && styles.muted]}>
            <Text style={styles.adminLabel}>운영 현황 · 감사 로그</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push('/admin/reports')}
            style={({ pressed }) => [styles.adminButton, pressed && styles.muted]}>
            <Text style={styles.adminLabel}>신고 관리</Text>
          </Pressable>
        </>
      ) : null}
      <Pressable
        accessibilityRole="button"
        disabled={signOut.isPending}
        onPress={() => { if (!signOut.isPending) signOut.mutate(); }}
        style={({ pressed }) => [styles.button, (pressed || signOut.isPending) && styles.muted]}>
        {signOut.isPending ? <ActivityIndicator /> : <Text style={styles.label}>이 기기에서 로그아웃</Text>}
      </Pressable>
      {signOut.isError ? (
        <Text accessibilityRole="alert" style={styles.error}>로그아웃하지 못했어요. 연결 상태를 확인하고 다시 시도해주세요.</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { marginTop: 24, alignSelf: 'stretch', gap: 10 },
  settingsButton: { minHeight: 48, borderRadius: 15, backgroundColor: '#ECEEF3', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 18 },
  settingsLabel: { color: '#202124', fontSize: 13, fontWeight: '800' },
  adminButton: { minHeight: 48, borderRadius: 15, backgroundColor: '#252B38', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 18 },
  adminLabel: { color: '#FFFFFF', fontSize: 13, fontWeight: '800' },
  button: { minHeight: 48, borderRadius: 15, borderWidth: 1, borderColor: '#E3E5EA', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 18 },
  label: { color: '#5F6470', fontSize: 13, fontWeight: '700' },
  error: { color: '#A9482D', fontSize: 12, lineHeight: 18, textAlign: 'center', marginTop: 8 },
  muted: { opacity: 0.5 },
});
