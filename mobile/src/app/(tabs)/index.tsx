import { useRouter } from 'expo-router';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { OnePickBrand } from '@/components/onepick-brand';
import { ItemSearch } from '@/components/item-search';
import { PickPhoto } from '@/components/pick-photo';
import { OnePick } from '@/constants/onepick';
import { useAuthSession } from '@/hooks/useAuthSession';
import { useHomeData } from '@/hooks/useHomeData';
import { isDemoUsername } from '@/lib/demoProfile';

type HomeData = NonNullable<ReturnType<typeof useHomeData>['data']>;
type FeaturedItem = HomeData['featuredItems'][number];
type EditorialItem = HomeData['editorialItems'][number];

function ProductCard({ item, mine, onOpen, onProfile }: {
  item: FeaturedItem;
  mine?: boolean;
  onOpen: () => void;
  onProfile?: () => void;
}) {
  return <View style={styles.card}>
    <Pressable accessibilityRole="button" accessibilityLabel={item.name + ' 제품 상세 보기'} onPress={onOpen}
      style={({ pressed }) => [styles.productAction, pressed && styles.pressed]}>
      <View style={styles.cardBody}>
        <PickPhoto tall uri={item.thumbnailUrl} label={item.name} itemId={item.itemId} />
        <View style={styles.cardCopy}>
          <View style={styles.cardTop}>
            <Text numberOfLines={1} style={styles.cardCategory}>{item.categoryName}</Text>
            {mine ? <View style={styles.badge}><Text style={styles.badgeText}>MY PICK</Text></View> : null}
          </View>
          <Text style={styles.itemName}>{item.name}</Text>
          {item.latestPickReview
            ? <><Text style={styles.reasonLabel}>추천 이유</Text><Text numberOfLines={3} style={styles.review}>{`“${item.latestPickReview}”`}</Text></>
            : <Text style={styles.pickCount}>{item.pickCount.toLocaleString()}명이 추천</Text>}
        </View>
      </View>
    </Pressable>
    {item.latestPickerUsername ? <Pressable accessibilityRole="button"
      accessibilityLabel={`@${item.latestPickerUsername} 프로필 보기`} onPress={onProfile}
      style={({ pressed }) => [styles.pickerRow, pressed && styles.pressed]}>
      <View style={styles.pickerAvatar}><Text style={styles.pickerInitial}>{item.latestPickerUsername.slice(0, 1).toUpperCase()}</Text></View>
      <Text numberOfLines={1} style={styles.pickerMeta}>@{item.latestPickerUsername}{item.pickCount > 1 ? ` 외 ${(item.pickCount - 1).toLocaleString()}명` : ''}이 추천</Text>
      {isDemoUsername(item.latestPickerUsername) ? <Text style={styles.demoBadge}>DEMO</Text> : null}
      <Text style={styles.profileArrow}>›</Text>
    </Pressable> : null}
  </View>;
}

function EditorialCard({ item, onOpen }: { item: EditorialItem; onOpen: () => void }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={item.name + ' 추천 원픽 상세 보기'}
    onPress={onOpen} style={({ pressed }) => [styles.editorialCard, pressed && styles.pressed]}>
    <View style={styles.editorialTop}>
      <Text style={styles.editorialKicker}>ONEPICK 추천</Text>
      <Text numberOfLines={1} style={styles.editorialPath}>{item.categoryPath}</Text>
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

function SectionTitle({ title, count, description }: { title: string; count?: number; description?: string }) {
  return <View style={styles.sectionCopy}>
    <Text style={styles.sectionTitle}>{title}{count !== undefined ? <Text style={styles.count}>  {count}</Text> : null}</Text>
    {description ? <Text style={styles.sectionDescription}>{description}</Text> : null}
  </View>;
}

export default function HomeScreen() {
  const router = useRouter();
  const { user, isLoading: isSessionLoading, error: sessionError, retry: retrySession } = useAuthSession();
  const homeQuery = useHomeData(user?.id, !isSessionLoading && !sessionError);
  const isLoading = isSessionLoading || (!sessionError && homeQuery.isPending);
  const data = homeQuery.data;
  const openItem = (itemId: string) => router.push({ pathname: '/item/[itemId]', params: { itemId } });
  const searchCategories = data?.openCategories ?? [];
  const categories = user ? [] : searchCategories;
  const movieCategory = searchCategories.find((category) => category.slug === 'movie');
  const dramaCategory = searchCategories.find((category) => category.slug === 'drama');
  const musicCategory = searchCategories.find((category) => category.slug === 'music');
  const gameCategory = searchCategories.find((category) => category.slug === 'game');
  const bookCategory = searchCategories.find((category) => category.slug === 'book');
  const youtubeCategory = searchCategories.find((category) => category.slug === 'youtube');
  const pokemonCategory = searchCategories.find((category) => category.slug === 'pokemon');
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
  const refresh = () => {
    if (!isSessionLoading && !sessionError && !homeQuery.isFetching) {
      void homeQuery.refetch({ cancelRefetch: false });
    }
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <FlatList
        data={ready ? data?.featuredItems ?? [] : []}
        keyExtractor={(item) => item.itemId}
        renderItem={({ item }) => <View style={styles.productCell}>
          <ProductCard item={item} mine={Boolean(user && data?.currentPicks.some(({ pick }) => pick.itemId === item.itemId && pick.status === 'active'))}
            onOpen={() => openItem(item.itemId)}
            onProfile={item.latestPickerUsername ? () => router.push({ pathname: '/u/[username]', params: { username: item.latestPickerUsername! } }) : undefined} />
        </View>}
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
        <View style={styles.nativeHeader}>
          <OnePickBrand />
          <Pressable accessibilityRole="button" accessibilityLabel="내 프로필" onPress={() => router.push('/profile')} style={styles.avatar}><Text style={styles.avatarText}>나</Text></Pressable>
        </View>

        <ItemSearch compact
          onSubmitSearch={(query) => router.push({ pathname: '/explore', params: { search: '1', query } })}
          onSearchMovie={movieCategory ? (query) => router.push({ pathname: '/pick/find', params: { categoryId: movieCategory.id, query } }) : undefined}
          onSearchDrama={dramaCategory ? (query) => router.push({ pathname: '/pick/find', params: { categoryId: dramaCategory.id, query } }) : undefined}
          onSearchMusic={musicCategory ? (query) => router.push({ pathname: '/pick/music', params: { categoryId: musicCategory.id, title: query } }) : undefined}
          onSearchGame={gameCategory ? (query) => router.push({ pathname: '/pick/game', params: { categoryId: gameCategory.id, query } }) : undefined}
          onSearchBook={bookCategory ? (query) => router.push({ pathname: '/pick/book', params: { categoryId: bookCategory.id, query } }) : undefined}
          onSearchYouTube={youtubeCategory ? (query) => router.push({ pathname: '/pick/youtube', params: { categoryId: youtubeCategory.id, query } }) : undefined}
          onSearchPokemon={pokemonCategory ? (query) => router.push({ pathname: '/pick/pokemon', params: { categoryId: pokemonCategory.id, query } }) : undefined}
          onSelect={openItem} />

        {user ? null : <View style={styles.signinStrip}>
          <View style={styles.signinMark}><Text style={styles.signinMarkText}>1</Text></View>
          <View style={styles.signinCopy}>
            <Text style={styles.signinTitle}>하나만 추천한다면 무엇인가요?</Text>
            <Text style={styles.signinText}>카테고리마다 하나를 고르고 이유를 남겨보세요</Text>
          </View>
          <Pressable accessibilityRole="button" accessibilityLabel="로그인하고 내 추천 원픽 만들기"
            onPress={() => router.push({ pathname: '/auth/login', params: { action: 'home' } })}
            style={({ pressed }) => [styles.signinButton, pressed && styles.pressed]}>
            <Text style={styles.signinButtonText}>시작하기</Text>
          </Pressable>
        </View>}

        {ready && data?.editorialItems?.length ? <View style={styles.editorialSection}>
          <SectionTitle title="먼저 소개하는 원픽" description="초기 추천 큐레이션 · 인기 순위와는 별도로 운영해요." />
          <View style={styles.editorialList}>
            {data.editorialItems.map((item) => <EditorialCard key={item.itemId} item={item} onOpen={() => openItem(item.itemId)} />)}
          </View>
        </View> : null}

        {ready && data && categories.length ? <View style={styles.categorySection}>
          <View style={styles.nextSection}><SectionTitle title="어떤 취향부터 골라볼까요?" count={categories.length} /></View>
          <View style={styles.categoryGrid}>
            {categories.map((category) => <Pressable key={category.id} accessibilityRole="button" accessibilityLabel={(category.label ?? category.name) + ' 원픽 찾기'}
              onPress={() => openRegistration(category)} style={({ pressed }) => [styles.categoryCard, pressed && styles.pressed]}>
              <Text style={styles.categoryName}>{category.label ?? category.name}</Text><Text style={styles.categoryAction}>추천 원픽 고르기  ↗</Text>
            </Pressable>)}
          </View>
        </View> : null}

        <View style={styles.sectionHeader}>
          <SectionTitle title="사람들이 추천한 원픽" description={data ? `${data.minimumPickCount}명 이상이 추천한 원픽 · 최근 선택순` : undefined} />
        </View>

        {isLoading ? <View style={styles.stateCard}><ActivityIndicator color={OnePick.accent} /><Text style={styles.stateTitle}>원픽을 불러오고 있어요</Text></View> : null}
        {sessionError || (!isSessionLoading && homeQuery.isError && !data) ? <View style={styles.stateCard}>
          <Text style={styles.stateTitle}>{sessionError ? '로그인 상태를 확인하지 못했어요' : '원픽을 불러오지 못했어요'}</Text>
          <Text style={styles.stateText}>연결 상태를 확인한 뒤 다시 시도해주세요.</Text>
          <Pressable accessibilityRole="button" disabled={!sessionError && homeQuery.isFetching} onPress={sessionError ? retrySession : refresh} style={styles.retryButton}><Text style={styles.actionText}>다시 불러오기</Text></Pressable>
        </View> : null}

        {ready && data ? <>
          <View style={styles.refreshRow}>
            {homeQuery.isError && !homeQuery.isFetchNextPageError ? <Text accessibilityRole="alert" style={styles.refreshError}>최신 원픽을 확인하지 못했어요. 마지막으로 불러온 내용을 표시하고 있어요.</Text> : null}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="홈 원픽 새로고침"
              disabled={homeQuery.isFetching}
              onPress={refresh}
              style={({ pressed }) => [styles.refreshButton, (pressed || homeQuery.isFetching) && styles.pressed]}>
              <Text style={styles.actionText}>{homeQuery.isFetching ? '새로고침 중…' : homeQuery.isError ? '다시 불러오기' : '새로고침'}</Text>
            </Pressable>
          </View>
          {!data.featuredItems.length ? <View style={styles.stateCard}>
            <Text style={styles.stateTitle}>사람들의 추천이 모이면 이곳에 소개돼요</Text>
            <Text style={styles.stateText}>현재 이 원픽을 추천한 사람이 {data.minimumPickCount}명 이상인 항목을 보여드려요.</Text>
          </View> : null}
        </> : null}
        </>}
        ListFooterComponent={ready && data ? <>
          {homeQuery.isFetchingNextPage ? <ActivityIndicator style={styles.pageLoading} accessibilityLabel="다음 제품 불러오는 중" color={OnePick.accent} /> : null}
          {homeQuery.isFetchNextPageError ? <View style={styles.stateCard}>
            <Text style={styles.stateText}>다음 제품을 불러오지 못했어요.</Text>
            <Pressable accessibilityRole="button" disabled={homeQuery.isFetching}
              onPress={() => { if (!homeQuery.isFetching) void homeQuery.fetchNextPage({ cancelRefetch: false }); }}
              style={styles.retryButton}><Text style={styles.actionText}>다음 제품 다시 불러오기</Text></Pressable>
          </View> : null}
          {!homeQuery.hasNextPage && data.featuredItems.length > 0 ? <Text style={styles.endText}>지금 볼 수 있는 제품을 모두 확인했어요.</Text> : null}
          <Pressable accessibilityRole="button" accessibilityLabel="원픽 더 둘러보기" onPress={() => router.push('/explore')} style={styles.moreButton}>
            <Text style={styles.actionText}>원픽 더 둘러보기</Text><Text style={styles.arrow}>↗</Text>
          </Pressable>

          {user ? <Pressable accessibilityRole="button" accessibilityLabel={`내 원픽 ${data.currentPicks.length}개 모아보기`} onPress={() => router.push('/profile')} style={styles.profileLink}>
            <Text style={styles.actionText}>내 원픽 {data.currentPicks.length}개 모아보기</Text><Text style={styles.arrow}>↗</Text>
          </Pressable> : null}

          <View style={styles.footer}><Text style={styles.footerMark}>1</Text><Text style={styles.footerText}>원픽을 바꿔도, 지난 취향은 기록으로 남아요.</Text></View>
        </> : null}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: OnePick.background },
  content: { width: '100%', maxWidth: OnePick.maxWidth, alignSelf: 'center', paddingHorizontal: 20, paddingBottom: 28 },
  nativeHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 72 },
  avatar: { width: 42, height: 42, borderRadius: 21, backgroundColor: '#EAECF1', alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: 14, color: OnePick.text, fontWeight: '600' },
  signinStrip: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 13, marginTop: 8, marginBottom: 22, borderWidth: 1, borderColor: OnePick.border, borderRadius: 16, backgroundColor: OnePick.surface },
  signinMark: { width: 34, height: 34, borderRadius: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: OnePick.accentSoft },
  signinMarkText: { color: OnePick.accent, fontSize: 16, fontWeight: '800' },
  signinCopy: { flex: 1, minWidth: 0 },
  signinTitle: { color: OnePick.text, fontSize: 14, lineHeight: 19, fontWeight: '700' },
  signinText: { color: OnePick.muted, fontSize: 12, lineHeight: 17, marginTop: 2 },
  signinButton: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 16, borderRadius: 22, backgroundColor: OnePick.accent },
  signinButtonText: { color: '#FFFFFF', fontSize: 13, fontWeight: '700' },
  categorySection: { marginBottom: 26 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 8 },
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
  sectionCopy: { flexShrink: 1 },
  sectionTitle: { color: OnePick.text, fontSize: 19, fontWeight: '800', letterSpacing: -0.7 },
  count: { color: OnePick.accent },
  sectionDescription: { color: OnePick.muted, fontSize: 12, lineHeight: 18, marginTop: 5 },
  productCell: { marginBottom: 12 },
  pageLoading: { padding: 20 },
  endText: { color: OnePick.muted, textAlign: 'center', paddingVertical: 24, fontSize: 12 },
  moreButton: { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12, paddingVertical: 10 },
  profileLink: { minHeight: 56, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16, marginTop: 20, borderRadius: 16, backgroundColor: OnePick.accentSoft },
  card: { flex: 1, overflow: 'hidden', backgroundColor: OnePick.surface, borderWidth: 1, borderColor: OnePick.border, borderRadius: 20 },
  productAction: { padding: 16 },
  cardTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 5 },
  cardBody: { flexDirection: 'row', alignItems: 'flex-start', gap: 14 },
  cardCopy: { flex: 1, minWidth: 0 },
  cardCategory: { flexShrink: 1, color: OnePick.muted, fontSize: 11, lineHeight: 16, fontWeight: '700' },
  badge: { paddingHorizontal: 9, paddingVertical: 6, borderRadius: 6, backgroundColor: OnePick.accentSoft },
  badgeText: { color: OnePick.accent, fontSize: 12, fontWeight: '700' },
  itemName: { color: OnePick.text, fontSize: 18, lineHeight: 25, fontWeight: '700', letterSpacing: -0.5 },
  review: { color: OnePick.text, fontSize: 14, lineHeight: 21, marginTop: 2 },
  pickCount: { color: OnePick.muted, fontSize: 13, lineHeight: 20, fontWeight: '600', marginTop: 6 },
  pickerRow: { minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: 9, paddingHorizontal: 16, paddingVertical: 10, borderTopWidth: 1, borderTopColor: OnePick.hairline },
  pickerAvatar: { width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: OnePick.accentSoft },
  pickerInitial: { color: OnePick.accent, fontSize: 11, fontWeight: '800' },
  pickerMeta: { flex: 1, minWidth: 0, color: OnePick.muted, fontSize: 12, lineHeight: 18, fontWeight: '600' },
  demoBadge: { color: OnePick.muted, backgroundColor: OnePick.image, borderRadius: 999, paddingHorizontal: 6, paddingVertical: 2, fontSize: 9, lineHeight: 12, fontWeight: '700' },
  reasonLabel: { color: OnePick.accent, fontSize: 11, fontWeight: '700', marginTop: 7 },
  profileArrow: { color: OnePick.muted, fontSize: 22 },
  actionText: { color: OnePick.accent, fontSize: 14, fontWeight: '600' },
  arrow: { color: OnePick.accent, fontSize: 20 },
  nextSection: { marginBottom: 12 },
  categoryGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  categoryCard: { width: '46%', flexGrow: 1, minHeight: 88, justifyContent: 'space-between', padding: 14, borderWidth: 1, borderColor: OnePick.border, borderRadius: 16, backgroundColor: OnePick.surface },
  categoryName: { color: OnePick.text, fontSize: 15, lineHeight: 21, fontWeight: '700' },
  categoryAction: { color: OnePick.muted, fontSize: 12, marginTop: 10 },
  stateCard: { backgroundColor: OnePick.surface, borderWidth: 1, borderColor: OnePick.border, borderRadius: 24, padding: 32, alignItems: 'center' },
  stateTitle: { color: OnePick.text, fontSize: 16, fontWeight: '600', marginTop: 10, textAlign: 'center' },
  stateText: { color: OnePick.muted, fontSize: 14, lineHeight: 22, marginTop: 8, textAlign: 'center' },
  retryButton: { minHeight: 44, justifyContent: 'center', marginTop: 12, paddingHorizontal: 14 },
  refreshRow: { alignItems: 'flex-end', marginBottom: 12 },
  refreshButton: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 8 },
  refreshError: { alignSelf: 'stretch', color: '#A9482D', fontSize: 13, lineHeight: 20 },
  footer: { flexDirection: 'row', alignItems: 'center', gap: 12, borderTopWidth: 1, borderTopColor: OnePick.border, marginTop: 30, paddingTop: 20 },
  footerMark: { color: OnePick.accent, fontSize: 22, fontWeight: '800' },
  footerText: { color: OnePick.muted, fontSize: 13, lineHeight: 21, flex: 1 },
  pressed: { opacity: 0.65 },
});
