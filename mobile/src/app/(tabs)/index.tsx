import { useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Platform, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { OnePickBrand } from '@/components/onepick-brand';
import { NotificationButton } from '@/components/notification-button';
import { HomeFeedCard } from '@/components/home-feed-card';
import { ItemSearch } from '@/components/item-search';
import { PickPhoto } from '@/components/pick-photo';
import { Avatar, BrandMark, Button, Chip, SectionHeader, StateCard } from '@/components/ui';
import { OnePick, OnePickFeatures, OnePickThresholds } from '@/constants/onepick';
import { useAuthSession } from '@/hooks/useAuthSession';
import { useExploreCategories } from '@/hooks/useExploreData';
import { useFollowingFeed } from '@/hooks/useFollow';
import { useHomeData } from '@/hooks/useHomeData';
import { categoryLabel, selectableCategories } from '@/lib/categories/categoryTree';
import { buildHomeCategoryFilters, filterHomeFeedByCategory, HOME_FEED_ROOT_SLUG, homeStarterCategories } from '@/lib/home/homeCategoryFilters';
import { HOME_CHANNEL_TABS, categoryWithChannels, objectParticle } from '@/lib/home/homeChannels';
import type { HomeFeedPick, PickChannel } from '@/repositories/interfaces/readRepository';

type HomeData = NonNullable<ReturnType<typeof useHomeData>['data']>;
type EditorialItem = HomeData['editorialItems'][number];

function EditorialCard({ item, onOpen }: { item: EditorialItem; onOpen: () => void }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={item.name + ' 추천 원픽 상세 보기'}
    onPress={onOpen} style={({ pressed }) => [styles.editorialCard, pressed && styles.pressed]}>
    <View style={styles.editorialTop}>
      <Text style={styles.editorialKicker}>원픽 추천</Text>
      <Text numberOfLines={1} style={styles.editorialPath}>{categoryWithChannels(item.categoryName, item.channels)}</Text>
    </View>
    <View style={styles.editorialBody}>
      <PickPhoto uri={item.thumbnailUrl} label={item.name} itemId={item.itemId} />
      <View style={styles.editorialCopy}>
        <Text style={styles.itemName}>{item.name}</Text>
        {item.editorialNote ? <Text numberOfLines={3} style={styles.editorialNote}>{item.editorialNote}</Text> : null}
        <Text style={styles.editorialCount}>{item.pickCount > 0 ? `현재 ${item.pickCount.toLocaleString()}명이 이 원픽을 추천` : '아직 첫 추천을 기다리는 원픽'}</Text>
      </View>
    </View>
  </Pressable>;
}

export default function HomeScreen() {
  const router = useRouter();
  const { user, isLoading: isSessionLoading, error: sessionError, retry: retrySession } = useAuthSession();
  // Start with public Picks even before a new member follows anyone.
  // The following scope stays available without downloading an invisible feed.
  const [feedScope, setFeedScope] = useState<'all' | 'following'>('all');
  const showFollowing = OnePickFeatures.follow && Boolean(user) && feedScope === 'following';
  // Keep shared Home context (categories/current Picks) available for search and
  // badges, but do not download the invisible public feed while following is shown.
  // 오프라인/온라인 맛집 tabs filter the public feed on the server (delivery counts as offline).
  const [channel, setChannel] = useState<PickChannel | null>(null);
  const channelTab = HOME_CHANNEL_TABS.find((tab) => tab.channel === channel) ?? HOME_CHANNEL_TABS[0];
  // MVP Home is food-only: the server drops other categories so pages never come back empty.
  const homeQuery = useHomeData(user?.id, !isSessionLoading && !sessionError, !showFollowing, channel, HOME_FEED_ROOT_SLUG);
  // The previous tab's rows stay cached as placeholder data; never show them under the new tab.
  const switchingChannel = Boolean(homeQuery.isPlaceholderData);
  const followingQuery = useFollowingFeed(user?.id, showFollowing && !isSessionLoading && !sessionError);
  const followingItems = followingQuery.data?.items ?? [];
  const isLoading = isSessionLoading || (!sessionError && homeQuery.isPending);
  const data = homeQuery.data;
  // Home search, category filters and Explore share one cached category-tree query.
  // Start it alongside Home context instead of waiting for Home to finish first.
  const categoriesQuery = useExploreCategories(!isSessionLoading && !sessionError);
  const categoryCatalog = categoriesQuery.data ?? [];
  const categoryFilters = useMemo(() => buildHomeCategoryFilters(categoryCatalog), [categoryCatalog]);
  const [selectedCategoryGroupId, setSelectedCategoryGroupId] = useState<string | null>(null);
  const showCategoryFilters = Boolean(OnePickFeatures.categoryChips) && categoryFilters.length > 1 &&
    (data?.picks.length ?? 0) >= OnePickThresholds.homeCategoryFilterMinPicks;
  // Disable the filter in this render, before the effect clears its saved value.
  const selectedCategoryGroup = showCategoryFilters
    ? categoryFilters.find((group) => group.id === selectedCategoryGroupId) ?? null
    : null;
  const visiblePicks = useMemo(
    () => filterHomeFeedByCategory(data?.picks ?? [], selectedCategoryGroup),
    [data?.picks, selectedCategoryGroup],
  );
  const openItem = (itemId: string) => router.push({ pathname: '/item/[itemId]', params: { itemId } });
  const searchCategories = useMemo(() => selectableCategories(categoryCatalog).map((category) => ({
    ...category,
    label: categoryLabel(category, categoryCatalog),
  })), [categoryCatalog]);
  // MVP Home only surfaces restaurant (food) entry points; see HOME_ROOT_SLUGS.
  const categories = useMemo(() => user ? [] : homeStarterCategories(categoryCatalog), [user, categoryCatalog]);
  const openRegistration = (category: { id: string; slug: string }) => {
    const params = { categoryId: category.id };
    if (category.slug === 'music') return router.push({ pathname: '/pick/music', params });
    if (category.slug === 'game') return router.push({ pathname: '/pick/game', params });
    if (category.slug === 'book') return router.push({ pathname: '/pick/book', params });
    if (category.slug === 'youtube') return router.push({ pathname: '/pick/youtube', params });
    if (category.slug === 'pokemon') return router.push({ pathname: '/pick/pokemon', params });
    return router.push({ pathname: '/pick/find', params });
  };
  const ready = !isLoading && !sessionError && Boolean(data);

  useEffect(() => {
    if (selectedCategoryGroupId && (!showCategoryFilters || !categoryFilters.some((group) => group.id === selectedCategoryGroupId))) {
      setSelectedCategoryGroupId(null);
    }
  }, [categoryFilters, selectedCategoryGroupId, showCategoryFilters]);
  const refresh = () => {
    if (isSessionLoading || sessionError) return;
    if (showFollowing) {
      if (!followingQuery.isFetching) void followingQuery.refetch({ cancelRefetch: false });
      return;
    }
    if (!homeQuery.isFetching) void homeQuery.refetch({ cancelRefetch: false });
  };
  const openProfile = (username: string) => router.push({ pathname: '/u/[username]', params: { username } });
  const isMyItem = (itemId: string) => Boolean(user && data?.currentPicks.some(({ pick }) => pick.itemId === itemId && pick.status === 'active'));
  // Both feed scopes render the same card. Same item → the normal choose screen
  // (signed-out readers get its login gate).
  const renderFeedCard = (pick: HomeFeedPick) => <View style={styles.productCell}>
    <HomeFeedCard pick={pick} mine={isMyItem(pick.itemId)}
      onOpenItem={() => openItem(pick.itemId)}
      onOpenProfile={() => openProfile(pick.username)}
      onChooseSame={() => router.push({ pathname: '/pick/choose', params: { itemId: pick.itemId, categoryId: pick.categoryId, ...(pick.channels?.length === 1 ? { channel: pick.channels[0] } : {}) } })} />
  </View>;

  const listHeader = <>
    <View style={styles.nativeHeader}>
      <OnePickBrand />
      <View style={styles.headerActions}>
        {user ? <NotificationButton userId={user.id} /> : null}
        {user ? <Avatar name="나" size={40} accessibilityLabel="내 프로필" onPress={() => router.push('/profile')} /> : null}
      </View>
    </View>

    <ItemSearch compact
      onSubmitSearch={(query) => router.push({ pathname: '/explore', params: { search: '1', query } })}
      onSelect={openItem} />

    {OnePickFeatures.follow && user ? <View style={styles.scopeRow}>
      {(['following', 'all'] as const).map((scope) => {
        const selected = feedScope === scope;
        return <Pressable key={scope} accessibilityRole="tab" accessibilityState={{ selected }}
          accessibilityLabel={scope === 'all' ? '전체 원픽 보기' : '팔로잉 원픽 보기'}
          onPress={() => setFeedScope(scope)}
          style={({ pressed }) => [styles.scopeTab, selected && styles.scopeTabSelected, pressed && styles.pressed]}>
          <Text style={[styles.scopeText, selected && styles.scopeTextSelected]}>{scope === 'all' ? '전체' : '팔로잉'}</Text>
        </Pressable>;
      })}
    </View> : null}
  </>;

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      {showFollowing ? <FlatList
        data={followingItems}
        keyExtractor={(pick) => pick.pickId}
        renderItem={({ item: pick }) => renderFeedCard(pick)}
        onEndReached={() => {
          if (followingQuery.hasNextPage && !followingQuery.isFetching && !followingQuery.isFetchNextPageError) {
            void followingQuery.fetchNextPage({ cancelRefetch: false });
          }
        }}
        onEndReachedThreshold={0.6}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={followingQuery.isRefetching} onRefresh={refresh} tintColor={OnePick.accent} />}
        ListHeaderComponent={<>
          {listHeader}
          {/* RefreshControl does not refresh on web; keep an explicit action in both feed scopes. */}
          {Platform.OS === 'web' && !isSessionLoading && !sessionError && followingQuery.data ? <View style={styles.refreshRow}>
            <Button variant="ghost" size="sm" accessibilityLabel="팔로잉 원픽 새로고침" disabled={followingQuery.isFetching} onPress={refresh}
              label={followingQuery.isFetching ? '새로고침 중…' : followingQuery.isError ? '다시 불러오기' : '새로고침'} />
          </View> : null}
          {followingQuery.isPending ? <StateCard loading title="팔로우한 사람들의 원픽을 불러오고 있어요" /> : null}
          {followingQuery.isError && !followingQuery.data ? <StateCard tone="danger" title="팔로잉 원픽을 불러오지 못했어요" text="연결 상태를 확인한 뒤 다시 시도해주세요."
            action={{ label: '다시 불러오기', disabled: followingQuery.isFetching, onPress: refresh }} /> : null}
          {followingQuery.data && !followingItems.length ? <View style={styles.followingEmpty}>
            <StateCard title="아직 팔로잉 원픽이 없어요" text="프로필에서 팔로우한 사람이 원픽을 고르면 여기에 이유와 함께 보여요. 친구에게 내 프로필을 공유해 원픽으로 초대해보세요."
              action={{ label: '전체 원픽 보기', onPress: () => setFeedScope('all') }} />
            <Button variant="ghost" size="sm" label="내 프로필 공유하기" accessibilityLabel="내 프로필 공유하러 가기" onPress={() => router.push('/profile')} />
          </View> : null}
        </>}
        ListFooterComponent={followingQuery.data ? <>
          {followingQuery.isFetchingNextPage ? <ActivityIndicator style={styles.pageLoading} accessibilityLabel="다음 원픽 불러오는 중" color={OnePick.accent} /> : null}
          {followingQuery.isFetchNextPageError ? <StateCard compact text="다음 원픽을 불러오지 못했어요."
            action={{ label: '다음 원픽 다시 불러오기', disabled: followingQuery.isFetching, onPress: () => { if (!followingQuery.isFetching) void followingQuery.fetchNextPage({ cancelRefetch: false }); } }} /> : null}
          {!followingQuery.hasNextPage && followingItems.length > 0 ? <Text style={styles.endText}>팔로우한 사람들의 원픽을 모두 확인했어요.</Text> : null}
        </> : null}
      /> : <FlatList
        data={ready && !switchingChannel ? visiblePicks : []}
        keyExtractor={(pick) => pick.pickId}
        renderItem={({ item: pick }) => renderFeedCard(pick)}
        onEndReached={() => {
          if (ready && homeQuery.hasNextPage && !homeQuery.isFetching && !homeQuery.isFetchNextPageError) {
            void homeQuery.fetchNextPage({ cancelRefetch: false });
          }
        }}
        onEndReachedThreshold={0.6}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        refreshControl={!isSessionLoading && !sessionError ? (
          <RefreshControl refreshing={homeQuery.isRefetching} onRefresh={refresh} tintColor={OnePick.accent} />
        ) : undefined}
        ListHeaderComponent={<>
        {listHeader}

        {user ? null : <View style={styles.signinStrip}>
          <BrandMark soft />
          <View style={styles.signinCopy}>
            <Text style={styles.signinTitle}>하나만 추천한다면 무엇인가요?</Text>
            <Text style={styles.signinText}>카테고리마다 하나를 고르고 이유를 남겨보세요</Text>
          </View>
          <Button size="sm" label="시작하기" accessibilityLabel="로그인하고 내 추천 원픽 만들기"
            onPress={() => router.push({ pathname: '/auth/login', params: { action: 'home' } })} />
        </View>}

        {ready && data?.editorialItems?.length ? <View style={styles.editorialSection}>
          <SectionHeader title="먼저 소개하는 원픽" />
          <View style={styles.editorialList}>
            {data.editorialItems.map((item) => <EditorialCard key={item.itemId} item={item} onOpen={() => openItem(item.itemId)} />)}
          </View>
        </View> : null}

        {ready && data && categories.length ? <View style={styles.categorySection}>
          <View style={styles.nextSection}><SectionHeader title="어떤 맛집부터 골라볼까요?" /></View>
          <View style={styles.categoryGrid}>
            {categories.map((category) => {
              const label = category.name;
              return <Pressable key={category.id} accessibilityRole="button" accessibilityLabel={label + ' 원픽 찾기'}
                onPress={() => openRegistration(category)} style={({ pressed }) => [styles.categoryCard, pressed && styles.pressed]}>
                <Text numberOfLines={2} style={styles.categoryName}>{label}</Text><Text style={styles.categoryAction}>추천 원픽 고르기  ↗</Text>
              </Pressable>;
            })}
          </View>
        </View> : null}

        <View style={styles.sectionHeader}>
          <SectionHeader title="사람들의 원픽" description="최근 고른 순 · 같으면 따라 고르고, 다르면 내 것을 찾아요" />
        </View>

        {ready ? <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.channelRow}>
          {HOME_CHANNEL_TABS.map((tab) => {
            const selected = tab.channel === channel;
            return <Chip key={tab.label} label={tab.label} selected={selected}
              accessibilityLabel={`${tab.label} 탭 원픽 보기`} onPress={() => setChannel(tab.channel)} />;
          })}
        </ScrollView> : null}

        {ready && showCategoryFilters ? <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.categoryFilterRow}>
          <Chip label="전체" selected={selectedCategoryGroupId === null} accessibilityLabel="전체 카테고리 보기" onPress={() => setSelectedCategoryGroupId(null)} />
          {categoryFilters.map((group) => {
            const selected = selectedCategoryGroupId === group.id;
            return <Chip key={group.id} label={group.name} selected={selected} accessibilityLabel={`${group.name} 카테고리 보기`}
              onPress={() => setSelectedCategoryGroupId(group.id)} />;
          })}
        </ScrollView> : null}

        {isLoading || (ready && switchingChannel) ? <StateCard loading title="원픽을 불러오고 있어요" /> : null}
        {sessionError || (!isSessionLoading && homeQuery.isError && !data) ? <StateCard tone="danger"
          title={sessionError ? '로그인 상태를 확인하지 못했어요' : '원픽을 불러오지 못했어요'}
          text="연결 상태를 확인한 뒤 다시 시도해주세요."
          action={{ label: '다시 불러오기', disabled: !sessionError && homeQuery.isFetching, onPress: sessionError ? retrySession : refresh }} /> : null}

        {ready && data ? <>
          {Platform.OS === 'web' || (homeQuery.isError && !homeQuery.isFetchNextPageError) ? <View style={styles.refreshRow}>
            {homeQuery.isError && !homeQuery.isFetchNextPageError ? <Text accessibilityRole="alert" style={styles.refreshError}>최신 원픽을 확인하지 못했어요. 마지막으로 불러온 내용을 표시하고 있어요.</Text> : null}
            <Button variant="ghost" size="sm" accessibilityLabel="홈 원픽 새로고침" disabled={homeQuery.isFetching} onPress={refresh}
              label={homeQuery.isFetching ? '새로고침 중…' : homeQuery.isError && !homeQuery.isFetchNextPageError ? '다시 불러오기' : '새로고침'} />
          </View> : null}
          {!switchingChannel && !data.picks.length ? (channel
            ? <StateCard title={`아직 ${channelTab.label} 원픽이 없어요`} text={`누군가 ${channelTab.label}${objectParticle(channelTab.label)} 원픽으로 고르면 여기에 보여요.`}
              action={{ label: '전체 원픽 보기', accessibilityLabel: '전체 탭으로 돌아가기', onPress: () => setChannel(null) }} />
            : <StateCard title="아직 공개된 원픽이 없어요" text="누군가 첫 원픽을 고르면 이유와 함께 여기에 보여요."
              action={user ? { label: '내 원픽 먼저 고르기', onPress: () => router.push('/pick/new') } : undefined} />) : null}
        </> : null}
        </>}
        ListEmptyComponent={ready && data && data.picks.length > 0 && selectedCategoryGroup ? <StateCard
          title={`${selectedCategoryGroup.name}에서 아직 표시할 원픽이 없어요`}
          text="현재 불러온 원픽에는 없지만 다음 페이지에 더 있을 수 있어요."
          action={homeQuery.hasNextPage
            ? { label: '다음 원픽 더 불러오기', accessibilityLabel: selectedCategoryGroup.name + ' 다음 원픽 더 불러오기', disabled: homeQuery.isFetching, onPress: () => { if (!homeQuery.isFetching) void homeQuery.fetchNextPage({ cancelRefetch: false }); } }
            : { label: '전체 보기', accessibilityLabel: '전체 카테고리 보기', onPress: () => setSelectedCategoryGroupId(null) }} /> : null}
        ListFooterComponent={ready && data ? <>
          {homeQuery.isFetchingNextPage ? <ActivityIndicator style={styles.pageLoading} accessibilityLabel="다음 원픽 불러오는 중" color={OnePick.accent} /> : null}
          {homeQuery.isFetchNextPageError ? <StateCard compact text="다음 원픽을 불러오지 못했어요."
            action={{ label: '다음 원픽 다시 불러오기', disabled: homeQuery.isFetching, onPress: () => { if (!homeQuery.isFetching) void homeQuery.fetchNextPage({ cancelRefetch: false }); } }} /> : null}
          {!switchingChannel && !homeQuery.hasNextPage && data.picks.length > 0 ? <Text style={styles.endText}>지금 볼 수 있는 원픽을 모두 확인했어요.</Text> : null}
          <View style={styles.moreRow}><Button variant="ghost" label="원픽 더 둘러보기  ↗" accessibilityLabel="원픽 더 둘러보기" onPress={() => router.push('/explore')} /></View>

          {user ? <Pressable accessibilityRole="button" accessibilityLabel={`내 원픽 ${data.currentPicks.length}개 모아보기`} onPress={() => router.push('/profile')} style={styles.profileLink}>
            <Text style={styles.actionText}>내 원픽 {data.currentPicks.length}개 모아보기</Text><Text style={styles.arrow}>↗</Text>
          </Pressable> : null}

          <View style={styles.footer}><BrandMark size="sm" /><Text style={styles.footerText}>원픽을 바꿔도, 지난 취향은 기록으로 남아요.</Text></View>
        </> : null}
      />}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: OnePick.background },
  content: { width: '100%', maxWidth: OnePick.maxWidth, alignSelf: 'center', paddingHorizontal: 20, paddingBottom: 28 },
  nativeHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 72 },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  signinStrip: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 13, marginTop: 8, marginBottom: 22, borderWidth: 1, borderColor: OnePick.border, borderRadius: 16, backgroundColor: OnePick.surface },
  signinCopy: { flex: 1, minWidth: 0 },
  signinTitle: { color: OnePick.text, fontSize: 14, lineHeight: 19, fontWeight: '700' },
  signinText: { color: OnePick.muted, fontSize: 12, lineHeight: 17, marginTop: 2 },
  categorySection: { marginBottom: 26 },
  sectionHeader: { marginBottom: 8 },
  moreRow: { alignItems: 'center', paddingVertical: 10 },
  editorialSection: { marginBottom: 26 },
  editorialList: { gap: 10, marginTop: 12 },
  editorialCard: { padding: 16, borderWidth: 1, borderColor: OnePick.border, borderRadius: 20, backgroundColor: OnePick.surface },
  editorialTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 12 },
  editorialKicker: { color: OnePick.accent, fontSize: 11, fontWeight: '800', letterSpacing: 0.8 },
  editorialPath: { flex: 1, color: OnePick.muted, fontSize: 11, textAlign: 'right' },
  editorialBody: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  editorialCopy: { flex: 1, minWidth: 0 },
  editorialNote: { color: OnePick.text, fontSize: 13, lineHeight: 20, marginTop: 7 },
  editorialCount: { color: OnePick.muted, fontSize: 11, lineHeight: 17, marginTop: 7 },
  scopeRow: { flexDirection: 'row', gap: 6, padding: 4, marginTop: 4, marginBottom: 18, borderRadius: 14, backgroundColor: OnePick.sunken, alignSelf: 'flex-start' },
  scopeTab: { minHeight: 36, minWidth: 72, alignItems: 'center', justifyContent: 'center', borderRadius: 11, paddingHorizontal: 14 },
  scopeTabSelected: { backgroundColor: OnePick.surface },
  scopeText: { color: OnePick.muted, fontSize: 13, fontWeight: '700' },
  scopeTextSelected: { color: OnePick.text, fontWeight: '900' },
  channelRow: { flexDirection: 'row', gap: 8, paddingVertical: 6, paddingRight: 4, marginBottom: 10 },
  categoryFilterRow: { gap: 8, paddingVertical: 6, paddingRight: 4, marginBottom: 10 },
  productCell: { marginBottom: 12 },
  followingEmpty: { alignItems: 'center', gap: 4 },
  pageLoading: { padding: 20 },
  endText: { color: OnePick.muted, textAlign: 'center', paddingVertical: 24, fontSize: 12 },
  profileLink: { minHeight: 56, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16, marginTop: 20, borderRadius: 16, backgroundColor: OnePick.accentSoft },
  itemName: { color: OnePick.text, fontSize: 18, lineHeight: 25, fontWeight: '700', letterSpacing: -0.5 },
  actionText: { color: OnePick.accent, fontSize: 14, fontWeight: '600' },
  arrow: { color: OnePick.accent, fontSize: 20 },
  nextSection: { marginBottom: 12 },
  categoryGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  categoryCard: { width: '46%', flexGrow: 1, minHeight: 88, justifyContent: 'space-between', padding: 14, borderWidth: 1, borderColor: OnePick.border, borderRadius: 16, backgroundColor: OnePick.surface },
  categoryName: { color: OnePick.text, fontSize: 15, lineHeight: 21, fontWeight: '700' },
  categoryAction: { color: OnePick.muted, fontSize: 12, marginTop: 10 },
  refreshRow: { alignItems: 'flex-end', marginBottom: 12 },
  refreshError: { alignSelf: 'stretch', color: OnePick.danger, fontSize: 13, lineHeight: 20 },
  footer: { flexDirection: 'row', alignItems: 'center', gap: 12, borderTopWidth: 1, borderTopColor: OnePick.border, marginTop: 30, paddingTop: 20 },
  footerText: { color: OnePick.muted, fontSize: 13, lineHeight: 21, flex: 1 },
  pressed: { opacity: 0.65 },
});
