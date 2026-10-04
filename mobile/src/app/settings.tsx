import { useRouter } from 'expo-router';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppError } from '@/errors/appError';
import { useAdminAccess } from '@/hooks/useAdmin';
import { useAuthSession } from '@/hooks/useAuthSession';
import { useDeleteAccount } from '@/hooks/useDeleteAccount';
import { useNotificationPreferences, useSetFolloweePickChange } from '@/hooks/useNotifications';
import { useSignOut } from '@/hooks/useSignOut';
import { StateCard } from '@/components/ui';
import { OnePick, OnePickFeatures, OnePickSpace, OnePickType } from '@/constants/onepick';
import { confirmAction } from '@/lib/confirmAction';

function deletionError(error: unknown) {
  if (error instanceof AppError && error.code === 'ACCOUNT_DELETE_FAILED') {
    return '계정을 삭제하지 못했습니다. 다시 시도해주세요.';
  }
  return '계정을 삭제하지 못했습니다. 네트워크 상태를 확인하고 다시 시도해주세요.';
}

/** Figma 68-2: ‹ 설정 → 알림 · 안전 및 안내 · 계정 rows. */
export default function SettingsScreen() {
  const router = useRouter();
  const { user, isLoading } = useAuthSession();
  const adminAccess = useAdminAccess(user?.id);
  const deleteAccount = useDeleteAccount();
  const signOut = useSignOut();
  const preferences = useNotificationPreferences(OnePickFeatures.followNotifications ? user?.id : undefined);
  const setFolloweePickChange = useSetFolloweePickChange(OnePickFeatures.followNotifications ? user?.id : undefined);

  // Sign-out and account deletion each pass one confirmation (Figma 68 rule).
  const handleSignOut = async () => {
    if (signOut.isPending) return;
    if (!await confirmAction('모든 기기에서 로그아웃할까요?', '이 기기를 포함해 로그인한 모든 기기에서 로그아웃돼요.', '로그아웃')) return;
    signOut.mutate();
  };

  const handleDeleteAccount = async () => {
    if (deleteAccount.isPending) return;
    const confirmed = await confirmAction(
      '계정을 삭제할까요?',
      '내 프로필, 원픽 기록, 댓글과 차단 정보가 삭제됩니다. 이미 승인되어 정식 등록된 정보는 서비스 데이터로 유지될 수 있지만 내 계정과의 연결은 제거됩니다. 계정 삭제는 되돌릴 수 없습니다.',
      '계정 삭제',
      true,
    );
    if (!confirmed) return;
    try {
      await deleteAccount.mutateAsync();
      router.replace('/');
    } catch {
      // Mutation state renders the failure under the row.
    }
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <Pressable accessibilityRole="button" accessibilityLabel="뒤로" onPress={() => router.canGoBack() ? router.back() : router.replace('/')} style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}>
          <Text style={styles.backText}>‹</Text>
        </Pressable>
        <Text accessibilityRole="header" style={styles.title}>설정</Text>
        <View style={styles.backButton} />
      </View>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {isLoading ? <StateCard loading title="로그인 상태를 확인하고 있어요." /> : null}

        {!isLoading && !user ? (
          <StateCard title="로그인이 필요해요." text="차단 목록과 계정 설정은 로그인 후 관리할 수 있습니다."
            action={{ label: '로그인', variant: 'primary', onPress: () => router.push('/auth/login') }} />
        ) : null}

        {user ? (
          <>
            {OnePickFeatures.followNotifications ? <>
            <Text style={styles.sectionLabel}>알림</Text>
            <View style={styles.switchRow}>
              <View style={styles.switchCopy}>
                <Text style={styles.rowText}>팔로우한 사람의 원픽 변경</Text>
                <Text style={styles.caption}>팔로우한 사람이 원픽을 새로 고르거나 바꾸면 알림에 표시합니다. 한줄평만 고친 경우는 알리지 않아요.</Text>
              </View>
              <Switch
                accessibilityLabel="팔로우한 사람의 원픽 변경 알림"
                value={preferences.data?.followeePickChange ?? true}
                disabled={preferences.isPending || setFolloweePickChange.isPending}
                onValueChange={(value) => setFolloweePickChange.mutate(value)}
                trackColor={{ true: OnePick.actionPrimary, false: OnePick.borderDefault }}
              />
            </View>
            {preferences.isError ? <Text style={styles.error}>알림 설정을 불러오지 못했어요. 기본값(켜짐)으로 동작합니다.</Text> : null}
            {setFolloweePickChange.isError ? <Text style={styles.error}>알림 설정을 저장하지 못했어요. 다시 시도해주세요.</Text> : null}
            <View style={styles.sectionGap} />
            </> : null}

            <Text style={styles.sectionLabel}>안전 및 안내</Text>
            <SettingsRow label="차단한 사용자" onPress={() => router.push('/blocked-users')} />
            <SettingsRow label="개인정보 YouTube API 안내" link onPress={() => router.push('/legal/privacy')} />
            <SettingsRow label="YouTube API 이용조건" link onPress={() => router.push('/legal/terms')} />
            <View style={styles.sectionGap} />

            <Text style={styles.sectionLabel}>계정</Text>
            <SettingsRow label="모든 기기에서 로그아웃" pending={signOut.isPending} onPress={() => void handleSignOut()} />
            {signOut.isError ? <Text accessibilityRole="alert" style={styles.error}>로그아웃하지 못했어요. 연결 상태를 확인하고 다시 시도해주세요.</Text> : null}
            <SettingsRow label="계정 삭제" danger pending={deleteAccount.isPending} onPress={() => void handleDeleteAccount()} />
            {deleteAccount.isError ? <Text accessibilityRole="alert" style={styles.error}>{deletionError(deleteAccount.error)}</Text> : null}

            {/* Admins only: the console links that used to sit under the profile's sign-out button. */}
            {adminAccess.data === true ? <>
              <View style={styles.sectionGap} />
              <Text style={styles.sectionLabel}>관리자</Text>
              <SettingsRow label="운영 현황 · 감사 로그" onPress={() => router.push({ pathname: '/admin/data', params: { tab: 'audit' } })} />
              <SettingsRow label="신고 관리" onPress={() => router.push({ pathname: '/admin/data', params: { tab: 'reports' } })} />
            </> : null}
          </>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

function SettingsRow({ label, onPress, danger, link, pending }: { label: string; onPress: () => void; danger?: boolean; link?: boolean; pending?: boolean }) {
  return (
    <Pressable accessibilityRole={link ? 'link' : 'button'} accessibilityLabel={label} disabled={pending} onPress={onPress}
      style={({ pressed }) => [styles.row, (pressed || pending) && styles.pressed]}>
      <Text style={[styles.rowText, danger && styles.dangerText]}>{label}</Text>
      {pending ? <ActivityIndicator /> : <Text style={styles.chevron}>›</Text>}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: OnePick.bgDefault },
  header: {
    width: '100%',
    maxWidth: OnePick.maxWidth,
    alignSelf: 'center',
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: OnePickSpace.sm,
  },
  backButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  backText: { ...OnePickType.pageTitle, color: OnePick.textPrimary },
  title: { ...OnePickType.headline, flex: 1, textAlign: 'center', color: OnePick.textPrimary },
  content: {
    width: '100%',
    maxWidth: OnePick.maxWidth,
    alignSelf: 'center',
    paddingHorizontal: OnePickSpace.gutter,
    paddingTop: OnePickSpace.lg,
    paddingBottom: OnePickSpace.xxxl + OnePickSpace.lg,
  },
  sectionLabel: {
    ...OnePickType.captionMedium,
    color: OnePick.textPrimary,
    paddingBottom: OnePickSpace.sm,
    borderBottomWidth: 1,
    borderBottomColor: OnePick.borderDefault,
  },
  sectionGap: { height: OnePickSpace.xl },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: OnePickSpace.md, paddingVertical: OnePickSpace.md },
  switchCopy: { flex: 1, minWidth: 0 },
  row: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: OnePickSpace.md,
  },
  rowText: { ...OnePickType.body, color: OnePick.textPrimary },
  dangerText: { color: OnePick.textDanger },
  caption: { ...OnePickType.caption, color: OnePick.textSecondary, marginTop: OnePickSpace.xs },
  chevron: { ...OnePickType.body, color: OnePick.textTertiary },
  error: { ...OnePickType.body, color: OnePick.textDanger, marginBottom: OnePickSpace.sm },
  pressed: { opacity: 0.7 },
});
