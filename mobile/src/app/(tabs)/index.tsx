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
      <View style={styles.cardTop}>
        <Text style={styles.cardCategory}>{item.categoryName}</Text>
        {mine ? <View style={styles.badge}><Text style={styles.badgeText}>♥ MY PICK</Text></View> : null}
      </View>
      <View style={styles.cardBody}>
        <PickPhoto uri={item.thumbnailUrl} label={item.name} itemId={item.itemId} />
        <View style={styles.cardCopy}>
          <Text style={styles.itemName}>{item.name}</Text>
          <Text style={styles.pickCount}>현재 {item.pickCount.toLocaleString()}명이 이 원픽을 추천</Text>
        </View>
      </View>
    </Pressable>
    {item.latestPickerUsername ? <Pressable accessibilityRole="button"
      accessibilityLabel={`@${item.latestPickerUsername} 프로필 보기`} onPress={onProfile}
      style={({ pressed }) => [styles.pickerRow, pressed && styles.pressed]}>
      <View style={styles.pickerAvatar}><Text style={styles.pickerInitial}>{item.latestPickerUsername.slice(0, 1).toUpperCase()}</Text></View>
      <View style={styles.pickerCopy}>
        <View style={styles.pickerNameRow}>
          <Text style={styles.pickerName}>@{item.latestPickerUsername}</Text>
          {isDemoUsername(item.latestPickerUsername) ? <Text style={styles.demoBadge}>DEMO</Text> : null}
        </View>
        {item.latestPickReview ? <><Text style={styles.reasonLabel}>추천 이유</Text><Text numberOfLines={2} style={styles.pickerReview}>“{item.latestPickReview}”</Text></> : null}
      </View>
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
  const categories = user ? data?.categoriesToPick.map(({ category }) => category) ?? [] : data?.openCategories ?? [];
  const searchCategories = data?.openCategories ?? [];
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
          onSearchMovie={movieCategory ? (query) => router.push({ pathname: '/pick/find', params: { categoryId: movieCategory.id, query } }) : undefined}
          onSearchDrama={dramaCategory ? (query) => router.push({ pathname: '/pick/find', params: { categoryId: dramaCategory.id, query } }) : undefined}
          onSearchMusic={musicCategory ? (query) => router.push({ pathname: '/pick/music', params: { categoryId: musicCategory.id, title: query } }) : undefined}
          onSearchGame={gameCategory ? (query) => router.push({ pathname: '/pick/game', params: { categoryId: gameCategory.id, query } }) : undefined}
          onSearchBook={bookCategory ? (query) => router.push({ pathname: '/pick/book', params: { categoryId: bookCategory.id, query } }) : undefined}
          onSearchYouTube={youtubeCategory ? (query) => router.push({ pathname: '/pick/youtube', params: { categoryId: youtubeCategory.id, query } }) : undefined}
          onSearchPokemon={pokemonCategory ? (query) => router.push({ pathname: '/pick/pokemon', params: { categoryId: pokemonCategory.id, query } }) : undefined}
          onSelect={openItem} />

        <View style={styles.intro}>
          <View style={styles.introCopy}>
            <Text style={styles.eyebrow}>카테고리마다 단 하나</Text>
            <Text style={styles.headline}>내가 추천하는 <Text style={styles.accent}>원픽.</Text></Text>
            <Text style={styles.introDescription}>수많은 선택지 중 하나만 고르고, 왜 추천하는지 남겨보세요.</Text>
          </View>
        </View>

        {ready && data?.editorialItems.length ? <View style={styles.editorialSection}>
          <SectionTitle title="먼저 소개하는 원픽" description="초기 추천 큐레이션 · 인기 순위와는 별도로 운영해요." />
          <View style={styles.editorialList}>
            {data.editorialItems.map((item) => <EditorialCard key={item.itemId} item={item} onOpen={() => openItem(item.itemId)} />)}
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
          </Pressable> : <View style={styles.welcomeCard}>
              <Text style={styles.welcomeTitle}>하나만 추천한다면 무엇인가요?</Text>
              <Text style={styles.welcomeText}>카테고리마다 하나를 고르고{ '\n' }내가 추천하는 이유를 남겨보세요.</Text>
              <Pressable accessibilityRole="button" onPress={() => router.push({ pathname: '/auth/login', params: { action: 'home' } })} style={styles.loginButton}>
                <Text style={styles.actionText}>로그인하고 내 추천 원픽 만들기</Text><Text style={styles.arrow}>↗</Text>
              </Pressable>
          </View>}

          <View style={styles.nextSection}><SectionTitle title={user ? '아직 선택하지 않은 카테고리' : '어떤 취향부터 골라볼까요?'} count={categories.length} /></View>
          {categories.length ? <View style={styles.categoryGrid}>
            {categories.map((category) => <Pressable key={category.id} accessibilityRole="button" accessibilityLabel={category.name + ' 원픽 찾기'}
              onPress={() => openRegistration(category)} style={({ pressed }) => [styles.categoryCard, pressed && styles.pressed]}>
              <Text style={styles.categoryName}>{category.name}</Text><Text style={styles.categoryAction}>추천 원픽 고르기  ↗</Text>
            </Pressable>)}
          </View> : <Text style={styles.emptyText}>{user ? '지금 추가로 고를 수 있는 카테고리가 없어요.' : '새로운 카테고리를 준비하고 있어요.'}</Text>}

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
  intro: { paddingTop: 8, paddingBottom: 24 },
  introCopy: { flex: 1 },
  eyebrow: { color: OnePick.muted, fontSize: 12, fontWeight: '600' },
  headline: { color: OnePick.text, fontSize: 30, lineHeight: 40, letterSpacing: -1.2, fontWeight: '800', marginTop: 8 },
  accent: { color: OnePick.accent },
  introDescription: { color: OnePick.muted, fontSize: 13, lineHeight: 20, marginTop: 8 },
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
  cardTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, minHeight: 24, marginBottom: 12 },
  cardBody: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  cardCopy: { flex: 1, minWidth: 0 },
  cardCategory: { flex: 1, color: OnePick.text, fontSize: 14, fontWeight: '700' },
  badge: { paddingHorizontal: 9, paddingVertical: 6, borderRadius: 6, backgroundColor: OnePick.accentSoft },
  badgeText: { color: OnePick.accent, fontSize: 12, fontWeight: '700' },
  itemName: { color: OnePick.text, fontSize: 18, lineHeight: 25, fontWeight: '700', letterSpacing: -0.5 },
  pickCount: { color: OnePick.accent, fontSize: 13, lineHeight: 20, fontWeight: '600', marginTop: 8 },
  pickerRow: { minHeight: 68, flexDirection: 'row', alignItems: 'center', gap: 11, paddingHorizontal: 16, paddingVertical: 12, borderTopWidth: 1, borderTopColor: OnePick.border },
  pickerAvatar: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', backgroundColor: OnePick.accentSoft },
  pickerInitial: { color: OnePick.accent, fontSize: 13, fontWeight: '800' },
  pickerCopy: { flex: 1, minWidth: 0 },
  pickerNameRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  pickerName: { color: OnePick.text, fontSize: 12, lineHeight: 18, fontWeight: '700' },
  demoBadge: { color: '#8A5A00', backgroundColor: '#FFF3CD', borderRadius: 999, paddingHorizontal: 6, paddingVertical: 2, fontSize: 9, lineHeight: 12, fontWeight: '900' },
  reasonLabel: { color: OnePick.accent, fontSize: 10, fontWeight: '700', marginTop: 3 },
  pickerReview: { color: OnePick.muted, fontSize: 12, lineHeight: 18, marginTop: 2 },
  profileArrow: { color: OnePick.muted, fontSize: 22 },
  actionText: { color: OnePick.accent, fontSize: 14, fontWeight: '600' },
  arrow: { color: OnePick.accent, fontSize: 20 },
  welcomeCard: { padding: 20, marginTop: 20, borderRadius: 20, backgroundColor: OnePick.accentSoft },
  welcomeTitle: { color: OnePick.text, fontSize: 20, lineHeight: 28, fontWeight: '700', letterSpacing: -0.8 },
  welcomeText: { color: OnePick.muted, fontSize: 14, lineHeight: 23, marginTop: 8 },
  loginButton: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 18, minHeight: 44, marginTop: 12 },
  nextSection: { marginTop: 30, marginBottom: 16 },
  categoryGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  categoryCard: { width: '46%', flexGrow: 1, padding: 16, borderWidth: 1, borderColor: OnePick.border, borderRadius: 18, backgroundColor: OnePick.surface },
  categoryName: { color: OnePick.text, fontSize: 17, fontWeight: '700' },
  categoryAction: { color: OnePick.muted, fontSize: 13, marginTop: 14 },
  emptyText: { color: OnePick.muted, fontSize: 14, lineHeight: 23, paddingVertical: 16 },
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
