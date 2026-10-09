import { useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { Button, Icon, StateCard } from '@/components/ui';
import { useAuthSession } from '@/hooks/useAuthSession';
import { useLinkCategorySuggestions } from '@/hooks/useLinkCategorySuggestions';
import { isDeliveryAppUrl } from '@/lib/items/pickChannel';
import type { LinkCategoryOption, LinkPlaceMatch } from '@/types/domain/linkCategorySuggestion';
import { OnePick } from '@/constants/onepick';

function errorText(error: unknown) {
  const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
  if (code === 'AUTH_REQUIRED') return '로그인한 뒤 링크 추천을 사용할 수 있어요.';
  if (code === 'RATE_LIMITED') return '링크 확인 요청이 많아요. 잠시 후 다시 시도해주세요.';
  if (code === 'ITEM_NOT_ELIGIBLE') return 'https:// 링크를 확인해주세요.';
  return '링크를 확인하지 못했어요. 이름을 직접 입력하고 다시 시도해주세요.';
}

type Params = { url?: string | string[]; name?: string | string[] };
const scalar = (value: string | string[] | undefined) => typeof value === 'string' ? value : '';

export default function LinkCategorySuggestionScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<Params>();
  const auth = useAuthSession();
  const suggestion = useLinkCategorySuggestions();
  const [url, setUrl] = useState(() => scalar(params.url).slice(0, 2048));
  const [name, setName] = useState(() => scalar(params.name).slice(0, 100));
  const [selectedPlace, setSelectedPlace] = useState<LinkPlaceMatch | null>(null);
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null);
  const [showCategorySearch, setShowCategorySearch] = useState(false);
  const [categorySearch, setCategorySearch] = useState('');

  const result = suggestion.data;
  // Delivery is one store's food (매장), never an online seller: send people to the menu → 매장 flow.
  const isDeliveryLink = isDeliveryAppUrl(url);
  const categoryOptions = useMemo(() => {
    const text = categorySearch.trim().toLowerCase();
    if (!result || !text) return [];
    return result.categories.filter((category) =>
      category.label.toLowerCase().includes(text) || category.name.toLowerCase().includes(text)
    ).slice(0, 8);
  }, [result, categorySearch]);

  const analyze = async (placeCatalogId?: string) => {
    if (isDeliveryAppUrl(url)) return null;
    if (!auth.user) {
      const linkUrl = url.trim();
      if (!linkUrl) return null;
      router.push({
        pathname: '/auth/login',
        params: {
          action: 'suggest_link_category',
          linkUrl,
          ...(name.trim() ? { linkName: name.trim() } : {}),
        },
      });
      return null;
    }
    setSelectedCategoryId(null);
    const next = await suggestion.mutateAsync({
      url,
      name,
      ...(placeCatalogId ? { placeCatalogId } : {}),
    });
    if (placeCatalogId) {
      setSelectedPlace(next.places.find((place) => place.catalogId === placeCatalogId) ?? null);
    } else if (next.places.length === 1) {
      setSelectedPlace(next.places[0]);
    } else {
      setSelectedPlace(null);
    }
    if (!name.trim() && next.resolvedName) setName(next.resolvedName);
    if (next.suggestions.length === 1) setSelectedCategoryId(next.suggestions[0].categoryId);
    return next;
  };

  const choosePlace = async (place: LinkPlaceMatch) => {
    setSelectedPlace(place);
    try {
      await analyze(place.catalogId);
    } catch {
      // Mutation state renders the error while keeping the selected place.
    }
  };

  const displayName = (selectedPlace?.name || name.trim() || result?.resolvedName || result?.title || '').trim();

  // Online links can land outside the categories the matcher covers, so the request can
  // also go through without a category and be classified in admin review.
  const requestItem = (categoryId?: string) => {
    if (!result || result.kind !== 'online' || !displayName) return;
    router.push({
      pathname: '/pick/request',
      params: {
        ...(categoryId ? { categoryId } : {}),
        itemName: displayName,
        sourceUrl: result.canonicalUrl,
      },
    });
  };

  const continueWithCategory = () => {
    if (!result || !selectedCategoryId) return;

    if (result.kind === 'place') {
      if (!selectedPlace) return;
      router.push({
        pathname: '/pick/find',
        params: {
          categoryId: selectedCategoryId,
          placeCatalogId: selectedPlace.catalogId,
          query: selectedPlace.name,
        },
      });
      return;
    }

    requestItem(selectedCategoryId);
  };

  if (auth.isLoading) {
    return <SafeAreaView style={styles.safeArea}><View style={styles.center}><StateCard loading title="로그인 상태를 확인하고 있어요." /></View></SafeAreaView>;
  }

  if (auth.error) {
    return <SafeAreaView style={styles.safeArea}><View style={styles.center}><StateCard tone="danger" title="로그인 상태를 확인하지 못했어요."
      action={{ label: '다시 확인', variant: 'secondary', onPress: () => void auth.retry() }} /></View></SafeAreaView>;
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Pressable accessibilityRole="button" accessibilityLabel="돌아가기" onPress={() => router.canGoBack() ? router.back() : router.replace('/')} style={styles.backButton}>
          <Icon name="back" />
        </Pressable>

        <Text style={styles.title}>링크로 원픽 찾기</Text>
        <Text style={styles.subtitle}>카테고리를 먼저 고르지 않아도 돼요. 링크를 확인한 뒤 가능한 후보만 추천하고, 마지막 선택은 직접 해요.</Text>

        <View style={styles.card}>
          <Text style={styles.label}>네이버 지도 · 공식몰 · 판매 링크</Text>
          <TextInput
            accessibilityLabel="원픽 링크"
            autoCapitalize="none"
            autoCorrect={false}
            value={url}
            onChangeText={(value) => {
              setUrl(value);
              suggestion.reset();
              setSelectedPlace(null);
              setSelectedCategoryId(null);
            }}
            placeholder="https://naver.me/... 또는 https://..."
            placeholderTextColor={OnePick.textSecondary}
            style={styles.input}
          />

          <Text style={styles.label}>이름 · 자동 인식이 안 될 때만</Text>
          <TextInput
            accessibilityLabel="원픽 이름"
            value={name}
            onChangeText={(value) => {
              setName(value);
              suggestion.reset();
              setSelectedPlace(null);
              setSelectedCategoryId(null);
            }}
            maxLength={100}
            placeholder="예: 대성집, 곱창김 20매"
            placeholderTextColor={OnePick.textSecondary}
            style={styles.input}
          />

          {isDeliveryLink ? <View accessibilityRole="alert">
            <Text style={styles.error}>배달앱 링크는 매장 원픽이에요. 메뉴를 고른 뒤 매장에서 가게 이름으로 찾아주세요. 네이버 지도 링크를 붙여넣어도 돼요.</Text>
            <Button variant="secondary" label="메뉴 고르고 매장 찾기" onPress={() => router.push('/pick/find')} />
          </View> : null}
          {!auth.user ? <Text style={styles.notice}>추천 요청 전에 로그인해요. 입력한 링크와 이름은 로그인 후 그대로 이어져요.</Text> : null}
          <Button
            label={suggestion.isPending ? '확인 중…' : auth.user ? '링크 확인하고 추천받기' : '로그인하고 추천받기'}
            disabled={suggestion.isPending || !url.trim() || isDeliveryLink}
            onPress={() => void analyze().catch(() => {})}
          />
        </View>

        {suggestion.isPending ? <View style={styles.inline}><ActivityIndicator /><Text style={styles.muted}>링크와 카테고리를 확인하고 있어요.</Text></View> : null}
        {suggestion.isError ? <Text accessibilityRole="alert" style={styles.error}>{errorText(suggestion.error)}</Text> : null}

        {result ? (
          <>
            <View style={styles.card}>
              <Text style={styles.sectionTitle}>{result.kind === 'place' ? '장소 확인' : '링크 확인'}</Text>
              <Text style={styles.resultTitle}>{result.resolvedName ?? result.title ?? result.host}</Text>
              <Text style={styles.muted}>{result.host}</Text>

              {result.kind === 'place' && result.places.length === 0 ? (
                <Text style={styles.notice}>현재 OnePick 장소 데이터에서 같은 가게를 찾지 못했어요. 이름을 확인해 다시 시도해주세요. 이름만으로 새 맛집을 만들지는 않아요.</Text>
              ) : null}

              {result.kind === 'place' && result.places.map((place) => (
                <Pressable
                  key={place.catalogId}
                  onPress={() => void choosePlace(place)}
                  style={[styles.choiceCard, selectedPlace?.catalogId === place.catalogId && styles.choiceCardActive]}
                >
                  <Text style={styles.choiceTitle}>{place.name}{place.branchName ? ' · ' + place.branchName : ''}</Text>
                  <Text style={styles.muted}>{place.roadAddress ?? place.address ?? '주소 정보 없음'}</Text>
                  {place.providerCategory ? <Text style={styles.meta}>{place.providerCategory}</Text> : null}
                </Pressable>
              ))}
            </View>

            {(result.kind === 'online' || selectedPlace) ? (
              <View style={styles.card}>
                <Text style={styles.sectionTitle}>추천 카테고리</Text>
                <Text style={styles.muted}>추천은 확정이 아니에요. 가장 맞는 항목을 직접 선택해주세요.</Text>

                {result.suggestions.length === 0 ? <Text style={styles.notice}>자동 추천 후보가 없어요. 아래에서 카테고리를 검색해주세요.</Text> : null}

                <View style={styles.choiceWrap}>
                  {result.suggestions.map((category) => (
                    <Pressable
                      key={category.categoryId}
                      onPress={() => setSelectedCategoryId(category.categoryId)}
                      style={[styles.categoryChoice, selectedCategoryId === category.categoryId && styles.categoryChoiceActive]}
                    >
                      <Text style={[styles.categoryText, selectedCategoryId === category.categoryId && styles.categoryTextActive]}>{category.name}</Text>
                      <Text style={[styles.categoryReason, selectedCategoryId === category.categoryId && styles.categoryTextActive]}>{category.reason}</Text>
                    </Pressable>
                  ))}
                </View>

                <Pressable onPress={() => setShowCategorySearch((current) => !current)} style={styles.linkButton}>
                  <Text style={styles.linkText}>{showCategorySearch ? '카테고리 검색 닫기' : '다른 카테고리 찾기'}</Text>
                </Pressable>

                {showCategorySearch ? (
                  <>
                    <TextInput
                      accessibilityLabel="다른 카테고리 검색"
                      value={categorySearch}
                      onChangeText={setCategorySearch}
                      placeholder="예: 도가니탕, 설렁탕, 곱창김"
                      placeholderTextColor={OnePick.textSecondary}
                      style={styles.input}
                    />
                    {categorySearch.trim().length >= 1 && categoryOptions.length === 0 ? (
                      <Text style={styles.notice}>현재 등록된 카테고리에 없어요. 새 카테고리 제안은 관리자 검수 흐름으로 남길 수 있도록 후속 단계에서 연결해요.</Text>
                    ) : null}
                    {categoryOptions.map((category: LinkCategoryOption) => (
                      <Pressable
                        key={category.categoryId}
                        onPress={() => setSelectedCategoryId(category.categoryId)}
                        style={[styles.searchResult, selectedCategoryId === category.categoryId && styles.searchResultActive]}
                      >
                        <Text style={styles.choiceTitle}>{category.label}</Text>
                      </Pressable>
                    ))}
                  </>
                ) : null}

                <Button
                  label={result.kind === 'place' ? '이 메뉴로 장소 선택 계속' : '이 카테고리로 등록 요청 계속'}
                  disabled={!selectedCategoryId || (result.kind === 'place' && !selectedPlace)}
                  onPress={continueWithCategory}
                />
                {result.kind === 'online' ? (
                  <>
                    <Button
                      variant="secondary"
                      label="카테고리 없이 등록 요청"
                      disabled={!displayName}
                      onPress={() => requestItem()}
                    />
                    <Text style={styles.muted}>
                      {displayName ? '맞는 카테고리가 없으면 관리자가 검수하며 분류해요.' : '이름을 입력하고 다시 확인하면 카테고리 없이 요청할 수 있어요.'}
                    </Text>
                  </>
                ) : null}
              </View>
            ) : null}
          </>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: OnePick.background },
  content: { width: '100%', maxWidth: 720, alignSelf: 'center', padding: 20, paddingBottom: 48, gap: 16 },
  center: { flex: 1, justifyContent: 'center', padding: 24 },
  backButton: { width: 44, height: 44, justifyContent: 'center', marginLeft: -10 },
  title: { color: OnePick.text, fontSize: 28, fontWeight: '800', letterSpacing: -0.7 },
  subtitle: { color: OnePick.muted, fontSize: 14, lineHeight: 21 },
  card: { backgroundColor: OnePick.surface, borderWidth: 1, borderColor: OnePick.border, borderRadius: 16, padding: 16, gap: 12 },
  label: { color: OnePick.muted, fontSize: 12, fontWeight: '700' },
  input: { minHeight: 46, borderWidth: 1, borderColor: OnePick.border, borderRadius: 10, paddingHorizontal: 12, color: OnePick.text, backgroundColor: OnePick.surface },
  inline: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  muted: { color: OnePick.muted, fontSize: 13, lineHeight: 19 },
  error: { color: OnePick.danger, fontSize: 13, lineHeight: 19 },
  notice: { color: OnePick.muted, fontSize: 13, lineHeight: 20, paddingVertical: 4 },
  sectionTitle: { color: OnePick.text, fontSize: 17, fontWeight: '800' },
  resultTitle: { color: OnePick.text, fontSize: 16, fontWeight: '800' },
  choiceCard: { borderWidth: 1, borderColor: OnePick.border, borderRadius: 12, padding: 12, gap: 4 },
  choiceCardActive: { borderColor: OnePick.text, backgroundColor: OnePick.sunken },
  choiceTitle: { color: OnePick.text, fontSize: 14, fontWeight: '700' },
  meta: { color: OnePick.textSecondary, fontSize: 11 },
  choiceWrap: { gap: 8 },
  categoryChoice: { borderWidth: 1, borderColor: OnePick.border, borderRadius: 12, padding: 12, gap: 4 },
  categoryChoiceActive: { backgroundColor: OnePick.text, borderColor: OnePick.text },
  categoryText: { color: OnePick.text, fontSize: 14, fontWeight: '800' },
  categoryTextActive: { color: OnePick.onAccent },
  categoryReason: { color: OnePick.muted, fontSize: 11 },
  linkButton: { alignSelf: 'flex-start', paddingVertical: 6 },
  linkText: { color: OnePick.accent, fontSize: 13, fontWeight: '700' },
  searchResult: { borderBottomWidth: 1, borderBottomColor: OnePick.sunken, paddingVertical: 10 },
  searchResultActive: { backgroundColor: OnePick.sunken },
});
