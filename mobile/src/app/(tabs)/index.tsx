import { useRouter } from 'expo-router';
import { ActivityIndicator, Platform, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { OnePickBrand } from '@/components/onepick-brand';
import { PickPhoto } from '@/components/pick-photo';
import { OnePick } from '@/constants/onepick';
import { useAuthSession } from '@/hooks/useAuthSession';
import { useHomeData } from '@/hooks/useHomeData';

type HomeData = NonNullable<ReturnType<typeof useHomeData>['data']>;
type PickItem = HomeData['currentPicks'][number];

function CollectionCard({ item, mine, onOpen, onProduct }: { item: PickItem; mine?: boolean; onOpen: () => void; onProduct?: () => void }) {
  const name = item.product?.name ?? '제품 정보를 확인할 수 없어요';
  return (
    <View style={styles.card}>
      <Pressable accessibilityRole="button" accessibilityLabel={name + ' 원픽 상세 보기'} onPress={onOpen} style={({ pressed }) => pressed && styles.pressed}>
        <View style={styles.cardTop}>
          <Text style={styles.cardCategory}>{item.category?.name ?? '카테고리'}</Text>
          {mine ? <View style={styles.badge}><Text style={styles.badgeText}>♥ MY PICK</Text></View> : null}
        </View>
        <PickPhoto uri={item.product?.imageUrl ?? item.product?.thumbnailUrl} label={name} large />
        {!mine ? <Text style={styles.byline}>{item.profile ? '@' + item.profile.username : 'OnePick 사용자'}</Text> : null}
        <Text style={styles.productName}>{name}</Text>
        <Text numberOfLines={3} style={styles.review}>“{item.pick.oneLineReview}”</Text>
        {item.pick.status === 'needs_review' ? <Text style={styles.reviewNotice}>확인이 필요한 원픽이에요.</Text> : null}
      </Pressable>
      {onProduct && item.product ? (
        <Pressable accessibilityRole="button" accessibilityLabel={name + ' 제품 상세 보기'} onPress={onProduct} style={styles.cardFooter}>
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
  const { width } = useWindowDimensions();
  const compact = width < 650;
  const columns = width >= 1000 ? 3 : compact ? 1 : 2;
  const cellStyle = { width: columns === 3 ? '31.8%' as const : columns === 2 ? '48.8%' as const : '100%' as const };
  const { user, isLoading: isSessionLoading, error: sessionError, retry: retrySession } = useAuthSession();
  const homeQuery = useHomeData(user?.id, !isSessionLoading && !sessionError);
  const isLoading = isSessionLoading || (!sessionError && homeQuery.isPending);
  const data = homeQuery.data;
  const openPick = (pickId: string) => router.push({ pathname: '/pick/[pickId]', params: { pickId } });
  const openProduct = (productId: string) => router.push({ pathname: '/product/[productId]', params: { productId } });
  const openRegistration = (categoryId?: string) => router.push({ pathname: '/pick/find', params: categoryId ? { categoryId } : {} });
  const categories = user ? data?.categoriesToPick.map(({ category }) => category) ?? [] : data?.openCategories ?? [];
  const ready = !isLoading && !sessionError && !homeQuery.isError;

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <ScrollView contentContainerStyle={[styles.content, compact && styles.contentCompact]} showsVerticalScrollIndicator={false}>
        {Platform.OS !== 'web' ? <View style={styles.nativeHeader}>
          <OnePickBrand />
          <Pressable accessibilityRole="button" accessibilityLabel="내 프로필" onPress={() => router.push('/profile')} style={styles.avatar}><Text style={styles.avatarText}>나</Text></Pressable>
        </View> : null}

        <View style={[styles.intro, compact && styles.introCompact]}>
          <View style={styles.introCopy}>
            <Text style={styles.eyebrow}>MY PERSONAL FAVORITES</Text>
            <Text style={[styles.headline, compact && styles.headlineCompact]}>많은 것보다,{ '\n' }마음에 드는 <Text style={styles.accent}>하나.</Text></Text>
            <Text style={styles.introDescription}>카테고리마다 가장 좋아하는 하나를 골라보세요.</Text>
          </View>
          {!compact ? <View style={styles.rule}>
            <Text style={styles.ruleLine}><Text style={styles.ruleNumber}>1</Text><Text style={styles.ruleUnit}> / category</Text></Text>
            <Text style={styles.ruleDescription}>하나의 카테고리, 하나의 원픽.</Text>
          </View> : null}
        </View>

        <View style={[styles.sectionHeader, compact && styles.sectionHeaderCompact]}>
          <SectionTitle title="나의 원픽" count={user && ready && data ? data.currentPicks.length : undefined} description="내 취향을 담은 작은 컬렉션" />
          <Pressable accessibilityRole="button" onPress={() => openRegistration()} style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed]}>
            <Text style={styles.primaryText}>＋ 원픽 등록</Text>
          </Pressable>
        </View>

        {isLoading ? <View style={styles.stateCard}><ActivityIndicator color={OnePick.accent} /><Text style={styles.stateTitle}>원픽을 불러오고 있어요</Text></View> : null}
        {sessionError || (!isSessionLoading && homeQuery.isError) ? <View style={styles.stateCard}>
          <Text style={styles.stateTitle}>{sessionError ? '로그인 상태를 확인하지 못했어요' : '원픽을 불러오지 못했어요'}</Text>
          <Text style={styles.stateText}>연결 상태를 확인한 뒤 다시 시도해주세요.</Text>
          <Pressable accessibilityRole="button" onPress={sessionError ? retrySession : () => void homeQuery.refetch()} style={styles.retryButton}><Text style={styles.actionText}>다시 불러오기</Text></Pressable>
        </View> : null}

        {ready && data ? <>
          <View style={styles.grid}>
            {user ? data.currentPicks.map((item) => <View key={item.pick.id} style={cellStyle}>
              <CollectionCard item={item} mine onOpen={() => openPick(item.pick.id)} onProduct={() => openProduct(item.pick.productId)} />
            </View>) : null}
            <View style={cellStyle}><AddCard first={!user || data.currentPicks.length === 0} onPress={() => openRegistration()} /></View>
            {!user ? <View style={[styles.welcomeCard, columns === 1 ? cellStyle : { flex: 1 }]}>
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
              onPress={() => openRegistration(category.id)} style={({ pressed }) => [styles.categoryCard, compact && styles.categoryCardCompact, pressed && styles.pressed]}>
              <Text style={styles.categoryName}>{category.name}</Text><Text style={styles.categoryAction}>원픽 고르기  ↗</Text>
            </Pressable>)}
          </View> : <Text style={styles.emptyText}>{user ? '지금 추가로 고를 수 있는 카테고리가 없어요.' : '새로운 카테고리를 준비하고 있어요.'}</Text>}

          {!user && data.mode === 'single_category' && data.singleCategoryProducts.length ? <>
            <View style={styles.nextSection}><SectionTitle title="원픽 제품 둘러보기" count={data.singleCategoryProducts.length} /></View>
            <View style={styles.grid}>{data.singleCategoryProducts.map((product) => <View key={product.id} style={cellStyle}>
              <Pressable accessibilityRole="button" accessibilityLabel={product.name + ' 제품 상세 보기'} onPress={() => openProduct(product.id)} style={styles.card}>
                <PickPhoto uri={product.imageUrl ?? product.thumbnailUrl} label={product.name} large /><Text style={styles.productName}>{product.name}</Text><Text style={styles.addAction}>제품 상세 보기 ↗</Text>
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
  content: { width: '100%', maxWidth: OnePick.maxWidth, alignSelf: 'center', paddingHorizontal: 40, paddingBottom: 72 },
  contentCompact: { paddingHorizontal: 22, paddingBottom: 48 },
  nativeHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 18, borderBottomWidth: 1, borderBottomColor: OnePick.border },
  avatar: { width: 42, height: 42, borderRadius: 21, backgroundColor: '#EAECF1', alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: 14, color: OnePick.text, fontWeight: '600' },
  intro: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 52, paddingBottom: 60, gap: 32 },
  introCompact: { paddingTop: 36, paddingBottom: 38 },
  introCopy: { flex: 1 },
  eyebrow: { color: OnePick.muted, fontSize: 12, fontWeight: '700', letterSpacing: 2.4 },
  headline: { color: OnePick.text, fontSize: 46, lineHeight: 62, letterSpacing: -1.8, fontWeight: '800', marginTop: 21 },
  headlineCompact: { fontSize: 34, lineHeight: 47, letterSpacing: -1.2 },
  accent: { color: OnePick.accent },
  introDescription: { color: OnePick.muted, fontSize: 15, lineHeight: 24, marginTop: 22 },
  rule: { borderLeftWidth: 1, borderLeftColor: OnePick.border, paddingLeft: 46, paddingVertical: 16, minWidth: 230 },
  ruleLine: { color: OnePick.muted },
  ruleNumber: { fontSize: 76, lineHeight: 88, fontWeight: '800', color: OnePick.accent },
  ruleUnit: { fontSize: 15 },
  ruleDescription: { color: OnePick.muted, fontSize: 14, marginTop: 8 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 16, marginBottom: 24 },
  sectionHeaderCompact: { gap: 10 },
  sectionCopy: { flexShrink: 1 },
  sectionTitle: { color: OnePick.text, fontSize: 22, fontWeight: '800', letterSpacing: -0.7 },
  count: { color: OnePick.accent },
  sectionDescription: { color: OnePick.muted, fontSize: 14, lineHeight: 21, marginTop: 8 },
  primaryButton: { minHeight: 48, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 18, borderRadius: 13, backgroundColor: OnePick.accent },
  primaryText: { color: OnePick.surface, fontSize: 14, fontWeight: '700' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 24 },
  card: { flex: 1, padding: 20, backgroundColor: OnePick.surface, borderWidth: 1, borderColor: OnePick.border, borderRadius: 24 },
  cardTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, minHeight: 30, marginBottom: 16 },
  cardCategory: { flex: 1, color: OnePick.text, fontSize: 14, fontWeight: '700' },
  badge: { paddingHorizontal: 9, paddingVertical: 6, borderRadius: 6, backgroundColor: OnePick.accentSoft },
  badgeText: { color: OnePick.accent, fontSize: 12, fontWeight: '700' },
  productName: { color: OnePick.text, fontSize: 20, lineHeight: 28, fontWeight: '700', letterSpacing: -0.5 },
  byline: { fontSize: 12, color: OnePick.muted, marginBottom: 5 },
  review: { color: OnePick.muted, fontSize: 14, lineHeight: 22, marginTop: 8 },
  reviewNotice: { color: '#9A5D13', fontSize: 13, marginTop: 8 },
  cardFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 15, marginTop: 18, borderTopWidth: 1, borderTopColor: OnePick.border, minHeight: 44 },
  actionText: { color: OnePick.accent, fontSize: 14, fontWeight: '600' },
  arrow: { color: OnePick.accent, fontSize: 20 },
  addCard: { flex: 1, minHeight: 310, padding: 24, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderStyle: 'dashed', borderColor: '#CCD0DA', borderRadius: 24 },
  addCircle: { width: 58, height: 58, borderRadius: 29, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: OnePick.border, marginBottom: 22 },
  plus: { fontSize: 30, color: OnePick.accent, fontWeight: '300' },
  addTitle: { fontSize: 17, lineHeight: 24, fontWeight: '600', color: OnePick.text, textAlign: 'center' },
  addDescription: { fontSize: 13, lineHeight: 21, color: OnePick.muted, textAlign: 'center', marginTop: 8 },
  addAction: { color: OnePick.accent, fontSize: 14, fontWeight: '600', marginTop: 22 },
  welcomeCard: { padding: 32, justifyContent: 'center', minHeight: 260 },
  welcomeTitle: { color: OnePick.text, fontSize: 24, lineHeight: 34, fontWeight: '700', letterSpacing: -0.8 },
  welcomeText: { color: OnePick.muted, fontSize: 16, lineHeight: 27, marginTop: 14 },
  loginButton: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 18, minHeight: 44, marginTop: 24 },
  nextSection: { marginTop: 48, marginBottom: 22 },
  categoryGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  categoryCard: { minWidth: 180, flexGrow: 1, padding: 22, borderWidth: 1, borderColor: OnePick.border, borderRadius: 20, backgroundColor: OnePick.surface },
  categoryCardCompact: { minWidth: '44%' },
  categoryName: { color: OnePick.text, fontSize: 17, fontWeight: '700' },
  categoryAction: { color: OnePick.muted, fontSize: 13, marginTop: 14 },
  emptyText: { color: OnePick.muted, fontSize: 14, lineHeight: 23, paddingVertical: 16 },
  stateCard: { backgroundColor: OnePick.surface, borderWidth: 1, borderColor: OnePick.border, borderRadius: 24, padding: 32, alignItems: 'center' },
  stateTitle: { color: OnePick.text, fontSize: 16, fontWeight: '600', marginTop: 10, textAlign: 'center' },
  stateText: { color: OnePick.muted, fontSize: 14, lineHeight: 22, marginTop: 8, textAlign: 'center' },
  retryButton: { minHeight: 44, justifyContent: 'center', marginTop: 12, paddingHorizontal: 14 },
  footer: { flexDirection: 'row', alignItems: 'center', gap: 12, borderTopWidth: 1, borderTopColor: OnePick.border, marginTop: 50, paddingTop: 24 },
  footerMark: { color: OnePick.accent, fontSize: 22, fontWeight: '800' },
  footerText: { color: OnePick.muted, fontSize: 13, lineHeight: 21, flex: 1 },
  pressed: { opacity: 0.65 },
});
