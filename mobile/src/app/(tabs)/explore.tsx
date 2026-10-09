import { useLocalSearchParams, useRouter } from 'expo-router';
import { PickPhoto } from '@/components/pick-photo';
import { Button, Chip, Icon, SectionHeader, StateCard } from '@/components/ui';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Image, Platform, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ExploreSearchResults } from '@/components/explore-search-results';
import { ItemSearch } from '@/components/item-search';
import { useCategoryTopItems, useExploreCategories, useFoodMenuPickCounts, useRecentPickedItems } from '@/hooks/useExploreData';
import { browseScope } from '@/lib/categories/browseScope';
import { browseCategoryGroups } from '@/lib/categories/categoryTree';
import { categoryWithChannels, homeChannelLabel } from '@/lib/home/homeChannels';
import type { Category } from '@/types/domain/category';
import { OnePick, OnePickFeatures, OnePickMvp, OnePickRadius, OnePickSpace, OnePickThresholds, OnePickType } from '@/constants/onepick';
import { useAuthSession } from '@/hooks/useAuthSession';
import type { PickChannel } from '@/lib/items/pickChannel';

type ExploreParams = { search?: string | string[]; query?: string | string[] };
const scalar = (value: string | string[] | undefined) => typeof value === 'string' ? value : undefined;

export default function ExploreScreen() {
  const router = useRouter();
  const { user } = useAuthSession();
  // An empty channel of a searched dish starts registration there: 매장/온라인 search
  // for the menu, or the recipe link flow with the dish preselected.
  const registerDish = (categoryId: string, channel: PickChannel) => {
    router.push(channel === 'recipe'
      ? { pathname: '/pick/recipe', params: { categoryId } }
      : { pathname: '/pick/find', params: { categoryId, channel } });
  };
  const params = useLocalSearchParams<ExploreParams>();
  const incomingQuery = (scalar(params.query) ?? '').trim().replace(/\s+/g, ' ').slice(0, 100);
  const [parentId, setParentId] = useState<string | undefined>();
  const [childId, setChildId] = useState<string | undefined>();
  // Without category chips the search box is the main way in, so it starts open.
  const [searchOpen, setSearchOpen] = useState(() => !OnePickFeatures.categoryChips || scalar(params.search) === '1' || incomingQuery.length > 0);
  const categories = useExploreCategories();
  const categoryCatalog = categories.data ?? [];
  const scope = useMemo(() => browseScope(categoryCatalog, {
    chips: Boolean(OnePickFeatures.categoryChips), groupSlug: OnePickMvp.browseGroupSlug,
  }), [categoryCatalog]);
  const menuCategories = useMemo(() => {
    if (scope.leafIds === null) return [];
    const byId = new Map(categoryCatalog.map((category) => [category.id, category]));
    return scope.leafIds.map((id) => byId.get(id)).filter((category): category is Category => Boolean(category));
  }, [categoryCatalog, scope.leafIds]);
  // Figma 31 (MVP): group chips over the food menus, menus by current Picks.
  const [menuGroupId, setMenuGroupId] = useState<string | null>(null);
  const menuCounts = useFoodMenuPickCounts(OnePickMvp.publicPickChannel, !scope.showChips);
  const menuGroups = useMemo(() => {
    const byId = new Map(categoryCatalog.map((category) => [category.id, category]));
    const ids = [...new Set(menuCategories.map((category) => category.parentId).filter((id): id is string => Boolean(id)))];
    return ids.map((id) => byId.get(id)).filter((category): category is Category => Boolean(category))
      .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, 'ko'));
  }, [categoryCatalog, menuCategories]);
  const visibleMenus = useMemo(() => {
    const counts = menuCounts.data;
    return menuCategories
      .filter((category) => !menuGroupId || category.parentId === menuGroupId)
      .map((category, index) => ({ category, index, count: counts?.get(category.id) ?? 0 }))
      .sort((a, b) => b.count - a.count || a.index - b.index);
  }, [menuCategories, menuCounts.data, menuGroupId]);
  // Figma 43: typing in the explore box swaps the menu list for inline results (no separate search screen).
  const [searchText, setSearchText] = useState(incomingQuery);
  useEffect(() => { setSearchText(incomingQuery); }, [incomingQuery]);
  const searchActive = !scope.showChips && searchText.trim().length > 0;
  const searchMenus = useMemo(() => menuCategories.map((category) => ({ category, count: menuCounts.data?.get(category.id) ?? 0 })),
    [menuCategories, menuCounts.data]);
  const menuLoadFailed = categories.isError || (!scope.showChips && menuCounts.isError);
  // External catalogs (movie, book...) are offered only for categories being browsed.
  const inScope = (category?: Category) =>
    category && (scope.leafIds === null || scope.leafIds.includes(category.id)) ? category : undefined;
  const groups = useMemo(() => browseCategoryGroups(categoryCatalog), [categoryCatalog]);
  const group = groups.find((entry) => entry.category.id === parentId);
  const selectedCategoryId = group?.directlySelectable ? group.category.id : group?.children.find((child) => child.id === childId)?.id;
  const selectedCategory = categoryCatalog.find((category) => category.id === selectedCategoryId);
  const selectedCategoryLabel = selectedCategory?.name ?? null;
  const movieCategory = inScope(categories.data?.find((category) => category.slug === 'movie'));
  const dramaCategory = inScope(categories.data?.find((category) => category.slug === 'drama'));
  const musicCategory = inScope(categories.data?.find((category) => category.slug === 'music'));
  const gameCategory = inScope(categories.data?.find((category) => category.slug === 'game'));
  const bookCategory = inScope(categories.data?.find((category) => category.slug === 'book'));
  const youtubeCategory = inScope(categories.data?.find((category) => category.slug === 'youtube'));
  const pokemonCategory = inScope(categories.data?.find((category) => category.slug === 'pokemon'));
  const topItems = useCategoryTopItems(selectedCategoryId, OnePickMvp.publicPickChannel);
  // The restaurant-first MVP lands on menus. Keep the older recent-item browse only
  // for the future category-chip mode so we do not fetch an unused provider list.
  const recentItems = useRecentPickedItems(scope.leafIds, scope.showChips && !selectedCategoryId && Boolean(categories.data), false);
  const recentTitle = '최근 원픽된 항목';
  // Gate all ranking details together, including accessibility and first-place styling.
  // A sum across TOP 3 would reveal rankings too early (e.g. three different 1-pick items).
  const topPickCount = topItems.data?.find((item) => item.rank === 1)?.pickCount ?? 0;
  const showRankingDetail = OnePickFeatures.exploreRankingDetail &&
    topPickCount >= OnePickThresholds.exploreRankingMinPicks;
  const hasExternalSearch = [movieCategory, dramaCategory, musicCategory, gameCategory, bookCategory, youtubeCategory, pokemonCategory]
    .some((category) => category && (!selectedCategoryId || selectedCategoryId === category.id));

  useEffect(() => {
    if (scalar(params.search) === '1' || incomingQuery.length > 0) setSearchOpen(true);
  }, [incomingQuery, params.search]);

  useEffect(() => {
    if (parentId && !groups.some((entry) => entry.category.id === parentId)) {
      setParentId(undefined);
      setChildId(undefined);
      return;
    }
    if (childId && group && !group.children.some((child) => child.id === childId)) {
      setChildId(undefined);
    }
  }, [childId, group, groups, parentId]);

  const refresh = () => {
    if (!categories.isFetching) void categories.refetch();
    if (!scope.showChips && !menuCounts.isFetching) void menuCounts.refetch();
    if (selectedCategoryId && !topItems.isFetching) void topItems.refetch({ cancelRefetch: false });
    if (scope.showChips && !selectedCategoryId && categories.data && !recentItems.isFetching) void recentItems.refetch({ cancelRefetch: false });
  };
  const openItem = (itemId: string) => router.push({ pathname: '/item/[itemId]', params: { itemId } });

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={categories.isRefetching || menuCounts.isRefetching || topItems.isRefetching || (recentItems.isRefetching && !recentItems.isFetchingNextPage)} onRefresh={refresh} tintColor={OnePick.accent} />}>
        <View style={styles.titleRow}>
          <Text style={styles.title}>{scope.showChips ? '카테고리 탐색' : '탐색'}</Text>
          {/* Figma 31: the search box is always there in the MVP; the toggle is chip mode only. */}
          {scope.showChips ? <Pressable accessibilityRole="button" accessibilityLabel={searchOpen ? '검색 닫기' : '검색 열기'}
            accessibilityState={{ expanded: searchOpen }} onPress={() => setSearchOpen((open) => !open)}
            style={({ pressed }) => [styles.searchButton, searchOpen && styles.searchButtonActive, pressed && styles.pressed]}>
            {searchOpen ? <Icon name="close" color={OnePick.actionPrimary} /> : <Icon name="search" color={OnePick.textPrimary} />}
          </Pressable> : null}
        </View>
        {scope.showChips ? <Text style={styles.subtitle}>관심 있는 분야부터, 나에게 맞는 원픽을 찾아보세요.</Text> : null}
        {searchOpen || !scope.showChips ? <View style={styles.searchPanel}>
          {scope.showChips ? <>
            <Text style={styles.searchScope}>{selectedCategoryLabel ? `${selectedCategoryLabel}에서 검색` : '전체 항목 검색'}</Text>
            <Text style={styles.searchHint}>
              {hasExternalSearch
                ? '찾는 항목이 없으면 외부 카탈로그에서 이어서 검색할 수 있어요.'
                : '원픽에 등록된 항목을 검색해요.'}
            </Text>
          </> : null}
          {!scope.showChips ? <View style={styles.searchBox}>
            <TextInput accessibilityLabel="메뉴나 매장 이름으로 검색" autoCapitalize="none" autoCorrect={false} maxLength={100}
              placeholder="메뉴나 매장 이름으로 검색" placeholderTextColor={OnePick.textSecondary} returnKeyType="search"
              value={searchText} onChangeText={setSearchText} style={styles.searchInput} />
            {searchText.length ? <Pressable accessibilityRole="button" accessibilityLabel="검색어 지우기" onPress={() => setSearchText('')}
              style={({ pressed }) => [styles.clearButton, pressed && styles.pressed]}>
              <Icon name="clear" size="sm" color={OnePick.textTertiary} />
            </Pressable> : null}
          </View> : <ItemSearch key={`${selectedCategoryId ?? 'all'}:${incomingQuery}`} compact categoryId={selectedCategoryId}
            initialQuery={incomingQuery} showExternalActionsWithResults
            onSearchMovie={movieCategory && (!selectedCategoryId || selectedCategoryId === movieCategory.id)
              ? (query) => router.push({ pathname: '/pick/find', params: { categoryId: movieCategory.id, query } }) : undefined}
            onSearchDrama={dramaCategory && (!selectedCategoryId || selectedCategoryId === dramaCategory.id)
              ? (query) => router.push({ pathname: '/pick/find', params: { categoryId: dramaCategory.id, query } }) : undefined}
            onSearchMusic={musicCategory && (!selectedCategoryId || selectedCategoryId === musicCategory.id)
              ? (query) => router.push({ pathname: '/pick/music', params: { categoryId: musicCategory.id, title: query } }) : undefined}
            onSearchGame={gameCategory && (!selectedCategoryId || selectedCategoryId === gameCategory.id)
              ? (query) => router.push({ pathname: '/pick/game', params: { categoryId: gameCategory.id, query } }) : undefined}
            onSearchBook={bookCategory && (!selectedCategoryId || selectedCategoryId === bookCategory.id)
              ? (query) => router.push({ pathname: '/pick/book', params: { categoryId: bookCategory.id, query } }) : undefined}
            onSearchYouTube={youtubeCategory && (!selectedCategoryId || selectedCategoryId === youtubeCategory.id)
              ? (query) => router.push({ pathname: '/pick/youtube', params: { categoryId: youtubeCategory.id, query } }) : undefined}
            onSearchPokemon={pokemonCategory && (!selectedCategoryId || selectedCategoryId === pokemonCategory.id)
              ? (query) => router.push({ pathname: '/pick/pokemon', params: { categoryId: pokemonCategory.id, query } }) : undefined}
            dishChannels={{ userId: user?.id, channel: OnePickMvp.publicPickChannel, onRegister: registerDish }}
            onSelect={openItem} />}
        </View> : null}
        {searchActive && categories.data ? <View style={styles.menuSection}>
          <ExploreSearchResults query={searchText} menus={searchMenus} menuIds={menuCategories.map((category) => category.id)}
            onOpenMenu={(category) => router.push({ pathname: '/menu/[slug]', params: { slug: category.slug } })}
            onOpenItem={openItem} onRegister={() => router.push('/pick/new')} />
        </View> : null}
        {scope.showChips ? <Text style={styles.levelTitle}>상위 카테고리</Text> : null}
        {categories.isPending ? <ActivityIndicator accessibilityLabel="카테고리 불러오는 중" /> : null}
        {scope.showChips && categories.isError ? <StateCard compact tone="danger" title="카테고리를 불러오지 못했어요." action={{ label: '다시 불러오기', onPress: refresh }} /> : null}
        {!scope.showChips && !searchActive && menuLoadFailed ? <StateCard tone="danger" title="메뉴를 불러오지 못했어요." text="연결 상태를 확인한 뒤 다시 시도해주세요."
          action={{ label: '다시 불러오기', onPress: refresh }} /> : null}
        {scope.showChips && !categories.isPending && !categories.isError && groups.length ? <View style={styles.parentRow}>
          <Chip label="전체" accessibilityLabel="전체 카테고리 보기" selected={!parentId}
            onPress={() => { setParentId(undefined); setChildId(undefined); }} />
          {groups.map(({ category }) => {
            const selected = parentId === category.id;
            return <Chip key={category.id} label={category.name} accessibilityLabel={`${category.name} 상위 카테고리 보기`} selected={selected}
              onPress={() => { setParentId(category.id); setChildId(undefined); }} />;
          })}
        </View> : null}
        {scope.showChips && !categories.isPending && !categories.isError && !groups.length ? <Text style={styles.stateText}>아직 공개된 카테고리가 없어요.</Text> : null}

        {group && !group.directlySelectable ? <View style={styles.childPanel}>
          <View style={styles.childHeader}>
            <Text style={styles.childTitle}>{group.category.name} 카테고리</Text>
            <Text style={styles.childCount}>{group.children.length}개</Text>
          </View>
          <View style={styles.childList}>{group.children.map((category) => <Chip key={category.id} label={category.name}
            accessibilityLabel={`${category.name} 카테고리 보기`} selected={childId === category.id}
            onPress={() => setChildId(category.id)} />)}</View>
          {!group.children.length ? <Text style={styles.subtitle}>이 분야의 카테고리를 준비하고 있어요.</Text> : !selectedCategoryId ? <Text style={styles.subtitle}>하위 카테고리를 고르면 원픽을 볼 수 있어요.</Text> : null}
        </View> : null}
        {!scope.showChips && !searchActive && !selectedCategoryId && categories.data && !menuLoadFailed && menuCounts.data ? <View style={styles.menuSection}>
          {menuGroups.length > 1 ? <View style={styles.parentRow}>
            <Chip label="전체" accessibilityLabel="전체 메뉴 보기" selected={!menuGroupId} onPress={() => setMenuGroupId(null)} />
            {menuGroups.map((groupCategory) => <Chip key={groupCategory.id} label={groupCategory.name}
              accessibilityLabel={`${groupCategory.name} 메뉴 보기`} selected={menuGroupId === groupCategory.id}
              onPress={() => setMenuGroupId(groupCategory.id)} />)}
          </View> : null}
          <SectionHeader title={`메뉴 ${visibleMenus.length}`} description="원픽 많은 순 · 메뉴를 누르면 사람들의 원픽과 한줄평을 볼 수 있어요." />
          <View style={styles.menuList}>
            {visibleMenus.map(({ category, count }) => <Pressable key={category.id} accessibilityRole="button"
              accessibilityLabel={`${category.name} 메뉴 원픽 보기`}
              onPress={() => router.push({ pathname: '/menu/[slug]', params: { slug: category.slug } })}
              style={({ pressed }) => [styles.menuRow, pressed && styles.pressed]}>
              {category.imageUrl
                ? <Image source={{ uri: category.imageUrl }} accessibilityIgnoresInvertColors style={styles.menuImage} />
                : <View style={styles.menuFallback} accessible={false}><Text style={styles.menuInitial}>{category.name.slice(0, 1)}</Text></View>}
              <View style={styles.menuCopy}>
                <Text style={styles.menuName}>{category.name}</Text>
                <Text style={styles.menuHint}>{count >= OnePickThresholds.exploreRankingMinPicks ? `원픽 ${count}` : '원픽을 모으고 있어요.'}</Text>
              </View>
              <Icon name="chevronRight" size="sm" color={OnePick.textTertiary} style={styles.menuArrow} />
            </Pressable>)}
          </View>
          {!visibleMenus.length ? <StateCard title="아직 공개된 메뉴가 없어요." text="메뉴가 열리면 이곳에서 둘러볼 수 있어요." /> : null}
        </View> : null}
        {!selectedCategoryId && categories.data && scope.showChips ? <View style={styles.rankingSection}>
          <View style={styles.sectionHeader}>
            <SectionHeader title={recentTitle} description="가장 최근에 누군가의 원픽이 된 순서예요." />
          </View>
          {recentItems.isPending ? <ActivityIndicator accessibilityLabel="최근 원픽 불러오는 중" style={styles.rankingLoading} /> : null}
          {recentItems.isError && !recentItems.isFetchNextPageError ? <StateCard compact tone="danger" title="최근 원픽을 불러오지 못했어요."
            text={recentItems.data?.length ? '마지막으로 불러온 내용을 표시하고 있어요.' : '연결 상태를 확인한 뒤 다시 시도해주세요.'}
            action={{ label: recentItems.isFetching ? '불러오는 중…' : '다시 불러오기', accessibilityLabel: '최근 원픽 다시 불러오기', disabled: recentItems.isFetching,
              onPress: () => { if (!recentItems.isFetching) void recentItems.refetch({ cancelRefetch: false }); } }} /> : null}
          {recentItems.data?.map((item) => <View key={item.itemId} style={styles.rankCard}>
            <PickPhoto uri={item.thumbnailUrl} label={item.name} itemId={item.itemId} logoUri={item.brandLogoUrl} />
            <Pressable accessibilityRole="button" accessibilityLabel={`${item.name}, ${categoryWithChannels(item.categoryName, item.channels)}, 상세 보기`}
              onPress={() => openItem(item.itemId)} style={({ pressed }) => [styles.rankAction, pressed && styles.pressed]}>
              <View style={styles.rankCopy}>
                <Text style={styles.rankName}>{item.name}</Text>
                <Text style={styles.recentCategory}>{categoryWithChannels(item.categoryName, item.channels)}</Text>
              </View>
              <Icon name="chevronRight" size="sm" color={OnePick.textTertiary} style={styles.arrow} />
            </Pressable>
          </View>)}
          {recentItems.data?.length === 0 && !recentItems.isError ? <StateCard title="아직 원픽이 있는 매장이 없어요." text="첫 원픽이 등록되면 이곳에 표시돼요." /> : null}
          {recentItems.isFetchNextPageError ? <Text style={styles.refreshError}>다음 목록을 불러오지 못했어요. 더 보기를 다시 눌러주세요.</Text> : null}
          {recentItems.hasNextPage ? <Button variant="secondary" label={recentItems.isFetchingNextPage ? '불러오는 중…' : '더 보기'}
            accessibilityLabel="최근 원픽 더 보기" disabled={recentItems.isFetchingNextPage}
            onPress={() => { if (!recentItems.isFetchingNextPage) void recentItems.fetchNextPage({ cancelRefetch: false }); }} /> : null}
        </View> : null}
        {selectedCategoryLabel ? <Text style={styles.selectionLabel}>{selectedCategoryLabel}</Text> : null}
        {selectedCategoryId ? <View style={styles.rankingSection}>
          <View style={styles.sectionHeader}>
            <SectionHeader title={showRankingDetail ? `${selectedCategoryLabel} 원픽 TOP 3` : `${selectedCategoryLabel}의 원픽`}
              description={showRankingDetail ? '지금 이걸 원픽으로 고른 사람 수 기준이에요.' : undefined}
              action={Platform.OS === 'web' && topItems.data && !topItems.isError ? {
                label: topItems.isFetching ? '불러오는 중…' : '새로고침', accessibilityLabel: '카테고리 원픽 새로고침', disabled: topItems.isFetching,
                onPress: () => { if (!topItems.isFetching) void topItems.refetch({ cancelRefetch: false }); },
              } : undefined} />
          </View>
          {topItems.isPending ? <ActivityIndicator accessibilityLabel="원픽 불러오는 중" style={styles.rankingLoading} /> : null}
          {topItems.isError ? <StateCard compact tone="danger" title="원픽을 불러오지 못했어요."
            text={topItems.data ? '최신 원픽을 확인하지 못했어요. 마지막으로 불러온 내용을 표시하고 있어요.' : '연결 상태를 확인한 뒤 다시 시도해주세요.'}
            action={{ label: topItems.isFetching ? '불러오는 중…' : '다시 불러오기', accessibilityLabel: '카테고리 원픽 다시 불러오기', disabled: topItems.isFetching,
              onPress: () => { if (!topItems.isFetching) void topItems.refetch({ cancelRefetch: false }); } }} /> : null}
          {topItems.data?.map((item) => <View key={item.itemId} style={[styles.rankCard, showRankingDetail && item.rank === 1 && styles.rankCardFirst]}>
            {showRankingDetail ? <View style={styles.rankBadge}>
              {item.isTied ? <Text style={styles.rankTie}>공동</Text> : null}
              <Text style={styles.rankNumber}>{item.rank}</Text>
            </View> : null}
            <PickPhoto uri={item.thumbnailUrl} label={item.name} itemId={item.itemId} logoUri={item.brandLogoUrl} />
            <Pressable accessibilityRole="button"
              accessibilityLabel={showRankingDetail
                ? `${item.isTied ? '공동 ' : ''}${item.rank}위 ${item.name}, ${item.pickCount}명이 선택, 상세 보기`
                : `${item.name}, 상세 보기`}
              onPress={() => openItem(item.itemId)} style={({ pressed }) => [styles.rankAction, pressed && styles.pressed]}>
              <View style={styles.rankCopy}>
                <Text style={styles.rankName}>{item.name}</Text>
                {homeChannelLabel(item.channels) ? <Text style={styles.rankCount}>{homeChannelLabel(item.channels)}</Text> : null}
                {showRankingDetail ? <Text style={styles.rankCount}>{item.pickCount.toLocaleString()}명이 선택</Text> : null}
              </View>
              <Icon name="chevronRight" size="sm" color={OnePick.textTertiary} style={styles.arrow} />
            </Pressable>
          </View>)}
          {topItems.data?.length === 0 && !topItems.isError ? <StateCard title="아직 선택된 원픽이 없어요." text="첫 원픽이 등록되면 이곳에 표시돼요." /> : null}
          {showRankingDetail && topItems.data && topItems.data.length > 0 ? <Text style={styles.rankingFootnote}>같은 선택 수는 공동 순위 · 최대 3개</Text> : null}
          {selectedCategory && topItems.data && topItems.data.length > 0 ? <View style={styles.rankingLinkRow}>
            <Button variant="ghost" size="sm" label="전체 랭킹 보기 ›" accessibilityLabel={`${selectedCategoryLabel} 전체 원픽 랭킹 보기`}
              onPress={() => router.push({ pathname: '/ranking/[slug]', params: { slug: selectedCategory.slug } })} />
          </View> : null}
        </View> : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: OnePick.background },
  content: { width: '100%', maxWidth: OnePick.maxWidth, alignSelf: 'center', paddingHorizontal: OnePickSpace.gutter, paddingTop: OnePickSpace.xxl, paddingBottom: OnePickSpace.xxl },
  title: { ...OnePickType.pageTitle, color: OnePick.textPrimary },
  titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: OnePickSpace.md },
  searchButton: { width: 44, height: 44, borderRadius: OnePickRadius.full, alignItems: 'center', justifyContent: 'center', backgroundColor: OnePick.bgDefault, borderWidth: 1, borderColor: OnePick.borderDefault },
  searchButtonActive: { backgroundColor: OnePick.bgMuted, borderColor: OnePick.borderStrong },
  searchPanel: { marginTop: OnePickSpace.lg, gap: OnePickSpace.sm },
  searchBox: { minHeight: 48, flexDirection: 'row', alignItems: 'center', borderRadius: OnePickRadius.md, borderWidth: 1, borderColor: OnePick.borderDefault, backgroundColor: OnePick.bgDefault, paddingLeft: OnePickSpace.md },
  searchInput: { ...OnePickType.body, flex: 1, minHeight: 46, color: OnePick.textPrimary },
  clearButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  searchScope: { ...OnePickType.captionMedium, color: OnePick.textSecondary },
  searchHint: { ...OnePickType.caption, color: OnePick.textSecondary },
  subtitle: { ...OnePickType.body, color: OnePick.textSecondary, marginTop: OnePickSpace.sm },
  levelTitle: { ...OnePickType.headline, color: OnePick.textPrimary, marginTop: OnePickSpace.xxl, marginBottom: OnePickSpace.sm },
  parentRow: { flexDirection: 'row', flexWrap: 'wrap', gap: OnePickSpace.sm, paddingVertical: OnePickSpace.xs },
  childPanel: { padding: OnePickSpace.lg, marginTop: OnePickSpace.lg, borderRadius: OnePickRadius.lg, backgroundColor: OnePick.bgDefault, borderWidth: 1, borderColor: OnePick.borderDefault },
  childHeader: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: OnePickSpace.sm },
  childTitle: { ...OnePickType.headline, color: OnePick.textPrimary },
  childCount: { ...OnePickType.captionMedium, color: OnePick.textSecondary },
  childList: { flexDirection: 'row', flexWrap: 'wrap', gap: OnePickSpace.sm, marginTop: OnePickSpace.md },
  selectionLabel: { ...OnePickType.captionMedium, color: OnePick.textAccent, marginTop: OnePickSpace.lg },
  menuSection: { marginTop: OnePickSpace.xl, marginBottom: OnePickSpace.lg },
  menuList: { marginTop: OnePickSpace.sm, borderTopWidth: 1, borderTopColor: OnePick.borderDefault },
  menuRow: { minHeight: 76, flexDirection: 'row', alignItems: 'center', gap: OnePickSpace.md, paddingVertical: OnePickSpace.sm, borderBottomWidth: 1, borderBottomColor: OnePick.borderDefault },
  menuImage: { width: 56, height: 56, borderRadius: OnePickRadius.md, backgroundColor: OnePick.bgPlaceholder },
  menuFallback: { width: 56, height: 56, borderRadius: OnePickRadius.md, alignItems: 'center', justifyContent: 'center', backgroundColor: OnePick.bgPlaceholder },
  menuInitial: { ...OnePickType.headline, color: OnePick.textPrimary },
  menuCopy: { flex: 1, minWidth: 0, gap: 2 },
  menuName: { ...OnePickType.headline, color: OnePick.textPrimary },
  menuHint: { ...OnePickType.caption, color: OnePick.textSecondary },
  menuArrow: { marginLeft: OnePickSpace.xs  },
  rankingSection: { marginTop: OnePickSpace.sm, marginBottom: OnePickSpace.lg },
  rankingLoading: { marginVertical: OnePickSpace.xl },
  rankCard: { flexDirection: 'row', alignItems: 'center', padding: OnePickSpace.md, marginBottom: OnePickSpace.sm, borderRadius: OnePickRadius.lg, borderWidth: 1, borderColor: OnePick.borderDefault, backgroundColor: OnePick.bgDefault },
  rankCardFirst: { borderColor: OnePick.borderStrong, backgroundColor: OnePick.bgSubtle },
  rankBadge: { width: 28, alignItems: 'center', marginRight: OnePickSpace.sm },
  rankTie: { ...OnePickType.caption, color: OnePick.textSecondary },
  rankNumber: { ...OnePickType.title, color: OnePick.textPrimary },
  rankAction: { flex: 1, minHeight: 86, flexDirection: 'row', alignItems: 'center' },
  rankCopy: { flex: 1, paddingLeft: OnePickSpace.md },
  rankName: { ...OnePickType.headline, color: OnePick.textPrimary },
  recentCategory: { ...OnePickType.caption, color: OnePick.textSecondary, marginTop: OnePickSpace.xs },
  rankCount: { ...OnePickType.captionMedium, color: OnePick.textSecondary, marginTop: OnePickSpace.sm },
  rankingFootnote: { ...OnePickType.caption, color: OnePick.textSecondary, marginTop: 2 },
  rankingLinkRow: { alignItems: 'flex-end', marginTop: OnePickSpace.xs },
  sectionHeader: { marginBottom: OnePickSpace.lg },
  arrow: { marginLeft: OnePickSpace.xs  },
  stateText: { ...OnePickType.caption, color: OnePick.textSecondary, textAlign: 'center', marginTop: OnePickSpace.sm },
  refreshError: { ...OnePickType.body, alignSelf: 'stretch', color: OnePick.textDanger },
  pressed: { opacity: 0.7 },
});
