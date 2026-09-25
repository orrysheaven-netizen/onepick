import { useLocalSearchParams, useRouter } from 'expo-router';
import { PickPhoto } from '@/components/pick-photo';
import { Button, Chip, SectionHeader, StateCard } from '@/components/ui';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ItemSearch } from '@/components/item-search';
import { useCategoryTopItems, useExploreCategories } from '@/hooks/useExploreData';
import { browseCategoryGroups, categoryLabel } from '@/lib/categories/categoryTree';
import type { Category } from '@/types/domain/category';
import { OnePick, OnePickFeatures, OnePickThresholds } from '@/constants/onepick';

type ExploreParams = { search?: string | string[]; query?: string | string[] };
const scalar = (value: string | string[] | undefined) => typeof value === 'string' ? value : undefined;

export default function ExploreScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<ExploreParams>();
  const incomingQuery = (scalar(params.query) ?? '').trim().replace(/\s+/g, ' ').slice(0, 100);
  const [parentId, setParentId] = useState<string | undefined>();
  const [childId, setChildId] = useState<string | undefined>();
  const [searchOpen, setSearchOpen] = useState(() => scalar(params.search) === '1' || incomingQuery.length > 0);
  const categories = useExploreCategories();
  const categoryCatalog = categories.data ?? [];
  const groups = useMemo(() => browseCategoryGroups(categoryCatalog), [categoryCatalog]);
  const group = groups.find((entry) => entry.category.id === parentId);
  const selectedCategoryId = group?.directlySelectable ? group.category.id : group?.children.find((child) => child.id === childId)?.id;
  const selectedCategory = categoryCatalog.find((category) => category.id === selectedCategoryId);
  const selectedCategoryLabel = selectedCategory ? categoryLabel(selectedCategory, categoryCatalog) : null;
  // Leaves can sit two levels below a top-level group; show the path below the group name.
  const leafLabel = (category: Category) => {
    const full = categoryLabel(category, categoryCatalog);
    const prefix = group ? `${group.category.name} › ` : '';
    return prefix && full.startsWith(prefix) ? full.slice(prefix.length) : full;
  };
  const movieCategory = categories.data?.find((category) => category.slug === 'movie');
  const dramaCategory = categories.data?.find((category) => category.slug === 'drama');
  const musicCategory = categories.data?.find((category) => category.slug === 'music');
  const gameCategory = categories.data?.find((category) => category.slug === 'game');
  const bookCategory = categories.data?.find((category) => category.slug === 'book');
  const youtubeCategory = categories.data?.find((category) => category.slug === 'youtube');
  const pokemonCategory = categories.data?.find((category) => category.slug === 'pokemon');
  const topItems = useCategoryTopItems(selectedCategoryId);
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
    if (selectedCategoryId && !topItems.isFetching) void topItems.refetch({ cancelRefetch: false });
  };
  const openItem = (itemId: string) => router.push({ pathname: '/item/[itemId]', params: { itemId } });

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={categories.isRefetching || topItems.isRefetching} onRefresh={refresh} tintColor={OnePick.accent} />}>
        <View style={styles.titleRow}>
          <Text style={styles.title}>카테고리 탐색</Text>
          <Pressable accessibilityRole="button" accessibilityLabel={searchOpen ? '검색 닫기' : '검색 열기'}
            accessibilityState={{ expanded: searchOpen }} onPress={() => setSearchOpen((open) => !open)}
            style={({ pressed }) => [styles.searchButton, searchOpen && styles.searchButtonActive, pressed && styles.pressed]}>
            {searchOpen ? <Text style={styles.closeSearch}>×</Text> : <View accessible={false} style={styles.magnifier}><View style={styles.magnifierRing} /><View style={styles.magnifierHandle} /></View>}
          </Pressable>
        </View>
        <Text style={styles.subtitle}>관심 있는 분야부터, 나에게 맞는 원픽을 찾아보세요.</Text>
        {searchOpen ? <View style={styles.searchPanel}>
          <Text style={styles.searchScope}>{selectedCategoryLabel ? `${selectedCategoryLabel}에서 검색` : '전체 항목 검색'}</Text>
          <Text style={styles.searchHint}>
            {hasExternalSearch
              ? '찾는 항목이 없으면 외부 카탈로그에서 이어서 검색할 수 있어요.'
              : '원픽에 등록된 항목을 검색해요.'}
          </Text>
          <ItemSearch key={`${selectedCategoryId ?? 'all'}:${incomingQuery}`} compact categoryId={selectedCategoryId}
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
            onSelect={openItem} />
        </View> : null}
        <Text style={styles.levelTitle}>상위 카테고리</Text>
        {categories.isPending ? <ActivityIndicator accessibilityLabel="카테고리 불러오는 중" /> : null}
        {categories.isError ? <StateCard compact tone="danger" title="카테고리를 불러오지 못했어요." action={{ label: '다시 불러오기', onPress: refresh }} /> : null}
        {!categories.isPending && !categories.isError && groups.length ? <View style={styles.parentRow}>
          <Chip label="전체" accessibilityLabel="전체 카테고리 보기" selected={!parentId}
            onPress={() => { setParentId(undefined); setChildId(undefined); }} />
          {groups.map(({ category }) => {
            const selected = parentId === category.id;
            return <Chip key={category.id} label={category.name} accessibilityLabel={`${category.name} 상위 카테고리 보기`} selected={selected}
              onPress={() => { setParentId(category.id); setChildId(undefined); }} />;
          })}
        </View> : null}
        {!categories.isPending && !categories.isError && !groups.length ? <Text style={styles.stateText}>아직 공개된 카테고리가 없어요.</Text> : null}

        {group && !group.directlySelectable ? <View style={styles.childPanel}>
          <View style={styles.childHeader}>
            <Text style={styles.childTitle}>{group.category.name} 카테고리</Text>
            <Text style={styles.childCount}>{group.children.length}개</Text>
          </View>
          <View style={styles.childList}>{group.children.map((category) => <Chip key={category.id} label={leafLabel(category)}
            accessibilityLabel={`${group.category.name} › ${leafLabel(category)} 카테고리 보기`} selected={childId === category.id}
            onPress={() => setChildId(category.id)} />)}</View>
          {!group.children.length ? <Text style={styles.subtitle}>이 분야의 카테고리를 준비하고 있어요.</Text> : !selectedCategoryId ? <Text style={styles.subtitle}>하위 카테고리를 고르면 원픽을 볼 수 있어요.</Text> : null}
        </View> : null}
        {selectedCategoryLabel ? <Text style={styles.selectionLabel}>{selectedCategoryLabel}</Text> : null}
        {selectedCategoryId ? <View style={styles.rankingSection}>
          <View style={styles.sectionHeader}>
            <SectionHeader title={showRankingDetail ? `${selectedCategoryLabel} 원픽 TOP 3` : `${selectedCategoryLabel}의 원픽`}
              description={showRankingDetail ? '지금 이 제품을 원픽으로 고른 사람 수 기준이에요.' : undefined}
              action={Platform.OS === 'web' && topItems.data && !topItems.isError ? {
                label: topItems.isFetching ? '불러오는 중…' : '새로고침', accessibilityLabel: '카테고리 원픽 새로고침', disabled: topItems.isFetching,
                onPress: () => { if (!topItems.isFetching) void topItems.refetch({ cancelRefetch: false }); },
              } : undefined} />
          </View>
          {topItems.isPending ? <ActivityIndicator accessibilityLabel="원픽 불러오는 중" style={styles.rankingLoading} /> : null}
          {topItems.isError ? <StateCard compact tone="danger" title="원픽을 불러오지 못했어요"
            text={topItems.data ? '최신 원픽을 확인하지 못했어요. 마지막으로 불러온 내용을 표시하고 있어요.' : '연결 상태를 확인한 뒤 다시 시도해주세요.'}
            action={{ label: topItems.isFetching ? '불러오는 중…' : '다시 불러오기', accessibilityLabel: '카테고리 원픽 다시 불러오기', disabled: topItems.isFetching,
              onPress: () => { if (!topItems.isFetching) void topItems.refetch({ cancelRefetch: false }); } }} /> : null}
          {topItems.data?.map((item) => <View key={item.itemId} style={[styles.rankCard, showRankingDetail && item.rank === 1 && styles.rankCardFirst]}>
            {showRankingDetail ? <View style={styles.rankBadge}>
              {item.isTied ? <Text style={styles.rankTie}>공동</Text> : null}
              <Text style={styles.rankNumber}>{item.rank}</Text>
            </View> : null}
            <PickPhoto uri={item.thumbnailUrl} label={item.name} itemId={item.itemId} />
            <Pressable accessibilityRole="button"
              accessibilityLabel={showRankingDetail
                ? `${item.isTied ? '공동 ' : ''}${item.rank}위 ${item.name}, ${item.pickCount}명이 선택, 제품 상세 보기`
                : `${item.name}, 제품 상세 보기`}
              onPress={() => openItem(item.itemId)} style={({ pressed }) => [styles.rankAction, pressed && styles.pressed]}>
              <View style={styles.rankCopy}>
                <Text style={styles.rankName}>{item.name}</Text>
                {showRankingDetail ? <Text style={styles.rankCount}>{item.pickCount.toLocaleString()}명이 선택</Text> : null}
              </View>
              <Text style={styles.arrow}>›</Text>
            </Pressable>
          </View>)}
          {topItems.data?.length === 0 && !topItems.isError ? <StateCard title="아직 선택된 제품이 없어요" text="첫 원픽이 등록되면 이곳에 제품이 표시돼요." /> : null}
          {showRankingDetail && topItems.data && topItems.data.length > 0 ? <Text style={styles.rankingFootnote}>같은 선택 수는 공동 순위 · 최대 3개 제품</Text> : null}
        </View> : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: OnePick.background },
  content: { width: '100%', maxWidth: OnePick.maxWidth, alignSelf: 'center', paddingHorizontal: 20, paddingTop: 24, paddingBottom: 28 },
  title: { color: OnePick.text, fontSize: 26, fontWeight: '800', lineHeight: 34, letterSpacing: -0.6 },
  titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  searchButton: { width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center', backgroundColor: OnePick.surface, borderWidth: 1, borderColor: OnePick.border },
  searchButtonActive: { backgroundColor: OnePick.accentSoft, borderColor: OnePick.accent },
  magnifier: { width: 24, height: 24 },
  magnifierRing: { position: 'absolute', width: 16, height: 16, borderWidth: 2, borderColor: OnePick.text, borderRadius: 8, top: 1, left: 1 },
  magnifierHandle: { position: 'absolute', width: 10, height: 2, borderRadius: 1, backgroundColor: OnePick.text, transform: [{ rotate: '45deg' }], top: 18, left: 14 },
  closeSearch: { color: OnePick.accent, fontSize: 28, lineHeight: 30 },
  searchPanel: { marginTop: 18, gap: 8 },
  searchScope: { fontSize: 12, color: OnePick.muted },
  searchHint: { color: OnePick.muted, fontSize: 11, lineHeight: 17 },
  subtitle: { color: OnePick.muted, fontSize: 13, lineHeight: 20, marginTop: 8 },
  levelTitle: { color: OnePick.text, fontSize: 15, fontWeight: '800', marginTop: 28, marginBottom: 10 },
  parentRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingVertical: 5 },
  childPanel: { padding: 16, marginTop: 18, borderRadius: 18, backgroundColor: OnePick.surface, borderWidth: 1, borderColor: OnePick.border },
  childHeader: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 },
  childTitle: { color: OnePick.text, fontSize: 15, fontWeight: '900' },
  childCount: { color: OnePick.hint, fontSize: 11, fontWeight: '700' },
  childList: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 13 },
  selectionLabel: { color: OnePick.accent, fontSize: 12, fontWeight: '800', marginTop: 18 },
  rankingSection: { marginTop: 8, marginBottom: 18 },
  rankingLoading: { marginVertical: 20 },
  rankCard: { flexDirection: 'row', alignItems: 'center', padding: 12, marginBottom: 10, borderRadius: 20, borderWidth: 1, borderColor: OnePick.border, backgroundColor: OnePick.surface },
  rankCardFirst: { borderColor: OnePick.accentSoft, backgroundColor: OnePick.accentSoft },
  rankBadge: { width: 28, alignItems: 'center', marginRight: 10 },
  rankTie: { color: OnePick.muted, fontSize: 10, fontWeight: '600' },
  rankNumber: { color: OnePick.accent, fontSize: 25, fontWeight: '800' },
  rankAction: { flex: 1, minHeight: 86, flexDirection: 'row', alignItems: 'center' },
  rankCopy: { flex: 1, paddingLeft: 12 },
  rankName: { color: OnePick.text, fontSize: 15, lineHeight: 21, fontWeight: '800' },
  rankCount: { color: OnePick.accent, fontSize: 12, fontWeight: '700', marginTop: 8 },
  rankingFootnote: { color: OnePick.muted, fontSize: 11, lineHeight: 16, marginTop: 2 },
  sectionHeader: { marginBottom: 16 },
  arrow: { color: OnePick.hint, fontSize: 25, marginLeft: 5 },
  stateText: { color: OnePick.muted, fontSize: 12, lineHeight: 18, textAlign: 'center', marginTop: 9 },
  refreshError: { alignSelf: 'stretch', color: OnePick.danger, fontSize: 13, lineHeight: 20 },
  pressed: { opacity: 0.7 },
});
