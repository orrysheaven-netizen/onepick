import { useRouter } from 'expo-router';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { OnePickBrand } from '@/components/onepick-brand';
import { ItemPickCount } from '@/components/item-pick-count';
import { PickPhoto } from '@/components/pick-photo';
import { OnePick } from '@/constants/onepick';
import { useAuthSession } from '@/hooks/useAuthSession';
import { useHomeData } from '@/hooks/useHomeData';

type HomeData = NonNullable<ReturnType<typeof useHomeData>['data']>;
type PickItem = HomeData['currentPicks'][number];

function CollectionCard({ item, mine, onOpen, onItem }: { item: PickItem; mine?: boolean; onOpen: () => void; onItem?: () => void }) {
  const name = item.item?.name ?? '제품 정보를 확인할 수 없어요';
  return (
    <View style={styles.card}>
      <Pressable accessibilityRole="button" accessibilityLabel={name + ' 원픽 상세 보기'} onPress={onOpen} style={({ pressed }) => pressed && styles.pressed}>
        <View style={styles.cardTop}>
          <Text style={styles.cardCategory}>{item.category?.name ?? '카테고리'}</Text>
          {mine ? <View style={styles.badge}><Text style={styles.badgeText}>♥ MY PICK</Text></View> : null}
        </View>
        <View style={styles.cardBody}>
          <PickPhoto uri={item.item?.thumbnailUrl ?? item.item?.imageUrl} label={name} />
          <View style={styles.cardCopy}>
            {!mine ? <Text style={styles.byline}>{item.profile ? '@' + item.profile.username : 'OnePick 사용자'}</Text> : null}
            <Text style={styles.itemName}>{name}</Text>
            {item.item ? <ItemPickCount itemId={item.item.id} /> : null}
            <Text numberOfLines={3} style={styles.review}>“{item.pick.oneLineReview}”</Text>
            {item.pick.status === 'needs_review' ? <Text style={styles.reviewNotice}>확인이 필요한 원픽이에요.</Text> : null}
          </View>
        </View>
      </Pressable>
      {onItem && item.item ? (
        <Pressable accessibilityRole="button" accessibilityLabel={name + ' 제품 상세 보기'} onPress={onItem} style={styles.cardFooter}>
          <Text style={styles.actionText}>제품 상세 보기</Text><Text style={styles.arrow}>↗</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function AddCard({ first, onPress }: { first?: boolean; onPress: () => void }) {
  return <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [styles.addCard, pressed && styles.pressed]}>
    <View style={styles.addCircle}><Text style={styles.plus}>＋</Text></View>
    <Text style={styles.addTitle}>{first ? '첫 원픽을 골라볼까요?' : '다음 원픽은 무엇인가요?'}</Text>
    <Text style={styles.addDescription}>지금 가장 좋아하는 하나를 남겨보세요.</Text>
    <Text style={styles.addAction}>원픽 등록하기</Text>
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
  const cellStyle = { width: '100%' as const };
  const { user, isLoading: isSessionLoading, error: sessionError, retry: retrySession } = useAuthSession();
  const homeQuery = useHomeData(user?.id, !isSessionLoading && !sessionError);
  const isLoading = isSessionLoading || (!sessionError && homeQuery.isPending);
  const data = homeQuery.data;
  const openPick = (pickId: string) => router.push({ pathname: '/pick/[pickId]', params: { pickId } });
  const openItem = (itemId: string) => router.push({ pathname: '/item/[itemId]', params: { itemId } });
  const openRegistration = (categoryId?: string) => router.push({ pathname: '/pick/find', params: categoryId ? { categoryId } : {} });
  const categories = user ? data?.categoriesToPick.map(({ category }) => category) ?? [] : data?.openCategories ?? [];
  const ready = !isLoading && !sessionError && Boolean(data);
  const refresh = () => {
    if (!isSessionLoading && !sessionError && !homeQuery.isFetching) {
      void homeQuery.refetch({ cancelRefetch: false });
    }
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={!isSessionLoading && !sessionError ? (
          <RefreshControl refreshing={homeQuery.isRefetching} onRefresh={refresh} tintColor={OnePick.accent} />
        ) : undefined}>
        <View style={styles.nativeHeader}>
          <OnePickBrand />
          <Pressable accessibilityRole="button" accessibilityLabel="내 프로필" onPress={() => router.push('/profile')} style={styles.avatar}><Text style={styles.avatarText}>나</Text></Pressable>
        </View>

        <View style={styles.intro}>
          <View style={styles.introCopy}>
            <Text style={styles.eyebrow}>하나씩 모으는 나의 취향</Text>
            <Text style={styles.headline}>마음에 드는 <Text style={styles.accent}>하나.</Text></Text>
            <Text style={styles.introDescription}>카테고리마다 가장 좋아하는 하나를 골라보세요.</Text>
          </View>
        </View>

        <View style={styles.sectionHeader}>
          <SectionTitle title="나의 원픽" count={user && ready && data ? data.currentPicks.length : undefined} description="내 취향을 담은 작은 컬렉션" />
          <Pressable accessibilityRole="button" onPress={() => openRegistration()} style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed]}>
            <Text style={styles.primaryText}>＋ 원픽 등록</Text>
          </Pressable>
        </View>

        {isLoading ? <View style={styles.stateCard}><ActivityIndicator color={OnePick.accent} /><Text style={styles.stateTitle}>원픽을 불러오고 있어요</Text></View> : null}
        {sessionError || (!isSessionLoading && homeQuery.isError && !data) ? <View style={styles.stateCard}>
          <Text style={styles.stateTitle}>{sessionError ? '로그인 상태를 확인하지 못했어요' : '원픽을 불러오지 못했어요'}</Text>
          <Text style={styles.stateText}>연결 상태를 확인한 뒤 다시 시도해주세요.</Text>
          <Pressable accessibilityRole="button" disabled={!sessionError && homeQuery.isFetching} onPress={sessionError ? retrySession : refresh} style={styles.retryButton}><Text style={styles.actionText}>다시 불러오기</Text></Pressable>
        </View> : null}

        {ready && data ? <>
          <View style={styles.refreshRow}>
            {homeQuery.isError ? <Text accessibilityRole="alert" style={styles.refreshError}>최신 원픽을 확인하지 못했어요. 마지막으로 불러온 내용을 표시하고 있어요.</Text> : null}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="홈 원픽 새로고침"
              disabled={homeQuery.isFetching}
              onPress={refresh}
              style={({ pressed }) => [styles.refreshButton, (pressed || homeQuery.isFetching) && styles.pressed]}>
              <Text style={styles.actionText}>{homeQuery.isFetching ? '새로고침 중…' : homeQuery.isError ? '다시 불러오기' : '새로고침'}</Text>
            </Pressable>
          </View>
          <View style={styles.grid}>
            {user ? data.currentPicks.map((item) => <View key={item.pick.id} style={cellStyle}>
              <CollectionCard item={item} mine onOpen={() => openPick(item.pick.id)} onItem={() => openItem(item.pick.itemId)} />
            </View>) : null}
            <View style={cellStyle}><AddCard first={!user || data.currentPicks.length === 0} onPress={() => openRegistration()} /></View>
            {!user ? <View style={[styles.welcomeCard, cellStyle]}>
              <Text style={styles.welcomeTitle}>취향은, 하나씩 쌓여요.</Text>
              <Text style={styles.welcomeText}>좋아하는 것을 고르고{ '\n' }나만의 이유를 남겨보세요.</Text>
              <Pressable accessibilityRole="button" onPress={() => router.push({ pathname: '/auth/login', params: { action: 'home' } })} style={styles.loginButton}>
                <Text style={styles.actionText}>로그인하고 내 원픽 모으기</Text><Text style={styles.arrow}>↗</Text>
              </Pressable>
            </View> : null}
          </View>

          <View style={styles.nextSection}><SectionTitle title={user ? '아직 선택하지 않은 카테고리' : '어떤 취향부터 골라볼까요?'} count={categories.length} /></View>
          {categories.length ? <View style={styles.categoryGrid}>
            {categories.map((category) => <Pressable key={category.id} accessibilityRole="button" accessibilityLabel={category.name + ' 원픽 찾기'}
              onPress={() => openRegistration(category.id)} style={({ pressed }) => [styles.categoryCard, pressed && styles.pressed]}>
              <Text style={styles.categoryName}>{category.name}</Text><Text style={styles.categoryAction}>원픽 고르기  ↗</Text>
            </Pressable>)}
          </View> : <Text style={styles.emptyText}>{user ? '지금 추가로 고를 수 있는 카테고리가 없어요.' : '새로운 카테고리를 준비하고 있어요.'}</Text>}

          {!user && data.mode === 'single_category' && data.singleCategoryItems.length ? <>
            <View style={styles.nextSection}><SectionTitle title="원픽 제품 둘러보기" count={data.singleCategoryItems.length} /></View>
            <View style={styles.grid}>{data.singleCategoryItems.map((item) => <View key={item.id} style={cellStyle}>
              <Pressable accessibilityRole="button" accessibilityLabel={item.name + ' 제품 상세 보기'} onPress={() => openItem(item.id)} style={styles.card}>
                <PickPhoto uri={item.imageUrl ?? item.thumbnailUrl} label={item.name} large /><Text style={styles.itemName}>{item.name}</Text><ItemPickCount itemId={item.id} /><Text style={styles.addAction}>제품 상세 보기 ↗</Text>
              </Pressable>
            </View>)}</View>
          </> : null}

          {user ? <>
            <View style={styles.nextSection}><SectionTitle title="최근 사람들의 원픽" description="다른 사람은 어떤 하나를 골랐을까요?" /></View>
            {data.feed.length ? <View style={styles.grid}>{data.feed.map((item) => <View key={item.pick.id} style={cellStyle}>
              <CollectionCard item={item} onOpen={() => openPick(item.pick.id)} />
            </View>)}</View> : <Text style={styles.emptyText}>새로운 선택이 올라오면 이곳에서 만날 수 있어요.</Text>}
          </> : null}

          <View style={styles.footer}><Text style={styles.footerMark}>1</Text><Text style={styles.footerText}>원픽을 바꿔도, 지난 취향은 기록으로 남아요.</Text></View>
        </> : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: OnePick.background },
  content: { width: '100%', maxWidth: OnePick.maxWidth, alignSelf: 'center', paddingHorizontal: 20, paddingBottom: 28 },
  nativeHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 72 },
  avatar: { width: 42, height: 42, borderRadius: 21, backgroundColor: '#EAECF1', alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: 14, color: OnePick.text, fontWeight: '600' },
  intro: { paddingTop: 18, paddingBottom: 28 },
  introCopy: { flex: 1 },
  eyebrow: { color: OnePick.muted, fontSize: 12, fontWeight: '600' },
  headline: { color: OnePick.text, fontSize: 30, lineHeight: 40, letterSpacing: -1.2, fontWeight: '800', marginTop: 8 },
  accent: { color: OnePick.accent },
  introDescription: { color: OnePick.muted, fontSize: 13, lineHeight: 20, marginTop: 8 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 8 },
  sectionCopy: { flexShrink: 1 },
  sectionTitle: { color: OnePick.text, fontSize: 19, fontWeight: '800', letterSpacing: -0.7 },
  count: { color: OnePick.accent },
  sectionDescription: { color: OnePick.muted, fontSize: 12, lineHeight: 18, marginTop: 5 },
  primaryButton: { minHeight: 44, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 14, borderRadius: 13, backgroundColor: OnePick.accent },
  primaryText: { color: OnePick.surface, fontSize: 14, fontWeight: '700' },
  grid: { gap: 12 },
  card: { flex: 1, padding: 16, backgroundColor: OnePick.surface, borderWidth: 1, borderColor: OnePick.border, borderRadius: 20 },
  cardTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, minHeight: 24, marginBottom: 12 },
  cardBody: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  cardCopy: { flex: 1, minWidth: 0 },
  cardCategory: { flex: 1, color: OnePick.text, fontSize: 14, fontWeight: '700' },
  badge: { paddingHorizontal: 9, paddingVertical: 6, borderRadius: 6, backgroundColor: OnePick.accentSoft },
  badgeText: { color: OnePick.accent, fontSize: 12, fontWeight: '700' },
  itemName: { color: OnePick.text, fontSize: 18, lineHeight: 25, fontWeight: '700', letterSpacing: -0.5 },
  byline: { fontSize: 12, color: OnePick.muted, marginBottom: 5 },
  review: { color: OnePick.muted, fontSize: 13, lineHeight: 20, marginTop: 6 },
  reviewNotice: { color: '#9A5D13', fontSize: 13, marginTop: 8 },
  cardFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 10, marginTop: 12, borderTopWidth: 1, borderTopColor: OnePick.border, minHeight: 44 },
  actionText: { color: OnePick.accent, fontSize: 14, fontWeight: '600' },
  arrow: { color: OnePick.accent, fontSize: 20 },
  addCard: { flex: 1, minHeight: 200, padding: 22, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderStyle: 'dashed', borderColor: '#CCD0DA', borderRadius: 20 },
  addCircle: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: OnePick.accentSoft, marginBottom: 12 },
  plus: { fontSize: 30, color: OnePick.accent, fontWeight: '300' },
  addTitle: { fontSize: 17, lineHeight: 24, fontWeight: '600', color: OnePick.text, textAlign: 'center' },
  addDescription: { fontSize: 13, lineHeight: 21, color: OnePick.muted, textAlign: 'center', marginTop: 8 },
  addAction: { color: OnePick.accent, fontSize: 14, fontWeight: '600', marginTop: 22 },
  welcomeCard: { padding: 32, justifyContent: 'center', minHeight: 260 },
  welcomeTitle: { color: OnePick.text, fontSize: 24, lineHeight: 34, fontWeight: '700', letterSpacing: -0.8 },
  welcomeText: { color: OnePick.muted, fontSize: 16, lineHeight: 27, marginTop: 14 },
  loginButton: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 18, minHeight: 44, marginTop: 24 },
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
