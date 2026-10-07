import { useRouter } from 'expo-router';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { HomePickRow } from '@/components/home-pick-row';
import { Icon, StateCard } from '@/components/ui';
import { OnePick, OnePickLayout, OnePickMvp, OnePickSpace, OnePickType } from '@/constants/onepick';
import { useAuthSession } from '@/hooks/useAuthSession';
import { useFullPickFeed } from '@/hooks/useHomeData';
import { HOME_FEED_ROOT_SLUG } from '@/lib/home/homeCategoryFilters';

/**
 * 사람들의 원픽 전체 (Home feed 더보기): first 20, the next 20 near the bottom, stop when
 * the server has no more. The detailed design is not decided yet, so this stays minimal.
 */
export default function FullFeedScreen() {
  const router = useRouter();
  const { user, isLoading: isSessionLoading, error: sessionError } = useAuthSession();
  const feed = useFullPickFeed(user?.id, !isSessionLoading && !sessionError, OnePickMvp.publicPickChannel, HOME_FEED_ROOT_SLUG);
  const picks = feed.data ?? [];
  const goBack = () => router.canGoBack() ? router.back() : router.replace('/');
  // One request at a time; a failed page waits for an explicit retry.
  const loadMore = () => {
    if (feed.hasNextPage && !feed.isFetching && !feed.isFetchNextPageError) void feed.fetchNextPage({ cancelRefetch: false });
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      <FlatList
        data={picks}
        keyExtractor={(pick) => pick.pickId}
        renderItem={({ item: pick }) => <HomePickRow pick={pick} mine={pick.userId === user?.id}
          onOpenItem={() => router.push({ pathname: '/item/[itemId]', params: { itemId: pick.itemId } })}
          onOpenProfile={() => router.push({ pathname: '/u/[username]', params: { username: pick.username, returnTo: '/feed' } })}
          onOpenProvider={pick.providerId ? () => router.push({ pathname: '/provider/[providerId]', params: { providerId: pick.providerId!, scope: 'provider' } }) : undefined} />}
        ItemSeparatorComponent={() => <View style={styles.gap} />}
        onEndReached={loadMore}
        onEndReachedThreshold={0.6}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        ListHeaderComponent={<View style={styles.header}>
          <Pressable accessibilityRole="button" accessibilityLabel="뒤로 가기" onPress={goBack}
            style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}>
            <Icon name="back" />
          </Pressable>
          <Text accessibilityRole="header" style={styles.title}>사람들의 원픽</Text>
        </View>}
        ListEmptyComponent={feed.isPending || isSessionLoading ? <StateCard loading title="원픽을 불러오고 있어요." />
          : feed.isError || sessionError ? <StateCard tone="danger" title="원픽을 불러오지 못했어요." text="연결 상태를 확인한 뒤 다시 시도해주세요."
            action={{ label: '다시 불러오기', disabled: feed.isFetching, onPress: () => void feed.refetch() }} />
          : <StateCard title="아직 공개된 원픽이 없어요." />}
        ListFooterComponent={picks.length ? <>
          {feed.isFetchingNextPage ? <ActivityIndicator style={styles.pageLoading} accessibilityLabel="다음 원픽 불러오는 중" color={OnePick.accent} /> : null}
          {feed.isFetchNextPageError ? <StateCard compact text="다음 원픽을 불러오지 못했어요."
            action={{ label: '다음 원픽 다시 불러오기', disabled: feed.isFetching, onPress: () => { if (!feed.isFetching) void feed.fetchNextPage({ cancelRefetch: false }); } }} /> : null}
          {!feed.hasNextPage && !feed.isFetching ? <Text style={styles.endText}>지금 볼 수 있는 원픽을 모두 확인했어요.</Text> : null}
        </> : null}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: OnePick.background },
  content: { width: '100%', maxWidth: OnePick.maxWidth, alignSelf: 'center', paddingHorizontal: OnePickLayout.homeFeedGutter, paddingBottom: OnePickSpace.xxl },
  header: { flexDirection: 'row', alignItems: 'center', minHeight: 56, marginBottom: OnePickSpace.sm },
  backButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', marginLeft: -10 },
  title: { ...OnePickType.title, color: OnePick.textPrimary },
  gap: { height: 12 },
  pageLoading: { padding: OnePickSpace.xl },
  endText: { ...OnePickType.caption, color: OnePick.textSecondary, textAlign: 'center', paddingVertical: OnePickSpace.xxl },
  pressed: { opacity: 0.65 },
});
