import { useRouter } from 'expo-router';
import { Platform, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ProfileMyComments } from '@/components/profile-my-comments';
import { Button, StateCard } from '@/components/ui';
import { OnePick } from '@/constants/onepick';
import { useAuthSession } from '@/hooks/useAuthSession';
import { useMyComments } from '@/hooks/useMyProfileLists';

export default function MyCommentsScreen() {
  const router = useRouter();
  const { user, isLoading: isSessionLoading, error: sessionError, retry: retrySession } = useAuthSession();
  const query = useMyComments(!isSessionLoading && !sessionError ? user?.id : undefined);

  if (isSessionLoading) {
    return <SafeAreaView style={styles.safeArea} edges={['top']}><View style={styles.centerState}>
      <StateCard loading title="로그인 상태를 확인하고 있어요" />
    </View></SafeAreaView>;
  }
  if (sessionError) {
    return <SafeAreaView style={styles.safeArea} edges={['top']}><View style={styles.centerState}>
      <StateCard tone="danger" title="로그인 상태를 확인하지 못했어요" text="연결 상태를 확인한 뒤 다시 시도해주세요."
        action={{ label: '다시 확인하기', onPress: retrySession, variant: 'secondary' }} />
    </View></SafeAreaView>;
  }
  if (!user) {
    return <SafeAreaView style={styles.safeArea} edges={['top']}><View style={styles.centerState}>
      <StateCard title="내가 남긴 댓글을 모아보세요" text="로그인하면 한줄평에 남긴 댓글을 한곳에서 볼 수 있어요."
        action={{ label: '로그인하기', variant: 'primary', onPress: () => router.push({ pathname: '/auth/login', params: { action: 'my_comments' } }) }} />
    </View></SafeAreaView>;
  }

  const refresh = async () => {
    if (query.isFetching) return;
    await query.refetch({ cancelRefetch: false });
  };
  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={query.isRefetching} onRefresh={refresh} tintColor={OnePick.accent} />}>
        <View style={styles.header}>
          <Pressable accessibilityRole="button" accessibilityLabel="프로필로 돌아가기" style={styles.back}
            onPress={() => router.canGoBack() ? router.back() : router.replace('/profile')}>
            <Text style={styles.title}>‹</Text>
          </Pressable>
          <Text accessibilityRole="header" style={styles.title}>내 댓글</Text>
          {Platform.OS === 'web' && query.data ? <Button variant="ghost" size="sm" accessibilityLabel="댓글 새로고침"
            disabled={query.isFetching} onPress={refresh} label={query.isFetching ? '확인 중…' : '새로고침'} /> : null}
        </View>
        <ProfileMyComments query={query} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  back: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  safeArea: { flex: 1, backgroundColor: OnePick.background },
  content: { width: '100%', maxWidth: 480, alignSelf: 'center', paddingHorizontal: 20, paddingTop: 24, paddingBottom: 28 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingBottom: 16 },
  tabRow: { flexDirection: 'row', gap: 6, padding: 4, marginBottom: 16, borderRadius: 14, backgroundColor: OnePick.sunken, alignSelf: 'flex-start' },
  tab: { minHeight: 36, minWidth: 72, alignItems: 'center', justifyContent: 'center', borderRadius: 11, paddingHorizontal: 14 },
  tabSelected: { backgroundColor: OnePick.surface },
  tabText: { color: OnePick.muted, fontSize: 13, fontWeight: '700' },
  tabTextSelected: { color: OnePick.text, fontWeight: '900' },
  pressed: { opacity: 0.7 },
  title: { color: OnePick.text, fontSize: 22, lineHeight: 28, fontWeight: '800', letterSpacing: -0.5 },
  centerState: { flex: 1, width: '100%', maxWidth: OnePick.maxWidth, alignSelf: 'center', justifyContent: 'center', gap: 16, paddingHorizontal: 20 },
});
