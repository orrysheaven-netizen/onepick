import { useRouter } from 'expo-router';
import { PickPhoto } from '@/components/pick-photo';
import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ProductSearch } from '@/components/product-search';
import { useExploreData } from '@/hooks/useExploreData';

export default function ExploreScreen() {
  const router = useRouter();
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | undefined>();
  const query = useExploreData(selectedCategoryId);

  const openPick = (pickId: string) => {
    router.push({ pathname: '/pick/[pickId]', params: { pickId } });
  };

  const openProduct = (productId: string) => {
    router.push({ pathname: '/product/[productId]', params: { productId } });
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        <Text style={styles.eyebrow}>EXPLORE</Text>
        <Text style={styles.title}>사람들의 원픽을{ '\n' }구경해보세요</Text>
        <Text style={styles.subtitle}>지금 사람들이 고른 하나와 그 이유를 실제 선택 기록으로 보여드려요.</Text>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.categoryList}>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ selected: !selectedCategoryId }}
            onPress={() => setSelectedCategoryId(undefined)}
            style={[styles.chip, !selectedCategoryId && styles.chipActive]}>
            <Text style={[styles.chipText, !selectedCategoryId && styles.chipTextActive]}>전체</Text>
          </Pressable>
          {query.data?.openCategories.map((category) => (
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ selected: selectedCategoryId === category.id }}
              key={category.id}
              onPress={() => setSelectedCategoryId(category.id)}
              style={[styles.chip, selectedCategoryId === category.id && styles.chipActive]}>
              <Text style={[styles.chipText, selectedCategoryId === category.id && styles.chipTextActive]}>{category.name}</Text>
            </Pressable>
          ))}
        </ScrollView>

        <ProductSearch categoryId={selectedCategoryId} onSelect={openProduct} />

        {query.isPending && !query.data ? (
          <View style={styles.stateCard}>
            <ActivityIndicator />
            <Text style={styles.stateText}>최근 원픽을 불러오고 있어요</Text>
          </View>
        ) : null}

        {query.isError && !query.data ? (
          <View style={styles.stateCard}>
            <Text style={styles.stateTitle}>탐색 데이터를 불러오지 못했어요</Text>
            <Pressable onPress={() => void query.refetch()} style={({ pressed }) => [styles.retryButton, pressed && styles.pressed]}>
              <Text style={styles.retryButtonText}>다시 불러오기</Text>
            </Pressable>
          </View>
        ) : null}

        {query.data ? (
          <>
            <View style={styles.sectionHeader}>
              <View>
                <Text style={styles.sectionTitle}>최근 원픽</Text>
                <Text style={styles.sectionDescription}>사람들이 최근 공개한 현재 원픽이에요.</Text>
              </View>
              {query.isFetching ? <ActivityIndicator size="small" /> : null}
            </View>

            {query.data.feed.length > 0 ? (
              query.data.feed.map(({ pick, profile, product, category }) => (
                <Pressable
                  key={pick.id}
                  onPress={() => openPick(pick.id)}
                  style={({ pressed }) => [styles.pickCard, pressed && styles.pressed]}>
                  <PickPhoto uri={product?.thumbnailUrl} label={product?.name ?? '제품 대표 이미지'} />
                  <View style={styles.pickCopy}>
                    <Text style={styles.pickMeta}>
                      {profile ? `@${profile.username}` : 'OnePick 사용자'} · {category?.name ?? '카테고리'}
                    </Text>
                    <Text style={styles.pickName}>{product?.name ?? '제품 정보 확인 중'}</Text>
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

            {query.data.recentProducts.length > 0 ? (
              <>
                <View style={[styles.sectionHeader, styles.productSectionHeader]}>
                  <View>
                    <Text style={styles.sectionTitle}>최근 등장한 제품</Text>
                    <Text style={styles.sectionDescription}>최근 원픽 기록에 등장한 제품을 중복 없이 모았어요.</Text>
                  </View>
                </View>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.productList}>
                  {query.data.recentProducts.map(({ product, category }) => (
                    <Pressable
                      key={product.id}
                      onPress={() => openProduct(product.id)}
                      style={({ pressed }) => [styles.productCard, pressed && styles.pressed]}>
                      <PickPhoto uri={product.thumbnailUrl} label={product.name} />
                      <Text style={styles.productCategory}>{category.name}</Text>
                      <Text numberOfLines={2} style={styles.productName}>{product.name}</Text>
                      <Text style={styles.productAction}>제품 상세 보기</Text>
                    </Pressable>
                  ))}
                </ScrollView>
              </>
            ) : null}
          </>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#FAF8F5' },
  content: { width: '100%', maxWidth: 800, alignSelf: 'center', paddingHorizontal: 22, paddingTop: 18, paddingBottom: 110 },
  eyebrow: { color: '#D96D4B', fontSize: 12, fontWeight: '800', letterSpacing: 2.8 },
  title: { color: '#202124', fontSize: 30, fontWeight: '800', lineHeight: 36, letterSpacing: -0.8, marginTop: 10 },
  subtitle: { color: '#8E8A85', fontSize: 13, lineHeight: 20, marginTop: 13, maxWidth: 360 },
  categoryList: { gap: 8, paddingVertical: 28 },
  chip: { backgroundColor: '#F0ECE7', borderRadius: 30, paddingHorizontal: 17, paddingVertical: 10 },
  chipActive: { backgroundColor: '#D96D4B' },
  chipText: { color: '#6C6863', fontSize: 13, fontWeight: '700' },
  chipTextActive: { color: '#FFF9F3' },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 13 },
  productSectionHeader: { marginTop: 30 },
  sectionTitle: { color: '#202124', fontSize: 18, fontWeight: '800' },
  sectionDescription: { color: '#8E8A85', fontSize: 11, lineHeight: 17, marginTop: 4 },
  pickCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#FFFFFF', borderRadius: 20, padding: 12, marginBottom: 11 },
  pickIcon: { width: 70, height: 70, borderRadius: 15, backgroundColor: '#F4D7C5', alignItems: 'center', justifyContent: 'center' },
  pickEmoji: { fontSize: 33 },
  pickCopy: { flex: 1, paddingLeft: 13 },
  pickMeta: { color: '#D96D4B', fontSize: 10, fontWeight: '800' },
  pickName: { color: '#202124', fontSize: 15, fontWeight: '800', marginTop: 5 },
  pickReview: { color: '#8E8A85', fontSize: 11, lineHeight: 17, marginTop: 5 },
  arrow: { color: '#B8B1AA', fontSize: 25, marginLeft: 5 },
  productList: { gap: 11, paddingRight: 10 },
  productCard: { width: 158, backgroundColor: '#FFFFFF', borderRadius: 19, padding: 12 },
  productThumb: { width: '100%', height: 112, borderRadius: 15, backgroundColor: '#F4D7C5', alignItems: 'center', justifyContent: 'center' },
  productEmoji: { fontSize: 44 },
  productCategory: { color: '#D96D4B', fontSize: 9, fontWeight: '800', letterSpacing: 1, marginTop: 11 },
  productName: { color: '#202124', fontSize: 14, lineHeight: 19, fontWeight: '800', marginTop: 5 },
  productAction: { color: '#8E8A85', fontSize: 10, marginTop: 9 },
  stateCard: { alignItems: 'center', backgroundColor: '#FFFFFF', borderRadius: 20, padding: 28, marginTop: 28 },
  stateTitle: { color: '#202124', fontSize: 16, fontWeight: '800' },
  stateText: { color: '#8E8A85', fontSize: 12, lineHeight: 18, textAlign: 'center', marginTop: 9 },
  retryButton: { backgroundColor: '#202124', borderRadius: 14, paddingHorizontal: 16, paddingVertical: 11, marginTop: 16 },
  retryButtonText: { color: '#FFFFFF', fontSize: 12, fontWeight: '800' },
  emptyCard: { alignItems: 'center', backgroundColor: '#FFFFFF', borderRadius: 20, padding: 26 },
  emptyTitle: { color: '#202124', fontSize: 15, fontWeight: '800' },
  emptyText: { color: '#8E8A85', fontSize: 12, lineHeight: 18, textAlign: 'center', marginTop: 7 },
  pressed: { opacity: 0.7 },
});
