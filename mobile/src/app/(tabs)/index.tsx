import { useRouter } from 'expo-router';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAuthSession } from '@/hooks/useAuthSession';
import { useHomeData } from '@/hooks/useHomeData';
import { PickPhoto } from '@/components/pick-photo';
import type { Product } from '@/types/domain/product';

function ProductCard({ product, onPress }: { product: Product; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${product.name} 제품 상세 보기`}
      onPress={onPress}
      style={({ pressed }) => [styles.productCard, pressed && styles.pressed]}>
      <PickPhoto uri={product.thumbnailUrl} label={product.name} />
      <View style={styles.productInfo}>
        <Text style={styles.productBrand}>ONEPICK</Text>
        <Text style={styles.productName}>{product.name}</Text>
        <Text style={styles.productNote}>이 제품에 남긴 사람들의 원픽을 만나보세요.</Text>
      </View>
      <Text style={styles.chevron}>›</Text>
    </Pressable>
  );
}

function HomeLoading() {
  return (
    <View style={styles.stateCard}>
      <ActivityIndicator />
      <Text style={styles.stateTitle}>원픽을 불러오고 있어요</Text>
      <Text style={styles.stateText}>열린 카테고리와 제품을 확인하고 있습니다.</Text>
    </View>
  );
}

function HomeError({ onRetry }: { onRetry: () => void }) {
  return (
    <View style={styles.stateCard}>
      <Text style={styles.stateTitle}>원픽을 불러오지 못했어요</Text>
      <Text style={styles.stateText}>연결 상태를 확인한 뒤 다시 시도해주세요.</Text>
      <Pressable onPress={onRetry} style={({ pressed }) => [styles.retryButton, pressed && styles.pressed]}>
        <Text style={styles.retryButtonText}>다시 불러오기</Text>
      </Pressable>
    </View>
  );
}

export default function HomeScreen() {
  const router = useRouter();
  const { user, isLoading: isSessionLoading, error: sessionError, retry: retrySession } = useAuthSession();
  const homeQuery = useHomeData(user?.id, !isSessionLoading && !sessionError);
  const isLoading = isSessionLoading || (!sessionError && homeQuery.isPending);
  const openPick = (pickId: string) =>
    router.push({ pathname: '/pick/[pickId]', params: { pickId } });
  const openProduct = (productId: string) =>
    router.push({ pathname: '/product/[productId]', params: { productId } });
  const data = homeQuery.data;
  const singleCategory = data?.mode === 'single_category' ? data.openCategories[0] : undefined;
  const products = data?.singleCategoryProducts ?? [];

  const openRegistration = (categoryId?: string) => {
    router.push({
      pathname: '/pick/register',
      params: categoryId ? { categoryId } : {},
    });
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <View>
            <Text style={styles.eyebrow}>ONEPICK</Text>
            <Text style={styles.greeting}>{user ? '나의 선택을\n모아보세요' : <>추천은 많지만,{ '\n' }선택은 하나예요</>}</Text>
          </View>
          <View style={styles.avatar}><Text style={styles.avatarText}>1</Text></View>
        </View>

        <View style={styles.heroCard}>
          <View style={styles.heroCopy}>
            <Text style={styles.heroKicker}>YOUR ONE PICK</Text>
            <Text style={styles.heroTitle}>
              {user ? '오늘의 원픽을 만나보세요' : singleCategory ? `당신의 ${singleCategory.name} 원픽은?` : '당신의 원픽은 무엇인가요?'}
            </Text>
            <Text style={styles.heroSub}>좋아하는 제품의 이름을 적고{ '\n' }나의 선택을 남겨보세요.</Text>
            <Pressable accessibilityRole="button" onPress={() => openRegistration()} style={styles.registerButton}>
              <Text style={styles.retryButtonText}>＋ 원픽 등록</Text>
            </Pressable>
          </View>
          <Text style={styles.heroShape}>1</Text>
        </View>

        {isLoading ? <HomeLoading /> : null}
        {sessionError ? (
          <View style={styles.stateCard}>
            <Text style={styles.stateTitle}>로그인 상태를 확인하지 못했어요</Text>
            <Text style={styles.stateText}>연결 상태를 확인한 뒤 다시 시도해주세요.</Text>
            <Pressable accessibilityRole="button" onPress={retrySession} style={({ pressed }) => [styles.retryButton, pressed && styles.pressed]}>
              <Text style={styles.retryButtonText}>다시 확인하기</Text>
            </Pressable>
          </View>
        ) : null}
        {!isSessionLoading && !sessionError && homeQuery.isError ? <HomeError onRetry={() => void homeQuery.refetch()} /> : null}

        {!isLoading && !sessionError && !homeQuery.isError && data ? (
          <>
            {user ? (
              <>
                <View style={styles.sectionHeader}>
                  <Text style={styles.sectionTitle}>내 현재 원픽</Text>
                  <Text style={styles.countText}>{data.currentPicks.length}개</Text>
                </View>
                {data.currentPicks.length > 0 ? data.currentPicks.map((item) => (
                  <View key={item.pick.id} style={styles.homePickCard}>
                    <Pressable accessibilityRole="button" onPress={() => openPick(item.pick.id)}>
                      <PickPhoto uri={item.product?.thumbnailUrl} label={item.product?.name ?? '제품 대표 이미지'} />
                      <Text style={styles.productBrand}>{item.category?.name ?? '카테고리'}</Text>
                      <Text style={styles.productName}>{item.product?.name ?? '제품 정보를 확인할 수 없어요'}</Text>
                      <Text style={styles.productNote}>“{item.pick.oneLineReview}”</Text>
                      {item.pick.status === 'needs_review' ? <Text style={styles.productNote}>확인이 필요한 원픽이에요.</Text> : null}
                      <Text style={styles.categoryCardSub}>원픽 상세 보기 ›</Text>
                    </Pressable>
                    {item.product ? (
                      <Pressable accessibilityRole="button" onPress={() => openProduct(item.pick.productId)} style={styles.cardAction}>
                        <Text style={styles.categoryCardSub}>제품 상세 보기 ›</Text>
                      </Pressable>
                    ) : null}
                  </View>
                )) : (
                  <View style={styles.stateCard}>
                    <Text style={styles.stateTitle}>아직 고른 원픽이 없어요</Text>
                    <Text style={styles.stateText}>좋아하는 제품의 이름으로 첫 원픽을 등록해보세요.</Text>
                  </View>
                )}

                <View style={[styles.sectionHeader, styles.productsHeader]}>
                  <Text style={styles.sectionTitle}>아직 선택하지 않은 카테고리</Text>
                  <Text style={styles.countText}>{data.categoriesToPick.length}개</Text>
                </View>
                {data.categoriesToPick.length > 0 ? data.categoriesToPick.map(({ category }) => (
                  <View key={category.id} style={styles.homePickCard}>
                    <Pressable
                      accessibilityRole="button"
                      onPress={() => openRegistration(category.id)}>
                      <Text style={styles.categoryCardTitle}>{category.name}</Text>
                      <Text style={styles.categoryCardSub}>제품명으로 원픽 등록 ›</Text>
                    </Pressable>
                  </View>
                )) : (
                  <View style={styles.stateCard}>
                    <Text style={styles.stateTitle}>새로 고를 카테고리가 없어요</Text>
                    <Text style={styles.stateText}>선택 가능한 카테고리를 모두 골랐거나, 새 카테고리를 준비 중이에요.</Text>
                  </View>
                )}

                <View style={[styles.sectionHeader, styles.productsHeader]}>
                  <Text style={styles.sectionTitle}>최근 사람들의 원픽</Text>
                </View>
                {data.feed.length > 0 ? data.feed.map((item) => (
                  <Pressable key={item.pick.id} accessibilityRole="button" onPress={() => openPick(item.pick.id)} style={({ pressed }) => [styles.homePickCard, pressed && styles.pressed]}>
                    <PickPhoto uri={item.product?.thumbnailUrl} label={item.product?.name ?? '제품 대표 이미지'} />
                    <Text style={styles.productBrand}>{item.profile ? `@${item.profile.username}` : '사용자'} · {item.category?.name ?? '카테고리'}</Text>
                    <Text style={styles.productName}>{item.product?.name ?? '제품 정보를 확인할 수 없어요'}</Text>
                    <Text style={styles.productNote}>“{item.pick.oneLineReview}”</Text>
                    <Text style={styles.categoryCardSub}>원픽 상세 보기 ›</Text>
                  </Pressable>
                )) : (
                  <View style={styles.stateCard}>
                    <Text style={styles.stateTitle}>아직 다른 사람의 원픽이 없어요</Text>
                    <Text style={styles.stateText}>새로운 선택이 올라오면 이곳에 표시됩니다.</Text>
                  </View>
                )}
              </>
            ) : singleCategory ? (
              <>
                <View style={styles.sectionHeader}>
                  <Text style={styles.sectionTitle}>{singleCategory.name}</Text>
                  <Text style={styles.sectionHint}>현재 열린 카테고리</Text>
                </View>

                <View style={styles.categoryChipActive}>
                  <Text style={styles.categoryTextActive}>{singleCategory.name}</Text>
                </View>

                <View style={[styles.sectionHeader, styles.productsHeader]}>
                  <Text style={styles.sectionTitle}>원픽 제품 둘러보기</Text>
                  <Text style={styles.countText}>{products.length}개</Text>
                </View>

                {products.length > 0 ? (
                  products.map((product) => (
                    <ProductCard key={product.id} product={product} onPress={() => openProduct(product.id)} />
                  ))
                ) : (
                  <View style={styles.stateCard}>
                    <Text style={styles.stateTitle}>아직 등록된 제품이 없어요</Text>
                    <Text style={styles.stateText}>제품명으로 첫 원픽을 등록해보세요.</Text>
                  </View>
                )}
              </>
            ) : (
              <>
                <View style={styles.sectionHeader}>
                  <Text style={styles.sectionTitle}>카테고리</Text>
                  <Text style={styles.sectionHint}>{data.openCategories.length}개 열림</Text>
                </View>
                <View style={styles.categoryGrid}>
                  {data.openCategories.map((category) => (
                    <Pressable accessibilityRole="button" key={category.id} style={styles.categoryCard} onPress={() => openRegistration(category.id)}>
                      <Text style={styles.categoryCardTitle}>{category.name}</Text>
                      <Text style={styles.categoryCardSub}>제품명으로 원픽 등록</Text>
                    </Pressable>
                  ))}
                </View>
              </>
            )}

            <View style={styles.noticeCard}>
              <View style={styles.noticeIcon}><Text style={styles.noticeIconText}>1</Text></View>
              <View style={styles.noticeCopy}>
                <Text style={styles.noticeTitle}>카테고리마다 원픽은 하나</Text>
                <Text style={styles.noticeSub}>다른 제품으로 바꾸면 이전 선택은 기록으로 남습니다.</Text>
              </View>
            </View>
          </>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  registerButton: { alignSelf: 'flex-start', backgroundColor: '#D96D4B', paddingHorizontal: 20, paddingVertical: 13, borderRadius: 14, marginTop: 20 },
  safeArea: { flex: 1, backgroundColor: '#FAF8F5' },
  content: { width: '100%', maxWidth: 800, alignSelf: 'center', paddingHorizontal: 22, paddingBottom: 110 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingTop: 14, paddingBottom: 22 },
  eyebrow: { color: '#D96D4B', fontSize: 12, fontWeight: '800', letterSpacing: 2.8 },
  greeting: { color: '#202124', fontSize: 30, fontWeight: '800', lineHeight: 36, marginTop: 9, letterSpacing: -0.8 },
  avatar: { width: 42, height: 42, borderRadius: 21, backgroundColor: '#202124', alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: '#FAF8F5', fontSize: 18, fontWeight: '900' },
  heroCard: { minHeight: 184, borderRadius: 24, backgroundColor: '#252B38', overflow: 'hidden', flexDirection: 'row', justifyContent: 'space-between', padding: 24, marginBottom: 30 },
  heroCopy: { zIndex: 1, maxWidth: '78%' },
  heroKicker: { color: '#F3B59D', fontSize: 11, fontWeight: '800', letterSpacing: 2.2, marginBottom: 13 },
  heroTitle: { color: '#FFF9F3', fontSize: 25, lineHeight: 31, fontWeight: '800', letterSpacing: -0.6 },
  heroSub: { color: '#C8C9CD', fontSize: 13, lineHeight: 19, marginTop: 14 },
  heroShape: { color: '#E98A69', fontSize: 150, lineHeight: 150, fontWeight: '900', position: 'absolute', right: 12, bottom: -34, opacity: 0.9 },
  sectionHeader: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 13 },
  productsHeader: { marginTop: 29 },
  sectionTitle: { flexShrink: 1, marginRight: 8, color: '#202124', fontSize: 18, fontWeight: '800', letterSpacing: -0.2 },
  sectionHint: { color: '#8E8A85', fontSize: 12 },
  countText: { color: '#D96D4B', fontSize: 12, fontWeight: '700' },
  categoryChipActive: { alignSelf: 'flex-start', paddingHorizontal: 18, paddingVertical: 10, borderRadius: 30, backgroundColor: '#D96D4B' },
  categoryTextActive: { color: '#FFF9F3', fontSize: 13, fontWeight: '800' },
  categoryGrid: { gap: 10 },
  categoryCard: { backgroundColor: '#FFFFFF', borderRadius: 18, padding: 18 },
  categoryCardTitle: { color: '#202124', fontSize: 17, fontWeight: '800' },
  categoryCardSub: { color: '#D96D4B', fontSize: 12, fontWeight: '700', marginTop: 7 },
  productCard: { flexDirection: 'row', alignItems: 'center', padding: 11, backgroundColor: '#FFFFFF', borderRadius: 20, marginBottom: 11, shadowColor: '#31251F', shadowOpacity: 0.06, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 2 },
  productImage: { width: 102, height: 102, borderRadius: 14, backgroundColor: '#F4D7C5', alignItems: 'center', justifyContent: 'center' },
  productEmoji: { fontSize: 48 },
  productInfo: { flex: 1, paddingHorizontal: 14, paddingVertical: 7 },
  productBrand: { color: '#D96D4B', fontSize: 10, fontWeight: '800', letterSpacing: 1.2 },
  productName: { color: '#202124', fontSize: 17, fontWeight: '800', marginTop: 7 },
  productNote: { color: '#8E8A85', fontSize: 12, lineHeight: 18, marginTop: 8 },
  chevron: { color: '#B8B1AA', fontSize: 28, marginRight: 4 },
  stateCard: { alignItems: 'center', backgroundColor: '#FFFFFF', borderRadius: 20, padding: 24, marginBottom: 22 },
  stateTitle: { color: '#202124', fontSize: 15, fontWeight: '800', marginTop: 10 },
  stateText: { color: '#8E8A85', fontSize: 12, lineHeight: 18, textAlign: 'center', marginTop: 7 },
  retryButton: { backgroundColor: '#202124', borderRadius: 14, paddingHorizontal: 16, paddingVertical: 11, marginTop: 16 },
  retryButtonText: { color: '#FFFFFF', fontSize: 13, fontWeight: '800' },
  noticeCard: { flexDirection: 'row', alignItems: 'center', borderWidth: 1.2, borderColor: '#E3DCD5', borderRadius: 20, padding: 16, marginTop: 14 },
  noticeIcon: { width: 40, height: 40, borderRadius: 13, backgroundColor: '#F9E4DB', alignItems: 'center', justifyContent: 'center' },
  noticeIconText: { color: '#D96D4B', fontSize: 19, fontWeight: '900' },
  noticeCopy: { flex: 1, marginLeft: 13 },
  noticeTitle: { color: '#202124', fontSize: 14, fontWeight: '800' },
  noticeSub: { color: '#8E8A85', fontSize: 11, lineHeight: 16, marginTop: 5 },
  homePickCard: { backgroundColor: '#FFFFFF', borderRadius: 20, padding: 18, marginBottom: 11 },
  cardAction: { paddingTop: 10, marginTop: 10, borderTopWidth: 1, borderTopColor: '#EEE8E2' },
  categoryProduct: { marginTop: 16, paddingTop: 10, borderTopWidth: 1, borderTopColor: '#EEE8E2' },
  pressed: { opacity: 0.7 },
});
