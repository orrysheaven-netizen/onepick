import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PickPhoto } from '@/components/pick-photo';
import { useItemSearch } from '@/hooks/useItemSearch';
import { useRegistrationCategories } from '@/hooks/useRegisterPick';

export default function FindPickItemScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ categoryId?: string }>();
  const [query, setQuery] = useState('');
  const categories = useRegistrationCategories();
  const search = useItemSearch(query, params.categoryId);
  const selectedCategory = categories.data?.find((category) => category.id === params.categoryId);
  const hasQuery = query.trim().length > 0;
  const noResults = hasQuery && !search.isWaiting && !search.isFetching && !search.isError && search.data?.length === 0;

  const chooseItem = (itemId: string, categoryId: string) => {
    router.push({
      pathname: '/pick/choose',
      params: { itemId, categoryId },
    });
  };

  const requestItem = () => {
    router.push({
      pathname: '/pick/request',
      params: {
        itemName: query.trim(),
        ...(params.categoryId ? { categoryId: params.categoryId } : {}),
      },
    });
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="돌아가기"
          onPress={() => router.canGoBack() ? router.back() : router.replace('/')}
          style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}>
          <Text style={styles.backText}>‹</Text>
        </Pressable>

        <Text style={styles.kicker}>FIND YOUR ONE PICK</Text>
        <Text style={styles.title}>나의 원픽 찾기</Text>
        <Text style={styles.subtitle}>
          좋아하는 제품을 검색하고, 나만의 하나를 골라보세요.
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
          placeholder="제품명 검색"
          placeholderTextColor="#89909C"
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
            <Text style={styles.stateText}>검색한 제품을 선택하면 원픽을 남길 수 있어요.</Text>
          </View>
        ) : null}

        {!search.isWaiting && hasQuery && search.data?.map((item) => {
          const category = categories.data?.find((category) => category.id === item.categoryId);
          return (
            <Pressable
              key={item.id}
              accessibilityRole="button"
              onPress={() => chooseItem(item.id, item.categoryId)}
              style={({ pressed }) => [styles.itemCard, pressed && styles.pressed]}>
              <PickPhoto uri={item.thumbnailUrl} label={item.name} />
              <View style={styles.itemCopy}>
                <Text style={styles.itemCategory}>{category?.label ?? '등록된 카테고리'}</Text>
                <Text style={styles.itemName}>{item.name}</Text>
                <Text style={styles.itemAction}>이 제품을 원픽으로 선택 ›</Text>
              </View>
            </Pressable>
          );
        })}

        {noResults ? (
          <View style={styles.requestCard}>
            <Text style={styles.stateTitle}>찾는 제품이 없나요?</Text>
            <Text style={styles.stateText}>검색한 제품명을 그대로 가져가 등록 요청을 보낼 수 있어요.</Text>
            <Pressable onPress={requestItem} style={styles.primaryButton}>
              <Text style={styles.primaryButtonText}>제품 등록 요청하기</Text>
            </Pressable>
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#F5F6F8' },
  content: { width: '100%', maxWidth: 480, alignSelf: 'center', paddingHorizontal: 20, paddingBottom: 36 },
  backButton: { width: 44, height: 44, justifyContent: 'center', marginTop: 4, marginLeft: -8 },
  backText: { color: '#202124', fontSize: 36, lineHeight: 40, fontWeight: '300' },
  kicker: { color: '#4945ED', fontSize: 12, fontWeight: '900', letterSpacing: 2.1, marginTop: 12 },
  title: { color: '#202124', fontSize: 26, lineHeight: 34, fontWeight: '900', letterSpacing: -0.8, marginTop: 8 },
  subtitle: { color: '#747985', fontSize: 13, lineHeight: 20, marginTop: 10 },
  categoryBadge: { alignSelf: 'flex-start', backgroundColor: '#EFEEFF', borderRadius: 999, paddingHorizontal: 13, paddingVertical: 8, marginTop: 16 },
  categoryBadgeText: { color: '#4945ED', fontSize: 12, fontWeight: '800' },
  input: { minHeight: 54, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#E3E5EA', borderRadius: 17, paddingHorizontal: 16, color: '#202124', fontSize: 16, marginTop: 22 },
  inlineState: { flexDirection: 'row', alignItems: 'center', gap: 9, paddingVertical: 18 },
  stateCard: { borderWidth: 1, borderColor: '#E3E5EA', backgroundColor: '#FFFFFF', borderRadius: 18, padding: 20, marginTop: 16 },
  requestCard: { borderWidth: 1, borderColor: '#E3E5EA', backgroundColor: '#FFFFFF', borderRadius: 20, padding: 22, marginTop: 18 },
  stateTitle: { color: '#202124', fontSize: 15, fontWeight: '800' },
  stateText: { color: '#747985', fontSize: 12, lineHeight: 18, marginTop: 7 },
  itemCard: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: '#E3E5EA', backgroundColor: '#FFFFFF', borderRadius: 20, padding: 12, marginTop: 11 },
  itemCopy: { flex: 1, paddingLeft: 14 },
  itemCategory: { color: '#4945ED', fontSize: 12, fontWeight: '800', letterSpacing: 0.8 },
  itemName: { color: '#202124', fontSize: 16, fontWeight: '800', marginTop: 5 },
  itemAction: { color: '#747985', fontSize: 12, marginTop: 7 },
  primaryButton: { minHeight: 50, borderRadius: 15, backgroundColor: '#4945ED', alignItems: 'center', justifyContent: 'center', marginTop: 16 },
  primaryButtonText: { color: '#FFFFFF', fontSize: 14, fontWeight: '900' },
  secondaryButton: { alignSelf: 'flex-start', minHeight: 42, borderRadius: 13, backgroundColor: '#202124', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 15, marginTop: 13 },
  secondaryButtonText: { color: '#FFFFFF', fontSize: 12, fontWeight: '800' },
  pressed: { opacity: 0.7 },
});
