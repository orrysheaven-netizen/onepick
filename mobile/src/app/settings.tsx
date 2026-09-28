import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppError } from '@/errors/appError';
import { useAuthSession } from '@/hooks/useAuthSession';
import { useBlockedUsers, useSafetyActions } from '@/hooks/useSafety';
import { useDeleteAccount } from '@/hooks/useDeleteAccount';
import { useNotificationPreferences, useSetFolloweePickChange } from '@/hooks/useNotifications';
import { SignOutButton } from '@/components/sign-out-button';
import { Button, StateCard } from '@/components/ui';
import { OnePick, OnePickFeatures, OnePickRadius, OnePickSpace, OnePickType } from '@/constants/onepick';

function deletionError(error: unknown) {
  if (error instanceof AppError && error.code === 'ACCOUNT_DELETE_FAILED') {
    return '계정을 삭제하지 못했습니다. 다시 시도해주세요.';
  }
  return '계정을 삭제하지 못했습니다. 네트워크 상태를 확인하고 다시 시도해주세요.';
}

export default function SettingsScreen() {
  const router = useRouter();
  const { user, isLoading } = useAuthSession();
  const blocked = useBlockedUsers(user?.id);
  const safety = useSafetyActions();
  const deleteAccount = useDeleteAccount();
  const preferences = useNotificationPreferences(OnePickFeatures.follow ? user?.id : undefined);
  const setFolloweePickChange = useSetFolloweePickChange(OnePickFeatures.follow ? user?.id : undefined);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const handleDeleteAccount = async () => {
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }

    try {
      await deleteAccount.mutateAsync();
      router.replace('/');
    } catch {
      // Mutation state renders the failure. Keep confirmation visible for retry.
    }
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Pressable onPress={() => router.canGoBack() ? router.back() : router.replace('/')} style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}>
          <Text style={styles.backText}>‹</Text>
        </Pressable>
        <Text style={styles.title}>설정</Text>

        {isLoading ? <StateCard loading title="로그인 상태를 확인하고 있어요" /> : null}

        {!isLoading && !user ? (
          <StateCard title="로그인이 필요해요" text="차단 목록과 계정 설정은 로그인 후 관리할 수 있습니다."
            action={{ label: '로그인', variant: 'primary', onPress: () => router.push('/auth/login') }} />
        ) : null}

        {user ? (
          <>
            {OnePickFeatures.follow ? <>
            <Text style={styles.sectionLabel}>알림</Text>
            <View style={styles.card}>
              <View style={styles.switchRow}>
                <View style={styles.switchCopy}>
                  <Text style={styles.switchLabel}>팔로우한 사람의 원픽 변경</Text>
                  <Text style={styles.body}>팔로우한 사람이 원픽을 새로 고르거나 바꾸면 알림에 표시합니다. 한줄평만 고친 경우는 알리지 않아요.</Text>
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
            </View>
            </> : null}

            <Text style={styles.sectionLabel}>차단한 사용자</Text>
            <View style={styles.card}>
              {blocked.isPending ? <ActivityIndicator style={styles.inlineLoading} /> : null}
              {blocked.isError ? (
                <Button variant="ghost" size="sm" style={styles.inlineAction} label="차단 목록 다시 불러오기" onPress={() => void blocked.refetch()} />
              ) : null}
              {blocked.data?.length === 0 ? <Text style={styles.empty}>차단한 사용자가 없습니다.</Text> : null}
              {blocked.data?.map((item) => (
                <View key={item.blockedUserId} style={styles.blockRow}>
                  <Text style={styles.blockName}>{item.blockedUsername ? `@${item.blockedUsername}` : '비공개 사용자'}</Text>
                  <Button variant="secondary" size="sm" label="차단 해제" disabled={safety.unblockUser.isPending}
                    onPress={() => void safety.unblockUser.mutateAsync({
                      blockerUserId: user.id,
                      blockedUserId: item.blockedUserId,
                    }).catch(() => undefined)} />
                </View>
              ))}
              {safety.unblockUser.isError ? <Text accessibilityRole="alert" style={styles.error}>차단을 해제하지 못했어요. 연결 상태를 확인하고 다시 시도해주세요.</Text> : null}
              <Text style={styles.body}>차단하면 서로의 프로필, 원픽, 댓글이 로그인 상태에서 보이지 않습니다.</Text>
            </View>

            <Text style={styles.sectionLabel}>안내</Text>
            <View style={styles.card}>
              <Pressable accessibilityRole="link" onPress={() => router.push('/legal/privacy')} style={({ pressed }) => [styles.linkRow, styles.linkRowDivider, pressed && styles.pressed]}>
                <Text style={styles.linkText}>개인정보·YouTube API 안내</Text><Text style={styles.chevron}>›</Text>
              </Pressable>
              <Pressable accessibilityRole="link" onPress={() => router.push('/legal/terms')} style={({ pressed }) => [styles.linkRow, pressed && styles.pressed]}>
                <Text style={styles.linkText}>YouTube API 이용조건</Text><Text style={styles.chevron}>›</Text>
              </Pressable>
            </View>

            <Text style={styles.sectionLabel}>계정</Text>
            <View style={styles.card}>
              <Text style={styles.cardTitle}>계정 삭제</Text>
              <Text style={styles.body}>
                내 프로필, 원픽 기록, 댓글과 차단 정보가 삭제됩니다. 이미 승인되어 정식 등록된 정보는 서비스 데이터로 유지될 수 있지만 내 계정과의 연결은 제거됩니다.
              </Text>
              {confirmDelete ? (
                <Text style={styles.confirmText}>계정 삭제는 되돌릴 수 없습니다. 한 번 더 누르면 삭제합니다.</Text>
              ) : null}
              {deleteAccount.isError ? <Text style={styles.error}>{deletionError(deleteAccount.error)}</Text> : null}
              <View style={styles.actionRow}>
                {confirmDelete ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="계정 삭제 확인"
                    disabled={deleteAccount.isPending}
                    onPress={() => void handleDeleteAccount()}
                    style={({ pressed }) => [styles.deleteButton, pressed && styles.pressed]}>
                    {deleteAccount.isPending ? <ActivityIndicator color={OnePick.onAccent} /> : <Text style={styles.deleteButtonText}>계정 삭제 확인</Text>}
                  </Pressable>
                ) : (
                  <Button variant="danger" size="sm" label="계정 삭제" onPress={() => void handleDeleteAccount()} />
                )}
                {confirmDelete && !deleteAccount.isPending ? (
                  <Button variant="secondary" size="sm" label="취소" onPress={() => setConfirmDelete(false)} />
                ) : null}
              </View>
            </View>
            <View style={styles.signOut}><SignOutButton /></View>
          </>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: OnePick.bgDefault },
  content: {
    width: '100%',
    maxWidth: OnePick.maxWidth,
    alignSelf: 'center',
    paddingHorizontal: OnePickSpace.gutter,
    paddingBottom: OnePickSpace.xxxl + OnePickSpace.lg,
  },
  backButton: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: OnePickSpace.xs,
    marginLeft: -OnePickSpace.sm,
  },
  backText: { ...OnePickType.pageTitle, color: OnePick.textPrimary },
  title: {
    ...OnePickType.pageTitle,
    color: OnePick.textPrimary,
    marginTop: OnePickSpace.xs,
    marginBottom: OnePickSpace.lg,
  },
  sectionLabel: {
    ...OnePickType.captionMedium,
    color: OnePick.textSecondary,
    marginTop: OnePickSpace.md,
    marginBottom: OnePickSpace.sm,
    paddingLeft: OnePickSpace.xs,
  },
  inlineLoading: { marginTop: OnePickSpace.md },
  card: {
    borderWidth: 1,
    borderColor: OnePick.borderDefault,
    backgroundColor: OnePick.bgDefault,
    borderRadius: OnePickRadius.lg,
    padding: OnePickSpace.lg,
    marginBottom: OnePickSpace.sm,
  },
  cardTitle: { ...OnePickType.headline, color: OnePick.textPrimary },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: OnePickSpace.md },
  switchCopy: { flex: 1, minWidth: 0 },
  switchLabel: { ...OnePickType.bodyMedium, color: OnePick.textPrimary },
  body: { ...OnePickType.body, color: OnePick.textSecondary, marginTop: OnePickSpace.sm },
  empty: { ...OnePickType.body, color: OnePick.textSecondary, paddingVertical: OnePickSpace.sm },
  blockRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: OnePickSpace.md,
    paddingVertical: OnePickSpace.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: OnePick.borderDefault,
  },
  blockName: { ...OnePickType.bodyMedium, flex: 1, color: OnePick.textPrimary },
  actionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: OnePickSpace.sm,
    marginTop: OnePickSpace.md,
    marginLeft: -OnePickSpace.sm,
  },
  inlineAction: { alignSelf: 'flex-start', marginLeft: -OnePickSpace.sm },
  linkRow: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: OnePickSpace.md,
  },
  linkRowDivider: { borderBottomWidth: 1, borderBottomColor: OnePick.borderDefault },
  linkText: { ...OnePickType.bodyMedium, color: OnePick.textPrimary },
  chevron: { ...OnePickType.title, color: OnePick.textTertiary },
  signOut: { alignItems: 'center', marginTop: OnePickSpace.xl },
  deleteButton: {
    minHeight: 40,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: OnePick.textDanger,
    borderRadius: OnePickRadius.md,
    paddingHorizontal: OnePickSpace.md,
    marginLeft: OnePickSpace.sm,
  },
  deleteButtonText: { ...OnePickType.bodyMedium, color: OnePick.onAction },
  confirmText: { ...OnePickType.bodyMedium, color: OnePick.textDanger, marginTop: OnePickSpace.sm },
  error: { ...OnePickType.body, color: OnePick.textDanger, marginTop: OnePickSpace.sm },
  pressed: { opacity: 0.7 },
});
