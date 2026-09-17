import { useRouter } from 'expo-router';
import { PickPhoto } from '@/components/pick-photo';
import { useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ItemSearch } from '@/components/item-search';
import { useCategoryTopItems, useExploreCategories, useExploreData } from '@/hooks/useExploreData';
import { browseCategoryGroups } from '@/lib/categories/categoryTree';

export default function ExploreScreen() {
  const router = useRouter();
  const [parentId, setParentId] = useState<string | undefined>();
  const [childId, setChildId] = useState<string | undefined>();
  const [searchOpen, setSearchOpen] = useState(false);
  const categories = useExploreCategories();
  const groups = browseCategoryGroups(categories.data ?? []);
  const group = groups.find((entry) => entry.category.id === parentId);
  const selectedCategoryId = group?.directlySelectable ? group.category.id : group?.children.find((child) => child.id === childId)?.id;
  const selectedCategory = categories.data?.find((category) => category.id === selectedCategoryId);
  const query = useExploreData(selectedCategoryId, Boolean(selectedCategoryId));
  const topItems = useCategoryTopItems(selectedCategoryId);
  const refresh = () => {
    if (!categories.isFetching) void categories.refetch();
    if (selectedCategoryId && !query.isFetching) void query.refetch({ cancelRefetch: false });
    if (selectedCategoryId && !topItems.isFetching) void topItems.refetch({ cancelRefetch: false });
  };

  const openPick = (pickId: string) => {
    router.push({ pathname: '/pick/[pickId]', params: { pickId } });
  };

  const openItem = (itemId: string) => {
    router.push({ pathname: '/item/[itemId]', params: { itemId } });
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={categories.isRefetching || query.isRefetching || topItems.isRefetching} onRefresh={refresh} tintColor="#4945ED" />}>
        <View style={styles.titleRow}>
          <View><Text style={styles.eyebrow}>EXPLORE</Text><Text style={styles.title}>카테고리 탐색</Text></View>
          <Pressable accessibilityRole="button" accessibilityLabel={searchOpen ? '제품 검색 닫기' : '제품 검색 열기'}
            accessibilityState={{ expanded: searchOpen }} onPress={() => setSearchOpen((open) => !open)}
            style={({ pressed }) => [styles.searchButton, searchOpen && styles.searchButtonActive, pressed && styles.pressed]}>
            {searchOpen ? <Text style={styles.closeSearch}>×</Text> : <View accessible={false} style={styles.magnifier}><View style={styles.magnifierRing} /><View style={styles.magnifierHandle} /></View>}
          </Pressable>
        </View>
        <Text style={styles.subtitle}>관심 있는 분야부터, 나에게 맞는 원픽을 찾아보세요.</Text>
        {searchOpen ? <View style={styles.searchPanel}>
          <Text style={styles.searchScope}>{selectedCategory ? `${selectedCategory.name}에서 검색` : '전체 제품 검색'}</Text>
          <ItemSearch key={selectedCategoryId ?? 'all'} compact categoryId={selectedCategoryId} onSelect={openItem} />
        </View> : null}

        <Text style={styles.levelTitle}>1. 관심 분야를 골라주세요</Text>
        {categories.isPending ? <ActivityIndicator accessibilityLabel="카테고리 불러오는 중" /> : null}
        {categories.isError ? <View style={styles.stateCard}><Text style={styles.stateText}>카테고리를 불러오지 못했어요.</Text><Pressable accessibilityRole="button" onPress={refresh}><Text style={styles.refreshText}>다시 불러오기</Text></Pressable></View> : null}
        <View style={styles.categoryGrid}>
          {groups.map(({ category, children, directlySelectable }) => <Pressable key={category.id}
            accessibilityRole="button" accessibilityLabel={`${category.name} 1차 카테고리`}
            accessibilityState={{ selected: parentId === category.id }}
            onPress={() => { setParentId(category.id); setChildId(undefined); }}
            style={[styles.parentCard, parentId === category.id && styles.parentActive]}>
            <Text style={[styles.parentName, parentId === category.id && styles.parentNameActive]}>{category.name}</Text>
            <Text style={styles.parentHint}>{directlySelectable ? '원픽 둘러보기' : children.length ? `${children.length}개 카테고리` : '준비 중'}</Text>
            <Text style={styles.parentArrow}>↗</Text>
          </Pressable>)}
        </View>
        {!categories.isPending && !categories.isError && !groups.length ? <Text style={styles.stateText}>아직 공개된 카테고리가 없어요.</Text> : null}
        {group && !group.directlySelectable ? <View style={styles.childPanel}>
          <Text style={styles.sectionTitle}>2. {group.category.name}에서 골라주세요</Text>
          <View style={styles.childList}>{group.children.map((category) => <Pressable key={category.id} accessibilityRole="button"
            accessibilityLabel={`${category.name} 2차 카테고리`} accessibilityState={{ selected: childId === category.id }}
            onPress={() => setChildId(category.id)} style={[styles.chip, childId === category.id && styles.chipActive]}>
            <Text style={[styles.chipText, childId === category.id && styles.chipTextActive]}>{category.name}</Text>
          </Pressable>)}</View>
          {!group.children.length ? <Text style={styles.subtitle}>이 분야의 카테고리를 준비하고 있어요.</Text> : !selectedCategoryId ? <Text style={styles.subtitle}>하위 카테고리를 선택하면 제품과 원픽이 표시돼요.</Text> : null}
        </View> : null}

        {selectedCategoryId ? <Text style={styles.selectionLabel}>{group?.category.name}{group?.directlySelectable ? '' : ` › ${selectedCategory?.name}`}</Text> : null}

        {selectedCategoryId ? <View style={styles.rankingSection}>
          <View style={styles.sectionHeader}>
            <Text style={[styles.sectionTitle, styles.rankTitle]}>{selectedCategory?.name} 원픽 TOP 3</Text>
            <Pressable accessibilityRole="button" accessibilityLabel="제품 순위 새로고침"
              disabled={topItems.isFetching} onPress={() => { if (!topItems.isFetching) void topItems.refetch({ cancelRefetch: false }); }}
              style={({ pressed }) => [styles.refreshButton, (pressed || topItems.isFetching) && styles.pressed]}>
              <Text style={styles.refreshText}>{topItems.isFetching ? '불러오는 중…' : '새로고침'}</Text>
            </Pressable>
          </View>
          <Text style={styles.rankingDescription}>지금 이 제품을 원픽으로 고른 사람 수 기준이에요.</Text>
          {topItems.isPending ? <ActivityIndicator accessibilityLabel="제품 순위 불러오는 중" style={styles.rankingLoading} /> : null}
          {topItems.isError ? <Text accessibilityRole="alert" style={styles.refreshError}>
            {topItems.data ? '순위를 갱신하지 못했어요. 마지막으로 불러온 순위예요.' : '제품 순위를 불러오지 못했어요. 새로고침으로 다시 시도해주세요.'}
          </Text> : null}
          {topItems.data?.map((item) => <Pressable key={item.itemId} accessibilityRole="button"
            accessibilityLabel={`${item.isTied ? '공동 ' : ''}${item.rank}위 ${item.name}, ${item.pickCount}명이 선택, 제품 상세 보기`}
            onPress={() => openItem(item.itemId)}
            style={({ pressed }) => [styles.rankCard, item.rank === 1 && styles.rankCardFirst, pressed && styles.pressed]}>
            <View style={styles.rankBadge}>
              {item.isTied ? <Text style={styles.rankTie}>공동</Text> : null}
              <Text style={styles.rankNumber}>{item.rank}</Text>
            </View>
            <PickPhoto uri={item.thumbnailUrl} label={item.name} />
            <View style={styles.rankCopy}>
              <Text style={styles.rankName}>{item.name}</Text>
              <Text style={styles.rankCount}>{item.pickCount.toLocaleString()}명이 선택</Text>
            </View>
            <Text style={styles.arrow}>›</Text>
          </Pressable>)}
          {topItems.data?.length === 0 && !topItems.isError ? <View style={styles.emptyCard}>
            <Text style={styles.emptyTitle}>아직 선택된 제품이 없어요</Text>
            <Text style={styles.emptyText}>첫 원픽이 등록되면 이곳에 제품이 표시돼요.</Text>
          </View> : null}
          {topItems.data && topItems.data.length > 0 ? <Text style={styles.rankingFootnote}>같은 선택 수는 공동 순위 · 최대 3개 제품</Text> : null}
        </View> : null}

        {selectedCategoryId && query.isPending && !query.data ? (
          <View style={styles.stateCard}>
            <ActivityIndicator />
            <Text style={styles.stateText}>최근 원픽을 불러오고 있어요</Text>
          </View>
        ) : null}

        {selectedCategoryId && query.isError && !query.data ? (
          <View style={styles.stateCard}>
            <Text style={styles.stateTitle}>탐색 데이터를 불러오지 못했어요</Text>
            <Pressable accessibilityRole="button" disabled={query.isFetching} onPress={refresh} style={({ pressed }) => [styles.retryButton, pressed && styles.pressed]}>
              <Text style={styles.retryButtonText}>다시 불러오기</Text>
            </Pressable>
          </View>
        ) : null}

        {selectedCategoryId && query.data ? (
          <>
            <View style={styles.refreshRow}>
              {query.isError && !query.isFetchNextPageError ? (
                <Text accessibilityRole="alert" style={styles.refreshError}>최신 원픽을 확인하지 못했어요. 마지막으로 불러온 내용을 표시하고 있어요.</Text>
              ) : null}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="탐색 원픽 새로고침"
                disabled={query.isFetching}
                onPress={refresh}
                style={({ pressed }) => [styles.refreshButton, (pressed || query.isFetching) && styles.pressed]}>
                <Text style={styles.refreshText}>{query.isRefetching ? '새로고침 중…' : query.isError && !query.isFetchNextPageError ? '다시 불러오기' : '새로고침'}</Text>
              </Pressable>
            </View>
            <View style={styles.sectionHeader}>
              <View>
                <Text style={styles.sectionTitle}>사람들이 고른 이유</Text>
                <Text style={styles.sectionDescription}>사람들이 최근 공개한 현재 원픽이에요.</Text>
              </View>
              {query.isFetching && !query.isFetchingNextPage ? <ActivityIndicator size="small" /> : null}
            </View>

            {query.data.feed.length > 0 ? (
              query.data.feed.map(({ pick, profile, item, category }) => (
                <Pressable
                  key={pick.id}
                  onPress={() => openPick(pick.id)}
                  style={({ pressed }) => [styles.pickCard, pressed && styles.pressed]}>
                  <PickPhoto uri={item?.thumbnailUrl} label={item?.name ?? '제품 대표 이미지'} />
                  <View style={styles.pickCopy}>
                    <Text style={styles.pickMeta}>
                      {profile ? `@${profile.username}` : 'OnePick 사용자'} · {category?.name ?? '카테고리'}
                    </Text>
                    <Text style={styles.pickName}>{item?.name ?? '제품 정보 확인 중'}</Text>
                    <Text style={styles.pickReview}>“{pick.oneLineReview}”</Text>
                  </View>
                  <Text style={styles.arrow}>›</Text>
                </Pressable>
              ))
            ) : (
              <View style={styles.emptyCard}>
                <Text style={styles.emptyTitle}>아직 공개된 원픽이 없어요</Text>
                <Text style={styles.emptyText}>첫 원픽이 선택되면 이곳에서 사람들의 선택을 볼 수 있습니다.</Text>
              </View>
            )}

            {query.isFetchNextPageError ? (
              <Text accessibilityRole="alert" style={styles.stateText}>다음 원픽을 불러오지 못했어요. 다시 시도해주세요.</Text>
            ) : null}

            {query.hasNextPage ? (
              <Pressable
                accessibilityRole="button"
                disabled={query.isFetching}
                onPress={() => { if (!query.isFetching) void query.fetchNextPage({ cancelRefetch: false }); }}
                style={({ pressed }) => [styles.loadMoreButton, query.isFetching && styles.disabled, pressed && styles.pressed]}>
                {query.isFetchingNextPage ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.loadMoreText}>{query.isFetchNextPageError ? '원픽 더 보기 다시 시도' : '원픽 더 보기'}</Text>}
              </Pressable>
            ) : null}

          </>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#F5F6F8' },
  content: { width: '100%', maxWidth: 480, alignSelf: 'center', paddingHorizontal: 20, paddingTop: 24, paddingBottom: 28 },
  backButton: { width: 44, height: 44, justifyContent: 'center', marginLeft: -8, marginBottom: 8 },
  backText: { color: '#202124', fontSize: 36, lineHeight: 40, fontWeight: '300' },
  eyebrow: { color: '#4945ED', fontSize: 12, fontWeight: '800', letterSpacing: 2.8 },
  title: { color: '#202124', fontSize: 26, fontWeight: '800', lineHeight: 34, letterSpacing: -0.8, marginTop: 8 },
  titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  searchButton: { width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center', backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#E3E5EA' },
  searchButtonActive: { backgroundColor: '#EFEEFF', borderColor: '#4945ED' },
  magnifier: { width: 24, height: 24 },
  magnifierRing: { position: 'absolute', width: 16, height: 16, borderWidth: 2, borderColor: '#202124', borderRadius: 8, top: 1, left: 1 },
  magnifierHandle: { position: 'absolute', width: 10, height: 2, borderRadius: 1, backgroundColor: '#202124', transform: [{ rotate: '45deg' }], top: 18, left: 14 },
  closeSearch: { color: '#4945ED', fontSize: 28, lineHeight: 30 },
  searchPanel: { marginTop: 18, gap: 8 },
  searchScope: { fontSize: 12, color: '#747985' },
  subtitle: { color: '#747985', fontSize: 13, lineHeight: 20, marginTop: 8 },
  levelTitle: { color: '#202124', fontSize: 15, fontWeight: '700', marginTop: 28, marginBottom: 14 },
  categoryGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  parentCard: { width: '48%', flexGrow: 1, minHeight: 118, padding: 18, borderWidth: 1, borderColor: '#E3E5EA', borderRadius: 20, backgroundColor: '#FFFFFF' },
  parentActive: { backgroundColor: '#EFEEFF', borderColor: '#4945ED' },
  parentName: { color: '#202124', fontSize: 20, fontWeight: '800' },
  parentNameActive: { color: '#4945ED' },
  parentHint: { color: '#747985', fontSize: 12, marginTop: 8 },
  parentArrow: { color: '#4945ED', fontSize: 20, alignSelf: 'flex-end', marginTop: 8 },
  childPanel: { padding: 18, marginTop: 22, borderRadius: 20, backgroundColor: '#FFFFFF' },
  childList: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 16 },
  selectionLabel: { color: '#4945ED', fontSize: 14, fontWeight: '700', marginTop: 26 },
  rankingSection: { marginTop: 8, marginBottom: 18 },
  rankTitle: { flex: 1, marginRight: 12 },
  rankingDescription: { color: '#747985', fontSize: 12, lineHeight: 18, marginBottom: 16 },
  rankingLoading: { marginVertical: 20 },
  rankCard: { flexDirection: 'row', alignItems: 'center', padding: 12, marginBottom: 10, borderRadius: 20, borderWidth: 1, borderColor: '#E3E5EA', backgroundColor: '#FFFFFF' },
  rankCardFirst: { borderColor: '#B8B5FF', backgroundColor: '#F4F3FF' },
  rankBadge: { width: 28, alignItems: 'center', marginRight: 10 },
  rankTie: { color: '#747985', fontSize: 10, fontWeight: '600' },
  rankNumber: { color: '#4945ED', fontSize: 25, fontWeight: '800' },
  rankCopy: { flex: 1, paddingLeft: 12 },
  rankName: { color: '#202124', fontSize: 15, lineHeight: 21, fontWeight: '800' },
  rankCount: { color: '#4945ED', fontSize: 12, fontWeight: '700', marginTop: 8 },
  rankingFootnote: { color: '#747985', fontSize: 11, lineHeight: 16, marginTop: 2 },
  categoryList: { gap: 8, paddingVertical: 20 },
  chip: { minHeight: 44, justifyContent: 'center', backgroundColor: '#ECEEF3', borderRadius: 30, paddingHorizontal: 17, paddingVertical: 10 },
  chipActive: { backgroundColor: '#4945ED' },
  chipText: { color: '#5F6470', fontSize: 13, fontWeight: '700' },
  chipTextActive: { color: '#FFFFFF' },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 13 },
  itemSectionHeader: { marginTop: 30 },
  sectionTitle: { color: '#202124', fontSize: 18, fontWeight: '800' },
  sectionDescription: { color: '#747985', fontSize: 12, lineHeight: 17, marginTop: 4 },
  pickCard: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: '#E3E5EA', backgroundColor: '#FFFFFF', borderRadius: 20, padding: 12, marginBottom: 11 },
  pickIcon: { width: 70, height: 70, borderRadius: 15, backgroundColor: '#F8F9FB', alignItems: 'center', justifyContent: 'center' },
  pickEmoji: { fontSize: 33 },
  pickCopy: { flex: 1, paddingLeft: 13 },
  pickMeta: { color: '#747985', fontSize: 12, fontWeight: '600' },
  pickName: { color: '#202124', fontSize: 15, fontWeight: '800', marginTop: 5 },
  pickReview: { color: '#747985', fontSize: 14, lineHeight: 22, marginTop: 7 },
  arrow: { color: '#A6ADBB', fontSize: 25, marginLeft: 5 },
  itemList: { gap: 11, paddingRight: 10 },
  itemCard: { width: 158, borderWidth: 1, borderColor: '#E3E5EA', backgroundColor: '#FFFFFF', borderRadius: 19, padding: 12 },
  itemThumb: { width: '100%', height: 112, borderRadius: 15, backgroundColor: '#F8F9FB', alignItems: 'center', justifyContent: 'center' },
  itemEmoji: { fontSize: 44 },
  itemCategory: { color: '#4945ED', fontSize: 12, fontWeight: '800', letterSpacing: 1, marginTop: 11 },
  itemName: { color: '#202124', fontSize: 14, lineHeight: 19, fontWeight: '800', marginTop: 5 },
  itemAction: { color: '#747985', fontSize: 12, marginTop: 9 },
  stateCard: { alignItems: 'center', borderWidth: 1, borderColor: '#E3E5EA', backgroundColor: '#FFFFFF', borderRadius: 20, padding: 28, marginTop: 28 },
  stateTitle: { color: '#202124', fontSize: 16, fontWeight: '800' },
  stateText: { color: '#747985', fontSize: 12, lineHeight: 18, textAlign: 'center', marginTop: 9 },
  retryButton: { backgroundColor: '#202124', borderRadius: 14, paddingHorizontal: 16, paddingVertical: 11, marginTop: 16 },
  retryButtonText: { color: '#FFFFFF', fontSize: 12, fontWeight: '800' },
  refreshRow: { alignItems: 'flex-end', marginTop: 8, marginBottom: 12 },
  refreshButton: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 8 },
  refreshText: { color: '#4945ED', fontSize: 14, fontWeight: '600' },
  refreshError: { alignSelf: 'stretch', color: '#A9482D', fontSize: 13, lineHeight: 20 },
  loadMoreButton: { minHeight: 46, borderRadius: 14, backgroundColor: '#202124', alignItems: 'center', justifyContent: 'center', marginTop: 6, marginBottom: 6 },
  loadMoreText: { color: '#FFFFFF', fontSize: 12, fontWeight: '800' },
  emptyCard: { alignItems: 'center', borderWidth: 1, borderColor: '#E3E5EA', backgroundColor: '#FFFFFF', borderRadius: 20, padding: 26 },
  emptyTitle: { color: '#202124', fontSize: 15, fontWeight: '800' },
  emptyText: { color: '#747985', fontSize: 12, lineHeight: 18, textAlign: 'center', marginTop: 7 },
  disabled: { opacity: 0.5 },
  pressed: { opacity: 0.7 },
});
