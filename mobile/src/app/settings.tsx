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
import { OnePick, OnePickFeatures } from '@/constants/onepick';

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
        <Pressable onPress={() => router.back()} style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}>
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
                  trackColor={{ true: OnePick.accent, false: OnePick.border }}
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
  safeArea: { flex: 1, backgroundColor: OnePick.background },
  content: { width: '100%', maxWidth: OnePick.maxWidth, alignSelf: 'center', paddingHorizontal: 20, paddingBottom: 48 },
  backButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', marginTop: 5, marginLeft: -10 },
  backText: { color: OnePick.text, fontSize: 36, lineHeight: 38, fontWeight: '300' },
  title: { color: OnePick.text, fontSize: 26, lineHeight: 34, fontWeight: '800', letterSpacing: -0.6, marginTop: 4, marginBottom: 16 },
  sectionLabel: { color: OnePick.muted, fontSize: 13, lineHeight: 18, fontWeight: '600', marginTop: 12, marginBottom: 8, paddingLeft: 4 },
  inlineLoading: { marginTop: 14 },
  card: { borderWidth: 1, borderColor: OnePick.border, backgroundColor: OnePick.surface, borderRadius: 20, padding: 16, marginBottom: 8 },
  cardTitle: { color: OnePick.text, fontSize: 15, lineHeight: 22, fontWeight: '700' },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  switchCopy: { flex: 1, minWidth: 0 },
  switchLabel: { color: OnePick.text, fontSize: 15, lineHeight: 22, fontWeight: '600' },
  body: { color: OnePick.muted, fontSize: 13, lineHeight: 18, marginTop: 6 },
  empty: { color: OnePick.muted, fontSize: 13, lineHeight: 18, paddingVertical: 8 },
  blockRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: OnePick.border },
  blockName: { flex: 1, color: OnePick.text, fontSize: 15, lineHeight: 22, fontWeight: '600' },
  actionRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 10, marginTop: 12, marginLeft: -8 },
  inlineAction: { alignSelf: 'flex-start', marginLeft: -8 },
  linkRow: { minHeight: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  linkRowDivider: { borderBottomWidth: 1, borderBottomColor: OnePick.hairline },
  linkText: { color: OnePick.text, fontSize: 15, lineHeight: 22, fontWeight: '600' },
  chevron: { color: OnePick.hint, fontSize: 22, lineHeight: 24 },
  signOut: { alignItems: 'center', marginTop: 20 },
  deleteButton: { minHeight: 40, alignItems: 'center', justifyContent: 'center', backgroundColor: OnePick.danger, borderRadius: 999, paddingHorizontal: 14, marginLeft: 8 },
  deleteButtonText: { color: OnePick.onAccent, fontSize: 13, lineHeight: 18, fontWeight: '700' },
  confirmText: { color: OnePick.danger, fontSize: 13, lineHeight: 18, fontWeight: '600', marginTop: 10 },
  error: { color: OnePick.danger, fontSize: 13, lineHeight: 18, marginTop: 10 },
  pressed: { opacity: 0.7 },
});
