import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Platform, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { HomeInviteRow, HomePeopleRow, HomeQuestionCard, HomeReplyBanner, HomeUnpickedMenus } from '@/components/home-early-sections';
import { HomePickRow } from '@/components/home-pick-row';
import { RecentItemCard } from '@/components/recent-item-card';
import { HomeHeader } from '@/components/home-header';
import { BrandMark, Button, Chip, StateCard } from '@/components/ui';
import { OnePick, OnePickFeatures, OnePickLayout, OnePickMvp, OnePickRadius, OnePickSpace, OnePickThresholds, OnePickType } from '@/constants/onepick';
import { useAuthSession } from '@/hooks/useAuthSession';
import { useExploreCategories, useFoodMenuPickCounts } from '@/hooks/useExploreData';
import { useFollowCounts, useFollowingFeed } from '@/hooks/useFollow';
import { useDailyQuestionCategory, useHomeData, useHomeItemRanking, useHomeParticipantPicks } from '@/hooks/useHomeData';
import { useHomeReplyBanner, useNotificationCount } from '@/hooks/useNotifications';
import { browseScope } from '@/lib/categories/browseScope';
import {
  earlyHomeDiscovery, firstPickTransition, homeParticipants, myQuestionAnswer, myScopedPicks, questionFooter,
  showParticipants, totalPickCount, unpickedCategories,
} from '@/lib/home/earlyHome';
import { consumeFirstPickNotice, peekFirstPickNotice } from '@/lib/home/firstPickNotice';
import { sharePick } from '@/lib/share/sharePick';
import { buildHomeCategoryFilters, filterHomeFeedByCategory, HOME_FEED_ROOT_SLUG } from '@/lib/home/homeCategoryFilters';
import type { HomeFeedPick } from '@/repositories/interfaces/readRepository';
import type { Category } from '@/types/domain/category';

const HOME_FEED_LIMIT = 10;
const HOME_MENU_LIMIT = 6;
// Same candidate size as /popular's first rows, so both screens share one ordering.
const HOME_RANKING_CANDIDATES = 20;

export default function HomeScreen() {
  const router = useRouter();
  const { user, isLoading: isSessionLoading, error: sessionError, retry: retrySession } = useAuthSession();
  // Default scope follows the user's actual follow graph: existing followers see
  // their following feed first; new members with no follows see the public feed.
  // A manual tab choice wins until the signed-in account changes.
  const followCountUserId = OnePickFeatures.followingFeed && !isSessionLoading && !sessionError ? user?.id : undefined;
  const followCountsQuery = useFollowCounts(followCountUserId);
  const followDefaultPending = Boolean(followCountUserId) && followCountsQuery.isPending;
  const defaultFeedScope: 'all' | 'following' = (followCountsQuery.data?.followingCount ?? 0) > 0 ? 'following' : 'all';
  const [feedScopeChoice, setFeedScopeChoice] = useState<{ userId: string; scope: 'all' | 'following' } | null>(null);
  const feedScope = feedScopeChoice && feedScopeChoice.userId === user?.id ? feedScopeChoice.scope : defaultFeedScope;
  const chooseFeedScope = (scope: 'all' | 'following') => {
    if (user) setFeedScopeChoice({ userId: user.id, scope });
  };
  const showFollowing = Boolean(followCountUserId) && !followDefaultPending && feedScope === 'following';
  // Initial MVP exposes only food Picks from physical stores. Online/recipe
  // remain in the data model for later rollout but never enter these feed pages.
  const mvpChannel = OnePickMvp.publicPickChannel;
  const homeQuery = useHomeData(
    user?.id,
    !isSessionLoading && !sessionError,
    !followDefaultPending && !showFollowing,
    mvpChannel,
    HOME_FEED_ROOT_SLUG,
  );
  const followingQuery = useFollowingFeed(user?.id, showFollowing, mvpChannel, HOME_FEED_ROOT_SLUG);
  const followingItems = followingQuery.data?.items ?? [];
  const isLoading = isSessionLoading || followDefaultPending || (!sessionError && homeQuery.isPending);
  const data = homeQuery.data;
  const homeEnabled = !isSessionLoading && !sessionError;
  const menuCountsQuery = useFoodMenuPickCounts(mvpChannel, homeEnabled);
  const discovery = earlyHomeDiscovery(totalPickCount(menuCountsQuery.data));
  const questionQuery = useDailyQuestionCategory(homeEnabled);
  const participantsQuery = useHomeParticipantPicks(user?.id, homeEnabled);
  // Search shares the cached tree. Load it here only when a visible Home feature needs it.
  const needsCategoryCatalog = Boolean(OnePickFeatures.categoryChips || questionQuery.data ||
    discovery === 'unpicked' || (participantsQuery.data?.complete && participantsQuery.data.rows.length >= 3));
  const categoriesQuery = useExploreCategories(homeEnabled && needsCategoryCatalog);
  const categoryCatalog = categoriesQuery.data ?? [];
  const categoryFilters = useMemo(() => buildHomeCategoryFilters(categoryCatalog), [categoryCatalog]);
  const [selectedCategoryGroupId, setSelectedCategoryGroupId] = useState<string | null>(null);
  const showCategoryFilters = Boolean(OnePickFeatures.categoryChips) && categoryFilters.length > 1 &&
    (data?.picks.length ?? 0) >= OnePickThresholds.homeCategoryFilterMinPicks;
  // Disable the filter in this render, before the effect clears its saved value.
  const selectedCategoryGroup = showCategoryFilters
    ? categoryFilters.find((group) => group.id === selectedCategoryGroupId) ?? null
    : null;
  // Home shows only the newest ten Picks and never loads more; 더보기 opens the full feed.
  const visiblePicks = useMemo(
    () => filterHomeFeedByCategory(data?.picks ?? [], selectedCategoryGroup).slice(0, HOME_FEED_LIMIT),
    [data?.picks, selectedCategoryGroup],
  );
  const openItem = (itemId: string) => router.push({ pathname: '/item/[itemId]', params: { itemId } });
  const ready = !isLoading && !sessionError && Boolean(data);
  const showRanking = homeEnabled && !followDefaultPending && discovery === 'popular';

  // ---- Current Home integration (#762) --------------------------------------------
  // The food menu list Explore browses, in catalog order.
  const menuCategories = useMemo(() => {
    const leafIds = browseScope(categoryCatalog, { chips: false, groupSlug: OnePickMvp.browseGroupSlug }).leafIds ?? [];
    const byId = new Map(categoryCatalog.map((category) => [category.id, category]));
    return leafIds.map((id) => byId.get(id)).filter((category): category is Category => Boolean(category));
  }, [categoryCatalog]);
  const menuIds = useMemo(() => new Set(menuCategories.map((category) => category.id)), [menuCategories]);
  // Everyone's Picks per menu (server aggregate, suspended members excluded): total, answers, unpicked.
  // The 7-day ranking is only visible after the 30-Pick threshold, so do not pay for its RPC
  // in the early-MVP state or while the threshold total is still unknown.
  const itemRankingQuery = useHomeItemRanking(
    mvpChannel,
    HOME_RANKING_CANDIDATES,
    homeEnabled && discovery === 'popular',
  );
  // The product contract never displays a photo-less card; only URL load failure uses the fixed placeholder.
  const rankedItems = (itemRankingQuery.data ?? []).filter((item) => Boolean(item.thumbnailUrl)).slice(0, HOME_MENU_LIMIT);
  // Resolve the DB-selected daily menu against the current public food catalog.
  const questionCategory = questionQuery.data ? menuCategories.find((category) => category.id === questionQuery.data) ?? null : null;
  const myPicks = useMemo(() => myScopedPicks(data?.currentPicks ?? [], menuIds, mvpChannel), [data?.currentPicks, menuIds, mvpChannel]);
  const myAnswer = myQuestionAnswer(myPicks, questionCategory?.id ?? null);
  const unpicked = discovery === 'unpicked' && menuCountsQuery.data
    ? unpickedCategories(menuCategories, menuCountsQuery.data, questionCategory?.id ?? null)
    : [];
  const people = useMemo(() => participantsQuery.data?.complete
    ? homeParticipants(participantsQuery.data.rows, menuIds, mvpChannel) : [], [participantsQuery.data, menuIds, mvpChannel]);
  // Unread replies on the viewer's Picks: a complete count from the inbox's own grouped
  // notifications, read independently of the inbox tab's pages. Unknown/incomplete → hidden.
  const replyUserId = homeEnabled ? user?.id : undefined;
  const replyBannerQuery = useHomeReplyBanner(replyUserId, Boolean(replyUserId));
  const banner = replyBannerQuery.data?.banner ?? null;
  // The tab badge already polls the unread total; when it moves, the banner is out of date.
  const unreadBadge = useNotificationCount(replyUserId, Boolean(replyUserId)).data;
  useEffect(() => {
    if (!replyUserId || unreadBadge === undefined || !replyBannerQuery.data || replyBannerQuery.isFetching) return;
    if (unreadBadge !== replyBannerQuery.data.unreadTotal) void replyBannerQuery.refetch({ cancelRefetch: false });
  }, [replyUserId, unreadBadge, replyBannerQuery.data?.unreadTotal]);
  // "원픽 완료 · 친구에게 공유하기" appears once, right after a successful first save.
  const [firstPickNoticeId, setFirstPickNoticeId] = useState<string | null>(null);
  const myPickIds = myPicks.map(({ pick }) => pick.id).join(',');
  useEffect(() => {
    const pending = peekFirstPickNotice(user?.id);
    if (!pending || !data) return;
    if (!myPicks.some(({ pick }) => pick.id === pending.pickId)) return; // wait for the refreshed list
    consumeFirstPickNotice(user?.id, pending.pickId);
    // Only a 0 → 1 transition (pre-save state known) is a first Pick.
    const priorScoped = myScopedPicks(pending.priorPicks, menuIds, mvpChannel);
    if (firstPickTransition(priorScoped, myPicks, pending.pickId)) setFirstPickNoticeId(pending.pickId);
  }, [user?.id, myPickIds, Boolean(data)]);
  // Leaving Home after the line was on screen ends it.
  useFocusEffect(useCallback(() => {
    if (!firstPickNoticeId) return undefined;
    return () => setFirstPickNoticeId(null);
  }, [firstPickNoticeId]));
  const footer = questionFooter(myPicks, firstPickNoticeId);
  const showPeople = showParticipants(people);
  const menuCountsFailed = menuCountsQuery.isError && !menuCountsQuery.data;
  const hasEarlySections = Boolean(banner || questionQuery.isError || questionCategory || menuCountsFailed || unpicked.length);
  const startPick = (category?: Category) => router.push(category
    ? { pathname: '/pick/new', params: { categoryId: category.id, menuName: category.name } }
    : '/pick/new');
  const openReplyBanner = () => {
    if (!banner) return;
    // Same destination and read contract as the notifications tab: only this group is marked read.
    router.push({ pathname: '/pick/[pickId]', params: {
      pickId: banner.target.pickId,
      notificationGroupId: banner.target.groupId,
      notificationSnapshot: banner.target.snapshot,
      notificationKind: 'comment',
    } });
  };
  const shareFirstPick = () => {
    if (footer.kind !== 'first-pick-done') return;
    const { pick, profile, item, category } = footer.pick;
    void sharePick({
      pickId: pick.id, username: profile?.username ?? '', categoryName: category?.name ?? '',
      itemName: item?.name ?? '', oneLineReview: pick.oneLineReview,
    }).catch(() => undefined);
  };

  useEffect(() => {
    if (selectedCategoryGroupId && (!showCategoryFilters || !categoryFilters.some((group) => group.id === selectedCategoryGroupId))) {
      setSelectedCategoryGroupId(null);
    }
  }, [categoryFilters, selectedCategoryGroupId, showCategoryFilters]);
  const refresh = () => {
    if (isSessionLoading || sessionError) return;
    if (discovery === 'popular' && !itemRankingQuery.isFetching) void itemRankingQuery.refetch({ cancelRefetch: false });
    if (!menuCountsQuery.isFetching) void menuCountsQuery.refetch({ cancelRefetch: false });
    if (!questionQuery.isFetching) void questionQuery.refetch({ cancelRefetch: false });
    if (!participantsQuery.isFetching) void participantsQuery.refetch({ cancelRefetch: false });
    // Signed in only: a disabled query's refetch() would still run for a signed-out viewer.
    if (replyUserId && !replyBannerQuery.isFetching) void replyBannerQuery.refetch({ cancelRefetch: false });
    if (showFollowing) {
      if (!followingQuery.isFetching) void followingQuery.refetch({ cancelRefetch: false });
      return;
    }
    if (!homeQuery.isFetching) void homeQuery.refetch({ cancelRefetch: false });
  };
  const openProfile = (username: string) => router.push({ pathname: '/u/[username]', params: { username, returnTo: '/' } });
  // Both feed scopes render the same current-Pick row (Figma 30-1D): no comments/share on Home.
  const renderFeedCard = (pick: HomeFeedPick) => <HomePickRow pick={pick} mine={pick.userId === user?.id}
    onOpenItem={() => openItem(pick.itemId)}
    onOpenProfile={() => openProfile(pick.username)}
    onOpenProvider={pick.providerId ? () => router.push({ pathname: '/provider/[providerId]', params: { providerId: pick.providerId!, scope: 'provider' } }) : undefined} />;
  const feedGap = () => <View style={styles.feedGap} />;

  const listHeader = <>
    {OnePickFeatures.followingFeed && user && !followDefaultPending ? <View style={styles.scopeRow}>
      {(['following', 'all'] as const).map((scope) => {
        const selected = feedScope === scope;
        return <Pressable key={scope} accessibilityRole="tab" accessibilityState={{ selected }}
          accessibilityLabel={scope === 'all' ? '전체 원픽 보기' : '팔로잉 원픽 보기'}
          onPress={() => chooseFeedScope(scope)}
          style={({ pressed }) => [styles.scopeTab, selected && styles.scopeTabSelected, pressed && styles.pressed]}>
          <Text style={[styles.scopeText, selected && styles.scopeTextSelected]}>{scope === 'all' ? '전체' : '팔로잉'}</Text>
        </Pressable>;
      })}
    </View> : null}
  </>;

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      {/* The header stays fixed; Home scrolls as one list below it. */}
      <View style={styles.fixedHeader}><HomeHeader onOpenItem={openItem} /></View>
      {showFollowing ? <FlatList
        data={followingItems}
        keyExtractor={(pick) => pick.pickId}
        renderItem={({ item: pick }) => renderFeedCard(pick)}
        ItemSeparatorComponent={feedGap}
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
          {followingQuery.isPending ? <StateCard loading title="팔로우한 사람들의 원픽을 불러오고 있어요." /> : null}
          {followingQuery.isError && !followingQuery.data ? <StateCard tone="danger" title="팔로잉 원픽을 불러오지 못했어요." text="연결 상태를 확인한 뒤 다시 시도해주세요."
            action={{ label: '다시 불러오기', disabled: followingQuery.isFetching, onPress: refresh }} /> : null}
          {followingQuery.data && !followingItems.length ? <View style={styles.followingEmpty}>
            <StateCard title="아직 팔로잉 원픽이 없어요." text="프로필에서 팔로우한 사람이 원픽을 고르면 여기에 이유와 함께 보여요. 친구에게 내 프로필을 공유해 원픽으로 초대해보세요."
              action={{ label: '전체 원픽 보기', onPress: () => chooseFeedScope('all') }} />
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
        data={ready ? visiblePicks : []}
        keyExtractor={(pick) => pick.pickId}
        renderItem={({ item: pick }) => renderFeedCard(pick)}
        ItemSeparatorComponent={feedGap}
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
            <Text style={styles.signinText}>카테고리마다 하나를 고르고 이유를 남겨보세요.</Text>
          </View>
          <Button size="sm" label="시작하기" accessibilityLabel="로그인하고 내 추천 원픽 만들기"
            onPress={() => router.push({ pathname: '/auth/login', params: { action: 'home' } })} />
        </View>}

        {ready && hasEarlySections ? <View style={styles.earlyStack}>
          {questionQuery.isError ? <StateCard compact tone="danger" title="오늘의 질문을 불러오지 못했어요."
            action={{ label: '다시 불러오기', disabled: questionQuery.isFetching, onPress: () => { if (!questionQuery.isFetching) void questionQuery.refetch(); } }} /> : null}
          {questionCategory ? <HomeQuestionCard category={questionCategory}
            answerCount={menuCountsQuery.data ? menuCountsQuery.data.get(questionCategory.id) ?? 0 : null}
            answered={Boolean(myAnswer)} footer={footer}
            onAnswer={() => startPick(questionCategory)}
            onBrowseAnswers={() => router.push({ pathname: '/menu/[slug]', params: { slug: questionCategory.slug } })}
            onRegister={() => startPick()} onShareFirstPick={shareFirstPick} /> : null}
          {banner ? <HomeReplyBanner count={banner.count} onPress={openReplyBanner} /> : null}
          {menuCountsFailed ? <StateCard compact tone="danger" title="메뉴별 원픽 수를 불러오지 못했어요."
            action={{ label: '다시 불러오기', disabled: menuCountsQuery.isFetching, onPress: () => { if (!menuCountsQuery.isFetching) void menuCountsQuery.refetch(); } }} /> : null}
          {unpicked.length ? <HomeUnpickedMenus categories={unpicked} onPick={startPick} /> : null}
        </View> : null}

        {/* 30E: the existing "많이 고른 메뉴" takes the same slot once everyone has 30+ Picks. */}
        {showRanking ? <View style={styles.rankingSection}>
          <View style={styles.rankingHeader}>
            <Text accessibilityRole="header" style={styles.rankingSort}>최근 7일 원픽 많은 순</Text>
          </View>
          {itemRankingQuery.isPending ? <StateCard compact loading title="인기 메뉴를 불러오고 있어요." /> : null}
          {itemRankingQuery.isError ? <StateCard compact tone="danger" title="인기 메뉴를 불러오지 못했어요."
            text="메뉴 탐색은 탐색 탭에서 이어갈 수 있어요."
            action={{ label: '메뉴 둘러보기', onPress: () => router.push('/explore') }} /> : null}
          {!itemRankingQuery.isPending && !itemRankingQuery.isError && rankedItems.length ? <View style={styles.menuGrid}>
            {rankedItems.map((item) => <RecentItemCard key={item.itemId} item={item} onOpen={() => openItem(item.itemId)} />)}
          </View> : null}
          {!itemRankingQuery.isPending && !itemRankingQuery.isError && !rankedItems.length ? <StateCard compact
            title="최근 7일 원픽이 아직 없어요." text="원픽이 쌓이면 많이 고른 메뉴를 보여드릴게요."
            action={{ label: '전체 메뉴 보기', onPress: () => router.push('/explore') }} /> : null}
        </View> : null}

        {showRanking ? <View style={styles.sectionDivider} /> : null}
        <View style={styles.feedHeader}>
          <Text accessibilityRole="header" style={styles.feedTitle}>모두의 원픽</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="모두의 원픽 더보기" onPress={() => router.push('/feed')}
            hitSlop={{ top: 8, bottom: 8, left: 12, right: 8 }}
            style={({ pressed }) => [styles.moreButton, pressed && styles.pressed]}>
            <Text style={styles.moreText}>더보기</Text>
          </Pressable>
        </View>

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

        {isLoading ? <StateCard loading title="원픽을 불러오고 있어요." /> : null}
        {sessionError || (!isSessionLoading && homeQuery.isError && !data) ? <StateCard tone="danger"
          title={sessionError ? '로그인 상태를 확인하지 못했어요.' : '원픽을 불러오지 못했어요.'}
          text="연결 상태를 확인한 뒤 다시 시도해주세요."
          action={{ label: '다시 불러오기', disabled: !sessionError && homeQuery.isFetching, onPress: sessionError ? retrySession : refresh }} /> : null}

        {ready && data ? <>
          {Platform.OS === 'web' || (homeQuery.isError && !homeQuery.isFetchNextPageError) ? <View style={styles.refreshRow}>
            {homeQuery.isError && !homeQuery.isFetchNextPageError ? <Text accessibilityRole="alert" style={styles.refreshError}>최신 원픽을 확인하지 못했어요. 마지막으로 불러온 내용을 표시하고 있어요.</Text> : null}
            <Button variant="ghost" size="sm" accessibilityLabel="홈 원픽 새로고침" disabled={homeQuery.isFetching} onPress={refresh}
              label={homeQuery.isFetching ? '새로고침 중…' : homeQuery.isError && !homeQuery.isFetchNextPageError ? '다시 불러오기' : '새로고침'} />
          </View> : null}
          {!data.picks.length ? <StateCard title={user ? '첫 원픽을 골라보세요.' : '아직 공개된 매장 원픽이 없어요.'} text="매장에서 먹은 메뉴를 원픽으로 고르면 이유와 함께 여기에 보여요."
            action={user ? { label: '내 원픽 먼저 고르기', onPress: () => router.push('/pick/new') } : undefined} /> : null}
        </> : null}
        </>}
        ListEmptyComponent={ready && data && data.picks.length > 0 && selectedCategoryGroup ? <StateCard
          title={`${selectedCategoryGroup.name}에서 아직 표시할 원픽이 없어요.`}
          text="현재 불러온 원픽에는 없지만 다음 페이지에 더 있을 수 있어요."
          action={homeQuery.hasNextPage
            ? { label: '다음 원픽 더 불러오기', accessibilityLabel: selectedCategoryGroup.name + ' 다음 원픽 더 불러오기', disabled: homeQuery.isFetching, onPress: () => { if (!homeQuery.isFetching) void homeQuery.fetchNextPage({ cancelRefetch: false }); } }
            : { label: '전체 보기', accessibilityLabel: '전체 카테고리 보기', onPress: () => setSelectedCategoryGroupId(null) }} /> : null}
        ListFooterComponent={ready && data ? <>
          {showPeople ? <View style={styles.inviteFooter}><HomePeopleRow people={people} onOpenProfile={openProfile} /></View> : null}
          {/* 30E 834:4889: invite reuses the profile share path. 의견 보내기 has no in-app destination yet (#762). */}
          {user ? <View style={styles.inviteFooter}><HomeInviteRow onInvite={() => router.push('/profile')} /></View>
            : <View style={styles.footer}><BrandMark size="sm" /><Text style={styles.footerText}>지금 가장 좋아하는 하나를 원픽으로 골라보세요.</Text></View>}
        </> : null}
      />}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: OnePick.bgDefault },
  content: { width: '100%', maxWidth: OnePick.maxWidth, alignSelf: 'center', paddingHorizontal: OnePickLayout.homeFeedGutter, paddingBottom: OnePickSpace.xxl },
  signinStrip: { flexDirection: 'row', alignItems: 'center', gap: OnePickSpace.md, padding: OnePickSpace.lg, marginTop: OnePickSpace.sm, marginBottom: OnePickSpace.lg, borderWidth: 1, borderColor: OnePick.borderDefault, borderRadius: OnePickRadius.lg, backgroundColor: OnePick.bgDefault },
  signinCopy: { flex: 1, minWidth: 0 },
  signinTitle: { ...OnePickType.bodyMedium, color: OnePick.textPrimary },
  signinText: { ...OnePickType.caption, color: OnePick.textSecondary, marginTop: 2 },
  categorySection: { marginBottom: OnePickSpace.xxl },
  editorialSection: { marginBottom: OnePickSpace.xxl },
  editorialList: { gap: OnePickSpace.sm, marginTop: OnePickSpace.md },
  editorialCard: { padding: OnePickSpace.lg, borderWidth: 1, borderColor: OnePick.borderDefault, borderRadius: OnePickRadius.lg, backgroundColor: OnePick.bgDefault },
  editorialTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: OnePickSpace.sm, marginBottom: OnePickSpace.md },
  editorialKicker: { ...OnePickType.captionMedium, color: OnePick.textAccent },
  editorialPath: { ...OnePickType.caption, flex: 1, color: OnePick.textSecondary, textAlign: 'right' },
  editorialBody: { flexDirection: 'row', alignItems: 'center', gap: OnePickSpace.md },
  editorialCopy: { flex: 1, minWidth: 0 },
  editorialNote: { ...OnePickType.body, color: OnePick.textPrimary, marginTop: OnePickSpace.sm },
  editorialCount: { ...OnePickType.caption, color: OnePick.textSecondary, marginTop: OnePickSpace.sm },
  scopeRow: { flexDirection: 'row', gap: OnePickSpace.sm, marginTop: OnePickSpace.xs, marginBottom: OnePickSpace.lg, alignSelf: 'flex-start' },
  scopeTab: { minHeight: 32, minWidth: 64, alignItems: 'center', justifyContent: 'center', borderRadius: OnePickRadius.full, paddingHorizontal: OnePickSpace.md, borderWidth: 1, borderColor: 'transparent', backgroundColor: OnePick.bgMuted },
  scopeTabSelected: { backgroundColor: OnePick.actionPrimary, borderColor: OnePick.actionPrimary },
  scopeText: { ...OnePickType.captionMedium, color: OnePick.textSecondary },
  scopeTextSelected: { color: OnePick.onAction },
  categoryFilterRow: { gap: OnePickSpace.sm, paddingVertical: OnePickSpace.sm, paddingRight: OnePickSpace.xs, marginBottom: OnePickSpace.sm },
  fixedHeader: { width: '100%', maxWidth: OnePick.maxWidth, alignSelf: 'center', paddingHorizontal: OnePickSpace.gutter, backgroundColor: OnePick.bgDefault },
  // Figma 30-1 (92:39): content starts 12 below the header; header row 28 high, 12 above the grid.
  rankingSection: { marginTop: OnePickSpace.md },
  // Figma 30E 834:4748: content starts 12 below the header, 24 between sections.
  earlyStack: { gap: OnePickSpace.xxl, marginTop: OnePickSpace.md, marginBottom: OnePickSpace.xxl },
  inviteFooter: { marginTop: OnePickSpace.xxl },
  rankingHeader: { height: 28, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: OnePickSpace.md },
  rankingSort: { ...OnePickType.bodyMedium, color: OnePick.textSecondary },
  menuGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 14 },
  // Light gray rule between 인기 메뉴 and 사람들의 원픽, 24px above and below.
  sectionDivider: { height: 1, backgroundColor: '#E5E5EB', marginVertical: 24 },
  feedHeader: { height: 28, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: OnePickSpace.md },
  feedTitle: { ...OnePickType.headline, color: OnePick.textPrimary },
  // 28-high header row; hitSlop keeps the 44 touch target.
  moreButton: { height: 28, alignItems: 'flex-end', justifyContent: 'center' },
  moreText: { ...OnePickType.caption, color: OnePick.textSecondary },
  feedGap: { height: OnePickSpace.xxl },
  followingEmpty: { alignItems: 'center', gap: OnePickSpace.xs },
  pageLoading: { padding: OnePickSpace.xl },
  endText: { ...OnePickType.caption, color: OnePick.textSecondary, textAlign: 'center', paddingVertical: OnePickSpace.xxl },
  itemName: { ...OnePickType.headline, color: OnePick.textPrimary },
  categoryGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: OnePickSpace.md },
  categoryCard: { width: '46%', flexGrow: 1, minHeight: 88, justifyContent: 'space-between', padding: OnePickSpace.lg, borderWidth: 1, borderColor: OnePick.borderDefault, borderRadius: OnePickRadius.lg, backgroundColor: OnePick.bgDefault },
  categoryName: { ...OnePickType.headline, color: OnePick.textPrimary },
  categoryAction: { ...OnePickType.caption, color: OnePick.textSecondary, marginTop: OnePickSpace.sm },
  refreshRow: { alignItems: 'flex-end', marginBottom: OnePickSpace.md },
  refreshError: { ...OnePickType.body, alignSelf: 'stretch', color: OnePick.textDanger },
  footer: { flexDirection: 'row', alignItems: 'center', gap: OnePickSpace.md, borderTopWidth: 1, borderTopColor: OnePick.borderDefault, marginTop: OnePickSpace.xxxl, paddingTop: OnePickSpace.xl },
  footerText: { ...OnePickType.body, color: OnePick.textSecondary, flex: 1 },
  pressed: { opacity: 0.65 },
});


