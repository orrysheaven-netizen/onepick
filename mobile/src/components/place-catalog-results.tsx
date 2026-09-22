import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { StateCard } from '@/components/ui';
import { OnePick } from '@/constants/onepick';
import { AppError } from '@/errors/appError';
import { usePlaceCatalogSearch, useSelectPlaceCatalogItem } from '@/hooks/usePlaceCatalog';
import type { PlaceCatalogEntry } from '@/types/domain/placeCatalog';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Props = {
  query: string;
  categoryId: string;
  userId?: string;
  externalPlaceId?: string;
  onboarding?: boolean;
  localItemCount: number;
  onRequestItem: () => void;
};

function selectionError(error: unknown) {
  if (error instanceof AppError) {
    if (error.code === 'AUTH_REQUIRED') return '로그인 상태를 다시 확인한 뒤 장소 선택을 이어가주세요.';
    if (error.code === 'CATEGORY_NOT_PICKABLE' || error.code === 'ITEM_CATEGORY_MISMATCH') return '이 음식 카테고리에서는 해당 장소를 선택할 수 없어요.';
    if (error.code === 'ITEM_NOT_FOUND' || error.code === 'ITEM_NOT_ELIGIBLE') return '현재 선택할 수 없는 장소예요. 다른 지점을 찾아주세요.';
    if (error.code === 'FORBIDDEN') return '현재 계정에서는 장소를 선택할 수 없어요.';
  }
  return '장소 정보를 연결하지 못했어요. 다시 시도해주세요.';
}

export function PlaceCatalogResults({ query, categoryId, userId, externalPlaceId, onboarding, localItemCount, onRequestItem }: Props) {
  const router = useRouter();
  const search = usePlaceCatalogSearch(query, true);
  const selectPlace = useSelectPlaceCatalogItem();
  const attemptedReturn = useRef<string | null>(null);
  const navigating = useRef(false);
  const [error, setError] = useState<unknown>(null);
  const cleanQuery = query.trim().replace(/\s+/g, ' ');

  const continueToPick = (itemId: string, resolvedCategoryId: string, replace = false) => {
    if (resolvedCategoryId !== categoryId || navigating.current) return;
    navigating.current = true;
    const route = {
      pathname: '/pick/choose' as const,
      params: { itemId, categoryId: resolvedCategoryId, ...(onboarding ? { onboarding: '1' } : {}) },
    };
    if (replace) router.replace(route); else router.push(route);
  };

  const choosePlace = async (catalogId: string, replace = false) => {
    if (!UUID_PATTERN.test(catalogId) || selectPlace.isPending || navigating.current) return;
    setError(null);
    if (!userId) {
      navigating.current = true;
      router.push({ pathname: '/auth/login', params: { action: 'choose_place', externalPlaceId: catalogId, categoryId } });
      return;
    }
    try {
      const item = await selectPlace.mutateAsync({ catalogId, categoryId });
      continueToPick(item.itemId, item.categoryId, replace);
    } catch (cause) {
      setError(cause);
    }
  };

  useEffect(() => {
    if (!externalPlaceId || !UUID_PATTERN.test(externalPlaceId) || !userId
      || attemptedReturn.current === externalPlaceId || selectPlace.isPending || navigating.current) return;
    attemptedReturn.current = externalPlaceId;
    void choosePlace(externalPlaceId, true);
  }, [externalPlaceId, userId, categoryId]);

  const entries = search.data ?? [];
  const noResults = search.valid && !search.isWaiting && !search.isFetching && !search.isError && entries.length === 0;

  return <View style={styles.section}>
    {cleanQuery.length > 0 && cleanQuery.length < 2 ? <StateCard compact title="두 글자 이상 입력해주세요" text="등록된 상품과 함께 실제 음식점 지점을 찾습니다." /> : null}
    {cleanQuery.length > 80 ? <StateCard compact title="장소 검색어는 80자 이내로 입력해주세요" text="등록된 상품 검색은 계속 사용할 수 있어요." /> : null}
    {search.isWaiting || search.isFetching ? <View style={styles.inlineState}><ActivityIndicator /><Text style={styles.stateText}>등록된 상품과 음식점 지점을 함께 찾고 있어요</Text></View> : null}
    {search.isError ? <StateCard compact tone="danger" title="장소 검색을 불러오지 못했어요" text="등록된 상품 검색은 계속 사용할 수 있어요."
      action={{ label: '장소 다시 검색', disabled: search.isFetching, onPress: () => { if (!search.isFetching) void search.refetch(); } }} /> : null}
    {externalPlaceId && !UUID_PATTERN.test(externalPlaceId) ? <Text accessibilityRole="alert" style={styles.errorText}>장소 선택 링크가 올바르지 않아요. 다시 검색해주세요.</Text> : null}
    {selectPlace.isPending ? <View style={styles.inlineState}><ActivityIndicator /><Text style={styles.stateText}>선택한 장소를 원픽 항목으로 연결하고 있어요</Text></View> : null}
    {error ? <StateCard compact tone="danger" title="장소 선택을 이어가지 못했어요" text={selectionError(error)}
      action={externalPlaceId && UUID_PATTERN.test(externalPlaceId) ? { label: '선택한 장소 다시 연결', variant: 'secondary', onPress: () => void choosePlace(externalPlaceId, true) } : undefined} /> : null}
    {!search.isWaiting && !search.isError && entries.map((place) => <PlaceRow key={place.catalogId} place={place} disabled={selectPlace.isPending}
      onPress={() => void choosePlace(place.catalogId)} />)}
    {noResults && localItemCount === 0 ? <StateCard title="등록된 상품이나 장소를 찾지 못했어요" text="다른 상호명으로 다시 검색하거나, 온라인 상품이라면 입력한 이름으로 등록 요청할 수 있어요."
      action={{ label: '이 이름으로 상품 등록 요청', variant: 'secondary', onPress: onRequestItem }} /> : null}
  </View>;
}

function PlaceRow({ place, disabled, onPress }: { place: PlaceCatalogEntry; disabled: boolean; onPress: () => void }) {
  const address = place.roadAddress ?? place.address ?? [place.region1, place.region2].filter(Boolean).join(' ');
  const branch = place.branchName ? ` · ${place.branchName}` : '';
  return <Pressable accessibilityRole="button" accessibilityLabel={`${place.name}${branch} 장소 선택`} accessibilityState={{ disabled }} disabled={disabled}
    onPress={onPress} style={({ pressed }) => [styles.card, pressed && styles.pressed, disabled && styles.disabled]}>
    <View style={styles.pin}><Text style={styles.pinText}>⌖</Text></View>
    <View style={styles.copy}>
      <Text style={styles.category}>{[place.region1, place.region2, place.providerCategory].filter(Boolean).join(' · ') || '장소'}</Text>
      <Text style={styles.name}>{place.name}{branch}</Text>
      {address ? <Text style={styles.meta}>{address}</Text> : null}
      <Text style={styles.action}>이 지점을 원픽으로 선택 ›</Text>
    </View>
  </Pressable>;
}

const styles = StyleSheet.create({
  section: { gap: 11, marginTop: 11 },
  inlineState: { flexDirection: 'row', alignItems: 'center', gap: 9, paddingVertical: 7 },
  stateText: { color: OnePick.muted, fontSize: 12, lineHeight: 18 },
  errorText: { color: OnePick.danger, fontSize: 12, lineHeight: 18 },
  card: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: OnePick.border, backgroundColor: OnePick.surface, borderRadius: 20, padding: 12 },
  pin: { width: 72, height: 72, borderRadius: 16, backgroundColor: OnePick.accentSoft, alignItems: 'center', justifyContent: 'center' },
  pinText: { color: OnePick.accent, fontSize: 28, fontWeight: '800' },
  copy: { flex: 1, paddingLeft: 14 },
  category: { color: OnePick.accent, fontSize: 12, fontWeight: '800', letterSpacing: 0.3 },
  name: { color: OnePick.text, fontSize: 16, fontWeight: '800', marginTop: 5 },
  meta: { color: OnePick.muted, fontSize: 12, lineHeight: 18, marginTop: 4 },
  action: { color: OnePick.muted, fontSize: 12, marginTop: 7 },
  pressed: { opacity: 0.7 },
  disabled: { opacity: 0.5 },
});
