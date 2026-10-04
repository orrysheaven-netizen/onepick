import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAuthSession } from '@/hooks/useAuthSession';
import { useBlockedUsers, useSafetyActions } from '@/hooks/useSafety';
import { Avatar, Button, StateCard } from '@/components/ui';
import { OnePick, OnePickRadius, OnePickSpace, OnePickType } from '@/constants/onepick';

/** Figma 68-3 / 68-4: 차단한 사용자 list, unblock toast and empty state. */
export default function BlockedUsersScreen() {
  const router = useRouter();
  const { user, isLoading } = useAuthSession();
  const blocked = useBlockedUsers(user?.id);
  const safety = useSafetyActions();
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 2600);
    return () => clearTimeout(timer);
  }, [toast]);

  const unblock = (blockedUserId: string, name: string) => {
    if (!user || safety.unblockUser.isPending) return;
    void safety.unblockUser.mutateAsync({ blockerUserId: user.id, blockedUserId })
      .then(() => setToast(`${name} 차단을 해제했어요.`))
      .catch(() => undefined);
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <Pressable accessibilityRole="button" accessibilityLabel="뒤로" onPress={() => router.canGoBack() ? router.back() : router.replace('/settings')} style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}>
          <Text style={styles.backText}>‹</Text>
        </Pressable>
        <Text accessibilityRole="header" style={styles.title}>차단한 사용자</Text>
        <View style={styles.backButton} />
      </View>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {isLoading || (user && blocked.isPending) ? <StateCard loading title="차단 목록을 불러오고 있어요." /> : null}
        {!isLoading && !user ? (
          <StateCard title="로그인이 필요해요." text="차단 목록은 로그인 후 관리할 수 있습니다."
            action={{ label: '로그인', variant: 'primary', onPress: () => router.push('/auth/login') }} />
        ) : null}
        {blocked.isError ? (
          <StateCard title="차단 목록을 불러오지 못했어요." action={{ label: '다시 불러오기', onPress: () => void blocked.refetch() }} />
        ) : null}
        {blocked.data?.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>차단한 사용자가 없어요.</Text>
            <Text style={styles.emptyText}>다른 사용자의 프로필에서 차단하면 여기에서 해제할 수 있어요.</Text>
          </View>
        ) : null}
        {blocked.data?.length ? <>
          {blocked.data.map((item) => {
            const name = item.blockedUsername ? `@${item.blockedUsername}` : '비공개 사용자';
            return (
              <View key={item.blockedUserId} style={styles.blockRow}>
                <Avatar name={item.blockedUsername ?? '?'} size={40} tone="subtle" />
                <Text numberOfLines={1} style={styles.blockName}>{name}</Text>
                <Button variant="secondary" size="sm" label="차단 해제" disabled={safety.unblockUser.isPending}
                  onPress={() => unblock(item.blockedUserId, name)} />
              </View>
            );
          })}
          {safety.unblockUser.isError ? <Text accessibilityRole="alert" style={styles.error}>차단을 해제하지 못했어요. 연결 상태를 확인하고 다시 시도해주세요.</Text> : null}
          <Text style={styles.note}>차단하면 로그인한 상태에서 서로의 프로필 원픽 댓글이 보이지 않아요. 차단을 해제해도 팔로우는 다시 연결되지 않아요.</Text>
        </> : null}
      </ScrollView>
      {toast ? <View pointerEvents="none" accessibilityLiveRegion="polite" style={styles.toast}><Text style={styles.toastText}>{toast}</Text></View> : null}
    </SafeAreaView>
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
    flexGrow: 1,
    width: '100%',
    maxWidth: OnePick.maxWidth,
    alignSelf: 'center',
    paddingHorizontal: OnePickSpace.gutter,
    paddingBottom: OnePickSpace.xxxl + OnePickSpace.lg,
  },
  blockRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: OnePickSpace.md,
    paddingVertical: OnePickSpace.md,
    borderBottomWidth: 1,
    borderBottomColor: OnePick.borderDefault,
  },
  blockName: { ...OnePickType.body, flex: 1, color: OnePick.textPrimary },
  note: { ...OnePickType.caption, color: OnePick.textSecondary, marginTop: OnePickSpace.md },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: OnePickSpace.xxxl },
  emptyTitle: { ...OnePickType.headline, color: OnePick.textPrimary, textAlign: 'center' },
  emptyText: { ...OnePickType.body, color: OnePick.textSecondary, textAlign: 'center', marginTop: OnePickSpace.sm },
  error: { ...OnePickType.body, color: OnePick.textDanger, marginTop: OnePickSpace.sm },
  toast: {
    position: 'absolute',
    alignSelf: 'center',
    bottom: OnePickSpace.xxxl,
    backgroundColor: OnePick.actionPrimary,
    borderRadius: OnePickRadius.full,
    paddingHorizontal: OnePickSpace.lg,
    paddingVertical: OnePickSpace.md,
  },
  toastText: { ...OnePickType.bodyMedium, color: OnePick.onAction },
  pressed: { opacity: 0.7 },
});
