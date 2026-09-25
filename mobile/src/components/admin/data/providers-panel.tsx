import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { adminStyles } from '@/components/admin/admin-shell';
import {
  createOnlineProvider,
  getBrands,
  getCategories,
  getOnlineProviders,
  setProviderBrand,
  setProviderStatus,
} from '@/lib/admin-api';
import type {
  AdminBrand,
  AdminCategory,
  AdminOnlineProvider,
  AdminProviderStatus,
} from '@/lib/admin-api';
import { categoryLabel, selectableCategories } from '@/lib/categories/categoryTree';
import type { Category } from '@/types/domain/category';
import { OnePick } from '@/constants/onepick';

function toDomainCategory(category: AdminCategory): Category {
  return {
    id: category.id,
    parentId: category.parent_id,
    name: category.name,
    slug: category.slug,
    status: category.status,
    isVisible: category.is_visible,
    isPickable: category.is_pickable,
    rankingMinSample: category.ranking_min_sample,
    maxPicks: category.max_picks,
    sortOrder: category.sort_order,
    imageUrl: category.image_url,
    createdAt: '',
    updatedAt: '',
  };
}

const STATUSES: Array<{ value: AdminProviderStatus; label: string }> = [
  { value: 'active', label: '활성' },
  { value: 'pending', label: '대기' },
  { value: 'hidden', label: '숨김' },
];

export function ProvidersPanel() {
  const [providers, setProviders] = useState<AdminOnlineProvider[]>([]);
  const [categories, setCategories] = useState<AdminCategory[]>([]);
  const [brands, setBrands] = useState<AdminBrand[]>([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [initialized, setInitialized] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [listError, setListError] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [reloadVersion, setReloadVersion] = useState(0);
  const mounted = useRef(false);
  const listRequest = useRef(0);
  const mutationPending = useRef(false);
  const queryRef = useRef('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const [name, setName] = useState('');
  const [officialUrl, setOfficialUrl] = useState('');
  const [storeType, setStoreType] = useState<'official_site' | 'platform_store'>('official_site');
  const [platform, setPlatform] = useState('');
  const [storeKey, setStoreKey] = useState('');
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [brandId, setBrandId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const mutating = creating || busyId !== null;
  const actionsDisabled = !initialized || loading || mutating;

  const domainCategories = useMemo(() => categories.map(toDomainCategory), [categories]);
  const eligibleCategories = useMemo(() => selectableCategories(domainCategories), [domainCategories]);
  const activeBrands = useMemo(() => brands.filter((brand) => brand.is_active), [brands]);

  // Only the newest read may publish results, including reads started before a
  // write. A completed write is never retried merely because its refresh failed.
  const loadProviders = async (afterWrite = false) => {
    const request = ++listRequest.current;
    setRefreshing(true);
    setListError('');
    try {
      const nextProviders = await getOnlineProviders({ query: queryRef.current });
      if (mounted.current && request === listRequest.current) setProviders(nextProviders);
    } catch (caught) {
      if (mounted.current && request === listRequest.current) {
        setListError(afterWrite
          ? '변경은 저장되었습니다. 목록 조회에 실패했습니다. 목록만 다시 불러와 주세요.'
          : caught instanceof Error ? caught.message : '온라인 판매처를 불러오지 못했습니다.');
      }
    } finally {
      if (mounted.current && request === listRequest.current) setRefreshing(false);
    }
  };

  const searchProviders = () => {
    if (!mounted.current || !initialized || loading || mutationPending.current) return;
    return loadProviders();
  };

  useEffect(() => {
    let active = true;
    mounted.current = true;
    const request = ++listRequest.current;
    setLoading(true);
    setInitialized(false);
    setLoadError('');
    setListError('');
    Promise.all([getOnlineProviders({ query: queryRef.current }), getCategories(), getBrands()])
      .then(([nextProviders, nextCategories, nextBrands]) => {
        if (!active || request !== listRequest.current) return;
        setProviders(nextProviders);
        setCategories(nextCategories);
        setBrands(nextBrands);
        setInitialized(true);
      })
      .catch((caught) => {
        if (active) setLoadError(caught instanceof Error ? caught.message : '판매처 관리 데이터를 불러오지 못했습니다.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
      mounted.current = false;
      ++listRequest.current;
    };
  }, [reloadVersion]);

  const beginMutation = () => {
    // State alone does not block two presses within the same React render.
    if (!mounted.current || !initialized || loading || mutationPending.current) return false;
    mutationPending.current = true;
    ++listRequest.current;
    setRefreshing(false);
    setListError('');
    setError('');
    setMessage('');
    return true;
  };

  const finishMutation = () => {
    mutationPending.current = false;
    if (mounted.current) {
      setCreating(false);
      setBusyId(null);
    }
  };

  const submit = async () => {
    if (!categoryId || mutationPending.current) {
      if (!categoryId) setError('카테고리를 선택해 주세요.');
      return;
    }
    if (!beginMutation()) return;
    setCreating(true);
    try {
      await createOnlineProvider({
        categoryId,
        name,
        storeType,
        officialUrl,
        platform: storeType === 'platform_store' ? platform : null,
        storeKey: storeType === 'platform_store' ? storeKey : null,
        brandId,
      });
      if (!mounted.current) return;
      setName('');
      setOfficialUrl('');
      setPlatform('');
      setStoreKey('');
      setCategoryId(null);
      setBrandId(null);
      setStoreType('official_site');
      setMessage('온라인 판매처와 카테고리 원픽 항목을 저장했습니다.');
      await loadProviders(true);
    } catch (caught) {
      if (mounted.current) setError(caught instanceof Error ? caught.message : '온라인 판매처를 저장하지 못했습니다.');
    } finally {
      finishMutation();
    }
  };

  const changeStatus = async (provider: AdminOnlineProvider, status: AdminProviderStatus) => {
    if (provider.status === status || !beginMutation()) return;
    setBusyId(provider.id);
    try {
      await setProviderStatus(provider.id, status);
      if (!mounted.current) return;
      setProviders((current) => current.map((row) => row.id === provider.id ? { ...row, status } : row));
      setMessage(`${provider.name} 상태를 변경했습니다.`);
      await loadProviders(true);
    } catch (caught) {
      if (mounted.current) setError(caught instanceof Error ? caught.message : '판매처 상태를 변경하지 못했습니다.');
    } finally {
      finishMutation();
    }
  };

  const changeBrand = async (provider: AdminOnlineProvider, nextBrandId: string | null) => {
    if (provider.brand_id === nextBrandId || !beginMutation()) return;
    setBusyId(provider.id);
    try {
      await setProviderBrand(provider.id, nextBrandId);
      if (!mounted.current) return;
      const nextBrand = brands.find((brand) => brand.id === nextBrandId);
      setProviders((current) => current.map((row) => row.id === provider.id
        ? { ...row, brand_id: nextBrandId, brand: nextBrand ? { name: nextBrand.name } : null }
        : row));
      setMessage(`${provider.name} 브랜드 연결을 변경했습니다.`);
      await loadProviders(true);
    } catch (caught) {
      if (mounted.current) setError(caught instanceof Error ? caught.message : '판매처 브랜드를 변경하지 못했습니다.');
    } finally {
      finishMutation();
    }
  };

  return (
    <View style={styles.page}>
      <View style={adminStyles.card}>
        <Text style={adminStyles.sectionTitle}>온라인 판매처 등록</Text>
        <Text style={styles.help}>
          브랜드 공식몰·생산자 직영몰·공식 플랫폼 스토어만 등록합니다. 저장 시 판매처, provider, 선택 카테고리 item과 온라인 채널이 한 번에 생성됩니다.
        </Text>

        <View style={styles.form}>
          <View>
            <Text style={adminStyles.label}>판매처 이름</Text>
            <TextInput accessibilityLabel="판매처 이름" editable={!mutating} value={name} onChangeText={setName} maxLength={100} placeholder="예: 성심당 공식몰" style={adminStyles.input} />
          </View>

          <View>
            <Text style={adminStyles.label}>판매처 유형</Text>
            <View style={adminStyles.row}>
              <Choice active={storeType === 'official_site'} disabled={mutating} label="공식 사이트" onPress={() => setStoreType('official_site')} />
              <Choice active={storeType === 'platform_store'} disabled={mutating} label="플랫폼 공식 스토어" onPress={() => setStoreType('platform_store')} />
            </View>
          </View>

          <View>
            <Text style={adminStyles.label}>공식 URL</Text>
            <TextInput accessibilityLabel="판매처 공식 URL" editable={!mutating} autoCapitalize="none" value={officialUrl} onChangeText={setOfficialUrl} placeholder="https://..." style={adminStyles.input} />
          </View>

          {storeType === 'platform_store' && (
            <View style={styles.twoColumns}>
              <View style={styles.flexField}>
                <Text style={adminStyles.label}>플랫폼 식별자</Text>
                <TextInput accessibilityLabel="플랫폼 식별자" editable={!mutating} autoCapitalize="none" value={platform} onChangeText={setPlatform} placeholder="예: smartstore" style={adminStyles.input} />
              </View>
              <View style={styles.flexField}>
                <Text style={adminStyles.label}>스토어 키</Text>
                <TextInput accessibilityLabel="스토어 키" editable={!mutating} autoCapitalize="none" value={storeKey} onChangeText={setStoreKey} placeholder="예: smartstore:merchant-id" style={adminStyles.input} />
              </View>
            </View>
          )}

          <View>
            <Text style={adminStyles.label}>첫 원픽 카테고리</Text>
            <View style={adminStyles.row}>
              {initialized && eligibleCategories.length === 0 && <Text style={adminStyles.muted}>선택 가능한 카테고리가 없습니다.</Text>}
              {eligibleCategories.map((category) => (
                <Choice
                  key={category.id}
                  active={categoryId === category.id}
                  disabled={actionsDisabled}
                  label={categoryLabel(category, domainCategories)}
                  onPress={() => setCategoryId(category.id)}
                />
              ))}
            </View>
          </View>

          <View>
            <Text style={adminStyles.label}>브랜드 · 선택 사항</Text>
            <View style={adminStyles.row}>
              <Choice active={!brandId} disabled={actionsDisabled} label="미지정" onPress={() => setBrandId(null)} />
              {activeBrands.map((brand) => (
                <Choice key={brand.id} active={brandId === brand.id} disabled={actionsDisabled} label={brand.name} onPress={() => setBrandId(brand.id)} />
              ))}
            </View>
          </View>

          <View style={styles.actions}>
            <Pressable accessibilityRole="button" disabled={actionsDisabled} onPress={submit} style={[adminStyles.primaryButton, actionsDisabled && styles.disabled]}>
              <Text style={adminStyles.primaryButtonText}>{creating ? '저장 중' : '판매처 등록'}</Text>
            </Pressable>
          </View>
        </View>
      </View>

      {!!loadError && (
        <View style={styles.form}>
          <Text accessibilityRole="alert" style={adminStyles.error}>{loadError}</Text>
          <Pressable accessibilityRole="button" disabled={loading || mutating} onPress={() => setReloadVersion((version) => version + 1)} style={adminStyles.secondaryButton}>
            <Text style={adminStyles.secondaryButtonText}>판매처 관리 다시 불러오기</Text>
          </Pressable>
        </View>
      )}
      {!!error && <Text accessibilityRole="alert" style={adminStyles.error}>{error}</Text>}
      {!!message && <Text accessibilityLiveRegion="polite" style={adminStyles.success}>{message}</Text>}

      <View style={styles.toolbar}>
        <TextInput
          accessibilityLabel="판매처 검색"
          value={query}
          editable={!mutating}
          onChangeText={(value) => { queryRef.current = value; setQuery(value); }}
          onSubmitEditing={searchProviders}
          placeholder="판매처 이름 검색"
          style={[adminStyles.input, styles.search]}
        />
        <Pressable accessibilityRole="button" disabled={actionsDisabled} onPress={searchProviders} style={adminStyles.secondaryButton}>
          <Text style={adminStyles.secondaryButtonText}>검색</Text>
        </Pressable>
      </View>

      {!!listError && (
        <View style={styles.form}>
          <Text accessibilityRole="alert" style={adminStyles.error}>{listError}</Text>
          <Pressable accessibilityRole="button" disabled={actionsDisabled || refreshing} onPress={searchProviders} style={adminStyles.secondaryButton}>
            <Text style={adminStyles.secondaryButtonText}>목록 다시 불러오기</Text>
          </Pressable>
        </View>
      )}

      <View style={adminStyles.card}>
        <Text style={adminStyles.sectionTitle}>온라인 판매처 · {providers.length}</Text>
        {(loading || refreshing) && <View style={styles.loading}><ActivityIndicator /><Text style={adminStyles.muted}>불러오는 중...</Text></View>}
        {initialized && !loading && !refreshing && !listError && providers.length === 0 && <Text style={styles.empty}>조건에 맞는 온라인 판매처가 없습니다.</Text>}
        {initialized && !loading && providers.map((provider) => (
          <View key={provider.id} testID={`provider-${provider.id}`} style={styles.providerRow}>
            <View style={styles.providerHeading}>
              <View style={styles.providerCopy}>
                <Text style={styles.providerName}>{provider.name}</Text>
                <Text style={styles.meta}>{provider.store?.host ?? '스토어 정보 없음'} · {provider.brand?.name ?? '브랜드 미지정'}</Text>
                {!!provider.store?.official_url && <Text numberOfLines={1} style={styles.url}>{provider.store.official_url}</Text>}
              </View>
              <Text style={styles.storeType}>{provider.store?.store_type === 'platform_store' ? '플랫폼 스토어' : '공식 사이트'}</Text>
            </View>

            <Text style={adminStyles.label}>상태</Text>
            <View style={adminStyles.row}>
              {STATUSES.map((status) => (
                <Choice
                  key={status.value}
                  active={provider.status === status.value}
                  disabled={actionsDisabled}
                  label={status.label}
                  onPress={() => changeStatus(provider, status.value)}
                />
              ))}
            </View>

            <Text style={[adminStyles.label, styles.brandLabel]}>브랜드 연결</Text>
            <View style={adminStyles.row}>
              <Choice active={!provider.brand_id} disabled={actionsDisabled} label="미지정" onPress={() => changeBrand(provider, null)} />
              {activeBrands.map((brand) => (
                <Choice
                  key={brand.id}
                  active={provider.brand_id === brand.id}
                  disabled={actionsDisabled}
                  label={brand.name}
                  onPress={() => changeBrand(provider, brand.id)}
                />
              ))}
            </View>
          </View>
        ))}
      </View>
    </View>
  );
}

function Choice({ active, disabled = false, label, onPress }: { active: boolean; disabled?: boolean; label: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityState={{ selected: active, disabled }} disabled={disabled} onPress={onPress} style={[styles.choice, active && styles.choiceActive, disabled && styles.disabled]}>
      <Text style={[styles.choiceText, active && styles.choiceTextActive]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  page: { gap: 20 },
  help: { marginTop: 6, color: OnePick.muted, fontSize: 13, lineHeight: 20 },
  form: { marginTop: 16, gap: 16 },
  twoColumns: { flexDirection: 'row', gap: 12, flexWrap: 'wrap' },
  flexField: { flexGrow: 1, flexBasis: 240 },
  actions: { alignItems: 'flex-start' },
  toolbar: { flexDirection: 'row', gap: 10, flexWrap: 'wrap' },
  search: { flexGrow: 1, flexBasis: 260 },
  loading: { minHeight: 100, alignItems: 'center', justifyContent: 'center', gap: 10 },
  empty: { color: OnePick.hint, fontSize: 13, paddingVertical: 28 },
  providerRow: { borderTopWidth: 1, borderTopColor: OnePick.sunken, paddingVertical: 18, gap: 9 },
  providerHeading: { flexDirection: 'row', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'flex-start' },
  providerCopy: { flexGrow: 1, flexBasis: 260 },
  providerName: { color: OnePick.text, fontSize: 15, fontWeight: '800' },
  meta: { marginTop: 4, color: OnePick.muted, fontSize: 12 },
  url: { marginTop: 3, color: OnePick.hint, fontSize: 11 },
  storeType: { color: OnePick.muted, fontSize: 11, fontWeight: '700' },
  brandLabel: { marginTop: 4 },
  choice: { minHeight: 34, justifyContent: 'center', paddingHorizontal: 12, borderRadius: 17, borderWidth: 1, borderColor: OnePick.border, backgroundColor: OnePick.surface },
  choiceActive: { backgroundColor: OnePick.text, borderColor: OnePick.text },
  choiceText: { color: OnePick.muted, fontSize: 12, fontWeight: '700' },
  choiceTextActive: { color: OnePick.onAccent },
  disabled: { opacity: 0.5 },
});
