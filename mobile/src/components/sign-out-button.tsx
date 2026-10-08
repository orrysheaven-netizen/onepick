import { useRouter } from 'expo-router';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { useAdminAccess } from '@/hooks/useAdmin';
import { useAuthSession } from '@/hooks/useAuthSession';
import { useSignOut } from '@/hooks/useSignOut';
import { OnePick } from '@/constants/onepick';

export function SignOutButton({ showSettingsLink = true }: { showSettingsLink?: boolean } = {}) {
  const router = useRouter();
  const { user } = useAuthSession();
  const adminAccess = useAdminAccess(user?.id);
  const signOut = useSignOut();

  return (
    <View style={styles.container}>
      {showSettingsLink ? <Pressable
        accessibilityRole="button"
        onPress={() => router.push('/settings')}
        style={({ pressed }) => [styles.settingsButton, pressed && styles.muted]}>
        <Text style={styles.settingsLabel}>계정 설정 · 차단 관리</Text>
      </Pressable> : null}
      {adminAccess.data === true ? (
        <>
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push({ pathname: '/admin/data', params: { tab: 'audit' } })}
            style={({ pressed }) => [styles.adminButton, pressed && styles.muted]}>
            <Text style={styles.adminLabel}>운영 현황 · 감사 로그</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push({ pathname: '/admin/data', params: { tab: 'reports' } })}
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
        {signOut.isPending ? <ActivityIndicator /> : <Text style={styles.label}>모든 기기에서 로그아웃하기</Text>}
      </Pressable>
      {signOut.isError ? (
        <Text accessibilityRole="alert" style={styles.error}>로그아웃하지 못했어요. 연결 상태를 확인하고 다시 시도해주세요.</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { marginTop: 24, alignSelf: 'stretch', gap: 10 },
  settingsButton: { minHeight: 48, borderRadius: 15, backgroundColor: OnePick.sunken, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 18 },
  settingsLabel: { color: OnePick.text, fontSize: 13, fontWeight: '800' },
  adminButton: { minHeight: 48, borderRadius: 15, backgroundColor: OnePick.text, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 18 },
  adminLabel: { color: OnePick.onAccent, fontSize: 13, fontWeight: '800' },
  button: { minHeight: 48, borderRadius: 15, borderWidth: 1, borderColor: OnePick.border, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 18 },
  label: { color: OnePick.muted, fontSize: 13, fontWeight: '700' },
  error: { color: OnePick.danger, fontSize: 12, lineHeight: 18, textAlign: 'center', marginTop: 8 },
  muted: { opacity: 0.5 },
});
