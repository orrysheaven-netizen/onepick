import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PickPhoto } from '@/components/pick-photo';
import { useProductSearch } from '@/hooks/useProductSearch';
import { useRegistrationCategories } from '@/hooks/useRegisterPick';

export default function FindPickProductScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ categoryId?: string }>();
  const [query, setQuery] = useState('');
  const categories = useRegistrationCategories();
  const search = useProductSearch(query, params.categoryId);
  const selectedCategory = categories.data?.find((category) => category.id === params.categoryId);
  const hasQuery = query.trim().length > 0;
  const noResults = hasQuery && !search.isWaiting && !search.isFetching && !search.isError && search.data?.length === 0;

  const chooseProduct = (productId: string, categoryId: string) => {
    router.push({
      pathname: '/pick/choose',
      params: { productId, categoryId },
    });
  };

  const requestProduct = () => {
    router.push({
      pathname: '/pick/request',
      params: {
        productName: query.trim(),
        ...(params.categoryId ? { categoryId: params.categoryId } : {}),
      },
    });
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="돌아가기"
          onPress={() => router.canGoBack() ? router.back() : router.replace('/')}
          style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}>
          <Text style={styles.backText}>‹</Text>
        </Pressable>

        <Text style={styles.kicker}>FIND YOUR ONE PICK</Text>
        <Text style={styles.title}>제품을 먼저 찾아보세요</Text>
        <Text style={styles.subtitle}>
          제품을 선택하면 카테고리는 자동으로 연결됩니다. 직접 카테고리를 고를 필요가 없어요.
        </Text>

        {selectedCategory ? (
          <View style={styles.categoryBadge}>
            <Text style={styles.categoryBadgeText}>{selectedCategory.label} 안에서 찾는 중</Text>
          </View>
        ) : null}

        <TextInput
          autoFocus
          accessibilityLabel="원픽 제품 검색"
          autoCapitalize="none"
          onChangeText={setQuery}
          placeholder="예: 신라면, 아이폰 16 프로"
          placeholderTextColor="#AAA39C"
          returnKeyType="search"
          style={styles.input}
          value={query}
        />

        {search.isWaiting || search.isFetching ? (
          <View style={styles.inlineState}>
            <ActivityIndicator />
            <Text style={styles.stateText}>등록된 제품을 찾고 있어요</Text>
          </View>
        ) : null}

        {search.isError ? (
          <View style={styles.stateCard}>
            <Text style={styles.stateTitle}>제품 검색을 불러오지 못했어요</Text>
            <Pressable onPress={() => void search.refetch()} style={styles.secondaryButton}>
              <Text style={styles.secondaryButtonText}>다시 검색</Text>
            </Pressable>
          </View>
        ) : null}

        {!hasQuery ? (
          <View style={styles.stateCard}>
            <Text style={styles.stateTitle}>제품명만 입력하면 됩니다</Text>
            <Text style={styles.stateText}>검색 결과에서 정식 제품을 선택하면 제품에 연결된 카테고리를 그대로 사용합니다.</Text>
          </View>
        ) : null}

        {!search.isWaiting && hasQuery && search.data?.map((product) => {
          const category = categories.data?.find((item) => item.id === product.categoryId);
          return (
            <Pressable
              key={product.id}
              accessibilityRole="button"
              onPress={() => chooseProduct(product.id, product.categoryId)}
              style={({ pressed }) => [styles.productCard, pressed && styles.pressed]}>
              <PickPhoto uri={product.thumbnailUrl} label={product.name} />
              <View style={styles.productCopy}>
                <Text style={styles.productCategory}>{category?.label ?? '등록된 카테고리'}</Text>
                <Text style={styles.productName}>{product.name}</Text>
                <Text style={styles.productAction}>이 제품을 원픽으로 선택 ›</Text>
              </View>
            </Pressable>
          );
        })}

        {noResults ? (
          <View style={styles.requestCard}>
            <Text style={styles.stateTitle}>찾는 제품이 없나요?</Text>
            <Text style={styles.stateText}>검색한 제품명을 그대로 가져가 등록 요청을 보낼 수 있어요.</Text>
            <Pressable onPress={requestProduct} style={styles.primaryButton}>
              <Text style={styles.primaryButtonText}>제품 등록 요청하기</Text>
            </Pressable>
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#FAF8F5' },
  content: { width: '100%', maxWidth: 680, alignSelf: 'center', paddingHorizontal: 22, paddingBottom: 60 },
  backButton: { width: 44, height: 44, justifyContent: 'center', marginTop: 4, marginLeft: -8 },
  backText: { color: '#202124', fontSize: 36, lineHeight: 40, fontWeight: '300' },
  kicker: { color: '#D96D4B', fontSize: 10, fontWeight: '900', letterSpacing: 2.1, marginTop: 12 },
  title: { color: '#202124', fontSize: 30, lineHeight: 37, fontWeight: '900', letterSpacing: -0.8, marginTop: 8 },
  subtitle: { color: '#827C77', fontSize: 13, lineHeight: 20, marginTop: 10 },
  categoryBadge: { alignSelf: 'flex-start', backgroundColor: '#F4E7DF', borderRadius: 999, paddingHorizontal: 13, paddingVertical: 8, marginTop: 16 },
  categoryBadgeText: { color: '#A95A40', fontSize: 11, fontWeight: '800' },
  input: { minHeight: 54, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#E1D9D2', borderRadius: 17, paddingHorizontal: 16, color: '#202124', fontSize: 16, marginTop: 22 },
  inlineState: { flexDirection: 'row', alignItems: 'center', gap: 9, paddingVertical: 18 },
  stateCard: { backgroundColor: '#FFFFFF', borderRadius: 18, padding: 20, marginTop: 16 },
  requestCard: { backgroundColor: '#FFFFFF', borderRadius: 20, padding: 22, marginTop: 18 },
  stateTitle: { color: '#202124', fontSize: 15, fontWeight: '800' },
  stateText: { color: '#8E8A85', fontSize: 12, lineHeight: 18, marginTop: 7 },
  productCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#FFFFFF', borderRadius: 20, padding: 12, marginTop: 11 },
  productCopy: { flex: 1, paddingLeft: 14 },
  productCategory: { color: '#D96D4B', fontSize: 10, fontWeight: '800', letterSpacing: 0.8 },
  productName: { color: '#202124', fontSize: 16, fontWeight: '800', marginTop: 5 },
  productAction: { color: '#8E8A85', fontSize: 11, marginTop: 7 },
  primaryButton: { minHeight: 50, borderRadius: 15, backgroundColor: '#D96D4B', alignItems: 'center', justifyContent: 'center', marginTop: 16 },
  primaryButtonText: { color: '#FFFFFF', fontSize: 14, fontWeight: '900' },
  secondaryButton: { alignSelf: 'flex-start', minHeight: 42, borderRadius: 13, backgroundColor: '#202124', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 15, marginTop: 13 },
  secondaryButtonText: { color: '#FFFFFF', fontSize: 12, fontWeight: '800' },
  pressed: { opacity: 0.7 },
});