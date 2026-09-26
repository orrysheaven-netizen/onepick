import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { adminStyles } from '@/components/admin/admin-shell';
import { getUnlinkedItems, linkItemToOnlineProvider, linkItemToPlace, searchPlaceCatalogForItem } from '@/lib/admin-api';
import type { AdminPlaceCatalogMatch, AdminUnlinkedItem } from '@/lib/admin-api';
import { PLACE_COVERAGE_NOTICE } from '@/lib/items/pickChannel';
import { OnePick } from '@/constants/onepick';

type Mode = 'place' | 'online';

function linkErrorMessage(caught: unknown, fallback: string) {
  const message = caught instanceof Error ? caught.message : '';
  if (message.includes('PLACE_ALREADY_LINKED')) return '이 장소에는 같은 카테고리의 원픽 항목이 이미 있습니다. 다른 지점을 고르거나 그대로 두세요.';
  if (message.includes('PROVIDER_ALREADY_LINKED')) return '이 판매처에는 같은 카테고리의 원픽 항목이 이미 있습니다.';
  if (message.includes('ITEM_ALREADY_LINKED')) return '이미 매장 또는 온라인에 연결된 항목입니다. 목록을 새로고침해 주세요.';
  if (message.includes('ITEM_PROVIDER_BRAND_CONFLICT')) return '브랜드가 지정된 항목은 판매처에 연결할 수 없습니다. 상품 탭에서 브랜드를 먼저 비워 주세요.';
  if (message.includes('online_stores_not_delivery_app')) return '배달앱 링크는 온라인 판매처가 될 수 없습니다. 배달은 매장으로 연결해 주세요.';
  if (message.includes('ONLINE_STORE_PLATFORM_HOST_INVALID')) return '플랫폼 스토어로 인정되는 쇼핑 주소가 아닙니다. 공식몰로 등록해 주세요.';
  if (message.includes('ONLINE_STORE_URL_INVALID')) return 'https:// 로 시작하는 올바른 주소를 입력해 주세요.';
  if (message.includes('ITEM_NOT_ELIGIBLE')) return '이 장소는 지금 연결할 수 없습니다. 다른 지점을 골라 주세요.';
  return message || fallback;
}

function placeLabel(place: AdminPlaceCatalogMatch) {
  return `${place.name}${place.branch_name ? ` ${place.branch_name}` : ''}`;
}

export function ChannelLinkPanel() {
  const [items, setItems] = useState<AdminUnlinkedItem[]>([]);
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [mode, setMode] = useState<Mode>('place');
  const [placeQuery, setPlaceQuery] = useState('');
  const [places, setPlaces] = useState<AdminPlaceCatalogMatch[] | null>(null);
  const [placeSearching, setPlaceSearching] = useState(false);
  const [sellerName, setSellerName] = useState('');
  const [sellerUrl, setSellerUrl] = useState('');
  const [storeType, setStoreType] = useState<'official_site' | 'platform_store'>('official_site');
  const [platform, setPlatform] = useState('');
  const [storeKey, setStoreKey] = useState('');
  const [linking, setLinking] = useState(false);

  const load = async (keyword = query) => {
    setLoading(true);
    setError('');
    try {
      const result = await getUnlinkedItems(keyword);
      setItems(result);
      setSelectedId((current) => current && result.some((item) => item.item_id === current) ? current : result[0]?.item_id ?? null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '연결할 항목을 불러오지 못했습니다.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load('');
  }, []);

  const selected = items.find((item) => item.item_id === selectedId) ?? null;

  useEffect(() => {
    setMode(selected?.uses_place_catalog ? 'place' : 'online');
    setPlaceQuery(selected?.item_name ?? '');
    setPlaces(null);
    setSellerName(selected?.item_name ?? '');
    setSellerUrl('');
    setStoreType('official_site');
    setPlatform('');
    setStoreKey('');
  }, [selectedId]);

  const removeSelected = (resultMessage: string) => {
    if (!selected) return;
    const remaining = items.filter((item) => item.item_id !== selected.item_id);
    setItems(remaining);
    setSelectedId(remaining[0]?.item_id ?? null);
    setMessage(`${selected.item_name} ${resultMessage}`);
  };

  const searchPlaces = async () => {
    if (!selected || placeSearching) return;
    if (placeQuery.trim().replace(/\s+/g, '').length < 2) {
      setError('가게 이름을 두 글자 이상 입력해 주세요.');
      return;
    }
    setPlaceSearching(true);
    setError('');
    try {
      setPlaces(await searchPlaceCatalogForItem(selected.category_id, placeQuery));
    } catch (caught) {
      setError(linkErrorMessage(caught, '장소를 검색하지 못했습니다.'));
    } finally {
      setPlaceSearching(false);
    }
  };

  const linkPlace = async (place: AdminPlaceCatalogMatch) => {
    if (!selected || linking) return;
    if (!window.confirm(`${selected.item_name} 항목을 매장 "${placeLabel(place)}"에 연결하시겠습니까? 기존 원픽은 그대로 유지되고, 연결은 되돌릴 수 없습니다.`)) return;
    setLinking(true);
    setError('');
    setMessage('');
    try {
      await linkItemToPlace(selected.item_id, place.catalog_id);
      removeSelected(`항목을 매장 ${placeLabel(place)}에 연결했습니다. 홈의 매장 탭에 표시됩니다.`);
    } catch (caught) {
      setError(linkErrorMessage(caught, '매장에 연결하지 못했습니다.'));
    } finally {
      setLinking(false);
    }
  };

  const canLinkOnline = !linking && Boolean(sellerName.trim()) && Boolean(sellerUrl.trim());
  const linkOnline = async () => {
    if (!selected || !canLinkOnline) return;
    if (!window.confirm(`${selected.item_name} 항목을 온라인 판매처 "${sellerName.trim()}"에 연결하시겠습니까? 기존 원픽은 그대로 유지되고, 연결은 되돌릴 수 없습니다.`)) return;
    setLinking(true);
    setError('');
    setMessage('');
    try {
      await linkItemToOnlineProvider({
        itemId: selected.item_id,
        name: sellerName,
        storeType,
        officialUrl: sellerUrl,
        platform: storeType === 'platform_store' ? platform : null,
        storeKey: storeType === 'platform_store' ? storeKey : null,
      });
      removeSelected('항목을 온라인 판매처에 연결했습니다. 홈의 온라인 탭에 표시됩니다.');
    } catch (caught) {
      setError(linkErrorMessage(caught, '온라인 판매처에 연결하지 못했습니다.'));
    } finally {
      setLinking(false);
    }
  };

  return (
    <View style={styles.page}>
      <View style={styles.header}>
        <TextInput
          accessibilityLabel="연결할 항목 검색"
          value={query}
          onChangeText={setQuery}
          onSubmitEditing={() => load()}
          placeholder="항목 이름 검색"
          style={[adminStyles.input, styles.search]}
        />
        <Pressable disabled={loading} onPress={() => load()} style={adminStyles.secondaryButton}>
          <Text style={adminStyles.secondaryButtonText}>{loading ? '불러오는 중' : '검색·새로고침'}</Text>
        </Pressable>
      </View>

      {!!error && <Text accessibilityRole="alert" style={adminStyles.error}>{error}</Text>}
      {!!message && <Text accessibilityLiveRegion="polite" style={adminStyles.success}>{message}</Text>}

      <View style={styles.workspace}>
        <View style={[adminStyles.card, styles.listPanel]}>
          <View style={styles.panelHeader}>
            <Text style={adminStyles.sectionTitle}>연결 안 된 음식 항목 · {items.length}</Text>
            {loading && <ActivityIndicator size="small" />}
          </View>
          <Text style={styles.note}>원픽이 많은 항목부터 보여줍니다.</Text>
          {!loading && items.length === 0 && <Text style={styles.empty}>연결할 항목이 없습니다.</Text>}
          {items.map((item) => (
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ selected: selectedId === item.item_id }}
              key={item.item_id}
              onPress={() => setSelectedId(item.item_id)}
              style={[styles.itemRow, selectedId === item.item_id && styles.itemRowSelected]}
            >
              <View style={styles.itemBody}>
                <Text style={styles.itemName}>{item.item_name}</Text>
                <Text style={adminStyles.muted}>{item.category_path} · 원픽 {item.pick_count}</Text>
              </View>
              <Text style={item.uses_place_catalog ? styles.placeBadge : styles.onlineBadge}>{item.uses_place_catalog ? '매장·온라인' : '온라인만'}</Text>
            </Pressable>
          ))}
        </View>

        <View style={[adminStyles.card, styles.detailPanel]}>
          <Text style={adminStyles.sectionTitle}>채널 연결</Text>
          {!selected && <Text style={styles.empty}>왼쪽에서 항목을 선택해 주세요.</Text>}
          {selected && (
            <View style={styles.detailBody}>
              <View>
                <Text style={styles.detailName}>{selected.item_name}</Text>
                <Text style={[adminStyles.muted, { marginTop: 6 }]}>{selected.category_path} · 원픽 {selected.pick_count}</Text>
              </View>

              <View style={styles.choices}>
                {(['place', 'online'] as const).map((option) => {
                  const disabled = option === 'place' && !selected.uses_place_catalog;
                  return <Pressable key={option} accessibilityRole="button" accessibilityState={{ selected: mode === option, disabled }}
                    disabled={disabled} onPress={() => setMode(option)}
                    style={[styles.choice, mode === option && styles.choiceSelected, disabled && { opacity: 0.4 }]}>
                    <Text style={[styles.choiceText, mode === option && styles.choiceTextSelected]}>{option === 'place' ? '매장 연결' : '온라인 연결'}</Text>
                  </Pressable>;
                })}
              </View>
              {!selected.uses_place_catalog && <Text style={styles.note}>이 카테고리는 장소 검색을 쓰지 않아 온라인 판매처로만 연결할 수 있습니다.</Text>}

              {mode === 'place' ? <View style={styles.box}>
                <Text style={styles.boxTitle}>매장(장소) 검색</Text>
                <Text style={styles.note}>매장에서 먹거나 배달로 주문하는 가게입니다. 원픽 장소 데이터에서 같은 가게·지점을 찾아 연결합니다. {PLACE_COVERAGE_NOTICE}</Text>
                <View style={styles.row}>
                  <TextInput accessibilityLabel="장소 검색" value={placeQuery} onChangeText={setPlaceQuery} onSubmitEditing={searchPlaces}
                    editable={!linking} placeholder="가게 이름" style={[adminStyles.input, styles.grow]} />
                  <Pressable disabled={placeSearching || linking} onPress={searchPlaces} style={adminStyles.secondaryButton}>
                    <Text style={adminStyles.secondaryButtonText}>{placeSearching ? '검색 중' : '장소 검색'}</Text>
                  </Pressable>
                </View>
                {places?.length === 0 && <Text style={styles.empty}>일치하는 장소가 없습니다. 이름이나 지점명을 바꿔 검색해 주세요.</Text>}
                {places?.map((place) => (
                  <View key={place.catalog_id} style={styles.candidateRow}>
                    <View style={styles.itemBody}>
                      <Text style={styles.candidateName}>{placeLabel(place)}</Text>
                      <Text style={adminStyles.muted}>{place.road_address ?? place.address ?? '주소 없음'}</Text>
                      {place.existing_item_id ? <Text style={styles.warning}>이미 이 카테고리의 원픽 항목이 연결된 장소입니다.</Text> : null}
                    </View>
                    <Pressable accessibilityRole="button" accessibilityLabel={`${placeLabel(place)}에 연결`}
                      disabled={linking || Boolean(place.existing_item_id)} onPress={() => linkPlace(place)}
                      style={[adminStyles.secondaryButton, (linking || place.existing_item_id) && { opacity: 0.4 }]}>
                      <Text style={adminStyles.secondaryButtonText}>{linking ? '연결 중' : '이 장소에 연결'}</Text>
                    </Pressable>
                  </View>
                ))}
              </View> : <View style={styles.box}>
                <Text style={styles.boxTitle}>온라인 판매처</Text>
                <Text style={styles.note}>택배·온라인몰로 주문하는 곳입니다. 배달앱 링크는 매장으로 연결해 주세요.</Text>
                <TextInput accessibilityLabel="온라인 판매처 이름" value={sellerName} onChangeText={setSellerName} editable={!linking}
                  placeholder="판매처 이름" style={adminStyles.input} />
                <TextInput accessibilityLabel="온라인 판매처 URL" value={sellerUrl} onChangeText={setSellerUrl} editable={!linking}
                  autoCapitalize="none" placeholder="https://…" style={adminStyles.input} />
                <View style={styles.choices}>
                  {(['official_site', 'platform_store'] as const).map((type) => (
                    <Pressable key={type} accessibilityRole="button" accessibilityState={{ selected: storeType === type }}
                      onPress={() => setStoreType(type)} style={[styles.choice, storeType === type && styles.choiceSelected]}>
                      <Text style={[styles.choiceText, storeType === type && styles.choiceTextSelected]}>{type === 'official_site' ? '공식몰' : '플랫폼 스토어'}</Text>
                    </Pressable>
                  ))}
                </View>
                {storeType === 'platform_store' ? <View style={styles.row}>
                  <TextInput accessibilityLabel="플랫폼 식별자" value={platform} onChangeText={setPlatform} editable={!linking}
                    autoCapitalize="none" placeholder="예: smartstore" style={[adminStyles.input, styles.grow]} />
                  <TextInput accessibilityLabel="스토어 키" value={storeKey} onChangeText={setStoreKey} editable={!linking}
                    autoCapitalize="none" placeholder="예: smartstore:gomtang" style={[adminStyles.input, styles.grow]} />
                </View> : null}
                <Pressable accessibilityRole="button" accessibilityState={{ disabled: !canLinkOnline }} disabled={!canLinkOnline} onPress={linkOnline}
                  style={[adminStyles.primaryButton, !canLinkOnline && { opacity: 0.5 }]}>
                  <Text style={adminStyles.primaryButtonText}>{linking ? '연결 중' : '온라인 판매처에 연결'}</Text>
                </Pressable>
              </View>}
            </View>
          )}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { gap: 22 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, flexWrap: 'wrap' },
  search: { flexGrow: 1, flexBasis: 280, maxWidth: 420 },
  workspace: { flexDirection: 'row', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' },
  listPanel: { flexGrow: 1, flexBasis: 440, minWidth: 300 },
  detailPanel: { flexGrow: 1, flexBasis: 420, minWidth: 300 },
  panelHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 },
  empty: { color: OnePick.hint, fontSize: 13, paddingVertical: 18 },
  note: { color: OnePick.muted, fontSize: 12, lineHeight: 19 },
  warning: { color: OnePick.warning, fontSize: 12, marginTop: 4 },
  itemRow: { minHeight: 64, borderTopWidth: 1, borderTopColor: OnePick.sunken, paddingVertical: 12, paddingHorizontal: 8, flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 8 },
  itemRowSelected: { backgroundColor: OnePick.sunken },
  itemBody: { flex: 1, minWidth: 0 },
  itemName: { color: OnePick.text, fontSize: 14, fontWeight: '700', marginBottom: 5 },
  placeBadge: { color: OnePick.accentDeep, backgroundColor: OnePick.accentSoft, borderRadius: 14, paddingHorizontal: 9, paddingVertical: 5, fontSize: 11, fontWeight: '700' },
  onlineBadge: { color: OnePick.muted, backgroundColor: OnePick.sunken, borderRadius: 14, paddingHorizontal: 9, paddingVertical: 5, fontSize: 11, fontWeight: '700' },
  detailBody: { marginTop: 16, gap: 16 },
  detailName: { color: OnePick.text, fontSize: 21, fontWeight: '800' },
  choices: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  choice: { borderWidth: 1, borderColor: OnePick.border, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8, backgroundColor: OnePick.surface },
  choiceSelected: { borderColor: OnePick.accent, backgroundColor: OnePick.accentSoft },
  choiceText: { color: OnePick.muted, fontSize: 12, fontWeight: '700' },
  choiceTextSelected: { color: OnePick.accent },
  box: { gap: 10, borderWidth: 1, borderColor: OnePick.border, borderRadius: 10, padding: 14, backgroundColor: OnePick.surface },
  boxTitle: { color: OnePick.text, fontSize: 14, fontWeight: '700' },
  row: { flexDirection: 'row', gap: 8, flexWrap: 'wrap', alignItems: 'center' },
  grow: { flexGrow: 1, flexBasis: 200 },
  candidateRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: OnePick.sunken },
  candidateName: { color: OnePick.text, fontSize: 13, fontWeight: '700', marginBottom: 3 },
});
