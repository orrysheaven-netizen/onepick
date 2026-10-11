import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ProfileMyComments } from '@/components/profile-my-comments';
import { StateCard } from '@/components/ui';
import { OnePick, OnePickRadius, OnePickSpace, OnePickType } from '@/constants/onepick';
import { useExploreCategories } from '@/hooks/useExploreData';
import { useAuthSession } from '@/hooks/useAuthSession';
import { useMyComments } from '@/hooks/useMyProfileLists';
import { HOME_FEED_ROOT_SLUG } from '@/lib/home/homeCategoryFilters';

type CommentTab = 'theme' | 'rest';

// The MVP food theme comes first, with all other themes grouped under 기타.
const COMMENT_TABS: { key: CommentTab; label: string; empty: string }[] = [
  { key: 'theme', label: '음식', empty: '음식 한줄평에 남긴 댓글이 여기에 모여요.' },
  { key: 'rest', label: '기타', empty: '음식 밖의 한줄평에 남긴 댓글이 여기에 모여요.' },
];

// Profile-entry list of comments I wrote, split by 음식 / 기타; each row opens the review it answers.
export default function MyCommentsScreen() {
  const router = useRouter();
  const { user, isLoading: isSessionLoading, error: sessionError, retry: retrySession } = useAuthSession();
  const [tab, setTab] = useState<CommentTab>('theme');
  const scope = HOME_FEED_ROOT_SLUG ? { rootSlug: HOME_FEED_ROOT_SLUG, inside: tab === 'theme' } : null;
  const query = useMyComments(!isSessionLoading && !sessionError ? user?.id : undefined, scope);
  // "서울집 미역국": rows name the store with its menu.
  const categories = useExploreCategories();
  const menuNames = new Map((categories.data ?? []).map((category) => [category.id, category.name]));
  const goBack = () => (router.canGoBack() ? router.back() : router.replace('/(tabs)/profile'));

  if (isSessionLoading) {
    return <SafeAreaView style={styles.safeArea} edges={['top']}><View style={styles.centerState}>
      <StateCard loading title="로그인 상태를 확인하고 있어요." />
    </View></SafeAreaView>;
  }
  if (sessionError) {
    return <SafeAreaView style={styles.safeArea} edges={['top']}><View style={styles.centerState}>
      <StateCard tone="danger" title="로그인 상태를 확인하지 못했어요." text="연결 상태를 확인한 뒤 다시 시도해주세요."
        action={{ label: '다시 확인하기', onPress: retrySession, variant: 'secondary' }} />
    </View></SafeAreaView>;
  }
  if (!user) {
    return <SafeAreaView style={styles.safeArea} edges={['top']}><View style={styles.centerState}>
      <StateCard title="내가 남긴 댓글을 모아보세요." text="로그인하면 한줄평에 남긴 댓글을 한곳에서 볼 수 있어요."
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
          <Pressable accessibilityRole="button" accessibilityLabel="뒤로" onPress={goBack}
            style={({ pressed }) => [styles.headerSide, pressed && styles.pressed]}>
            <Text style={styles.backText}>‹</Text>
          </Pressable>
          <Text accessibilityRole="header" style={styles.title}>댓글</Text>
          <View style={styles.headerSide} />
        </View>
        {scope ? <View accessibilityRole="tablist" style={styles.tabRow}>
          {COMMENT_TABS.map(({ key, label }) => {
            const selected = tab === key;
            return <Pressable key={key} accessibilityRole="tab" accessibilityState={{ selected }} accessibilityLabel={`${label} 댓글 보기`}
              onPress={() => setTab(key)} style={({ pressed }) => [styles.tab, selected && styles.tabSelected, pressed && styles.pressed]}>
              <Text style={[styles.tabText, selected && styles.tabTextSelected]}>{label}</Text>
            </Pressable>;
          })}
        </View> : null}
        <ProfileMyComments query={query} menuNames={menuNames} restaurant={tab === 'theme'}
          emptyText={scope ? COMMENT_TABS.find(({ key }) => key === tab)?.empty : undefined} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: OnePick.background },
  content: { width: '100%', maxWidth: OnePick.maxWidth, alignSelf: 'center', paddingHorizontal: OnePickSpace.gutter, paddingBottom: OnePickSpace.xxl },
  header: { minHeight: 56, flexDirection: 'row', alignItems: 'center', marginHorizontal: -OnePickSpace.sm },
  headerSide: { width: 48, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  backText: { ...OnePickType.pageTitle, color: OnePick.textPrimary },
  title: { ...OnePickType.headline, flex: 1, textAlign: 'center', color: OnePick.textPrimary },
  tabRow: { flexDirection: 'row', gap: OnePickSpace.sm, marginTop: OnePickSpace.sm, marginBottom: OnePickSpace.sm },
  tab: { flex: 1, minHeight: 44, alignItems: 'center', justifyContent: 'center', borderRadius: OnePickRadius.md, backgroundColor: OnePick.bgSubtle },
  tabSelected: { backgroundColor: OnePick.actionPrimary },
  tabText: { ...OnePickType.bodyMedium, color: OnePick.textPrimary },
  tabTextSelected: { color: OnePick.onAction },
  pressed: { opacity: 0.7 },
  centerState: { flex: 1, width: '100%', maxWidth: OnePick.maxWidth, alignSelf: 'center', justifyContent: 'center', gap: 16, paddingHorizontal: 20 },
});
