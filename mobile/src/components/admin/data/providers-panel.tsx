import { useEffect, useMemo, useState } from 'react';
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

  const domainCategories = useMemo(() => categories.map(toDomainCategory), [categories]);
  const eligibleCategories = useMemo(() => selectableCategories(domainCategories), [domainCategories]);
  const activeBrands = useMemo(() => brands.filter((brand) => brand.is_active), [brands]);

  const loadProviders = async () => {
    setError('');
    try {
      setProviders(await getOnlineProviders({ query }));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '온라인 판매처를 불러오지 못했습니다.');
    }
  };

  useEffect(() => {
    let active = true;
    setLoading(true);
    Promise.all([getOnlineProviders(), getCategories(), getBrands()])
      .then(([nextProviders, nextCategories, nextBrands]) => {
        if (!active) return;
        setProviders(nextProviders);
        setCategories(nextCategories);
        setBrands(nextBrands);
      })
      .catch((caught) => {
        if (active) setError(caught instanceof Error ? caught.message : '판매처 관리 데이터를 불러오지 못했습니다.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, []);

  const submit = async () => {
    if (!categoryId || creating) {
      if (!categoryId) setError('카테고리를 선택해 주세요.');
      return;
    }
    setCreating(true);
    setError('');
    setMessage('');
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
      setName('');
      setOfficialUrl('');
      setPlatform('');
      setStoreKey('');
      setCategoryId(null);
      setBrandId(null);
      setStoreType('official_site');
      setMessage('온라인 판매처와 카테고리 원픽 항목을 저장했습니다.');
      await loadProviders();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '온라인 판매처를 저장하지 못했습니다.');
    } finally {
      setCreating(false);
    }
  };

  const changeStatus = async (provider: AdminOnlineProvider, status: AdminProviderStatus) => {
    if (provider.status === status || busyId) return;
    setBusyId(provider.id);
    setError('');
    setMessage('');
    try {
      await setProviderStatus(provider.id, status);
      setMessage(`${provider.name} 상태를 변경했습니다.`);
      await loadProviders();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '판매처 상태를 변경하지 못했습니다.');
    } finally {
      setBusyId(null);
    }
  };

  const changeBrand = async (provider: AdminOnlineProvider, nextBrandId: string | null) => {
    if (provider.brand_id === nextBrandId || busyId) return;
    setBusyId(provider.id);
    setError('');
    setMessage('');
    try {
      await setProviderBrand(provider.id, nextBrandId);
      setMessage(`${provider.name} 브랜드 연결을 변경했습니다.`);
      await loadProviders();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '판매처 브랜드를 변경하지 못했습니다.');
    } finally {
      setBusyId(null);
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
            <TextInput accessibilityLabel="판매처 이름" value={name} onChangeText={setName} maxLength={100} placeholder="예: 성심당 공식몰" style={adminStyles.input} />
          </View>

          <View>
            <Text style={adminStyles.label}>판매처 유형</Text>
            <View style={adminStyles.row}>
              <Choice active={storeType === 'official_site'} label="공식 사이트" onPress={() => setStoreType('official_site')} />
              <Choice active={storeType === 'platform_store'} label="플랫폼 공식 스토어" onPress={() => setStoreType('platform_store')} />
            </View>
          </View>

          <View>
            <Text style={adminStyles.label}>공식 URL</Text>
            <TextInput accessibilityLabel="판매처 공식 URL" autoCapitalize="none" value={officialUrl} onChangeText={setOfficialUrl} placeholder="https://..." style={adminStyles.input} />
          </View>

          {storeType === 'platform_store' && (
            <View style={styles.twoColumns}>
              <View style={styles.flexField}>
                <Text style={adminStyles.label}>플랫폼 식별자</Text>
                <TextInput accessibilityLabel="플랫폼 식별자" autoCapitalize="none" value={platform} onChangeText={setPlatform} placeholder="예: smartstore" style={adminStyles.input} />
              </View>
              <View style={styles.flexField}>
                <Text style={adminStyles.label}>스토어 키</Text>
                <TextInput accessibilityLabel="스토어 키" autoCapitalize="none" value={storeKey} onChangeText={setStoreKey} placeholder="예: smartstore:merchant-id" style={adminStyles.input} />
              </View>
            </View>
          )}

          <View>
            <Text style={adminStyles.label}>첫 원픽 카테고리</Text>
            <View style={adminStyles.row}>
              {eligibleCategories.length === 0 && <Text style={adminStyles.muted}>선택 가능한 카테고리가 없습니다.</Text>}
              {eligibleCategories.map((category) => (
                <Choice
                  key={category.id}
                  active={categoryId === category.id}
                  label={categoryLabel(category, domainCategories)}
                  onPress={() => setCategoryId(category.id)}
                />
              ))}
            </View>
          </View>

          <View>
            <Text style={adminStyles.label}>브랜드 · 선택 사항</Text>
            <View style={adminStyles.row}>
              <Choice active={!brandId} label="미지정" onPress={() => setBrandId(null)} />
              {activeBrands.map((brand) => (
                <Choice key={brand.id} active={brandId === brand.id} label={brand.name} onPress={() => setBrandId(brand.id)} />
              ))}
            </View>
          </View>

          <View style={styles.actions}>
            <Pressable disabled={creating} onPress={submit} style={[adminStyles.primaryButton, creating && styles.disabled]}>
              <Text style={adminStyles.primaryButtonText}>{creating ? '저장 중' : '판매처 등록'}</Text>
            </Pressable>
          </View>
        </View>
      </View>

      {!!error && <Text accessibilityRole="alert" style={adminStyles.error}>{error}</Text>}
      {!!message && <Text accessibilityLiveRegion="polite" style={adminStyles.success}>{message}</Text>}

      <View style={styles.toolbar}>
        <TextInput
          accessibilityLabel="판매처 검색"
          value={query}
          onChangeText={setQuery}
          onSubmitEditing={loadProviders}
          placeholder="판매처 이름 검색"
          style={[adminStyles.input, styles.search]}
        />
        <Pressable disabled={loading} onPress={loadProviders} style={adminStyles.secondaryButton}>
          <Text style={adminStyles.secondaryButtonText}>검색</Text>
        </Pressable>
      </View>

      <View style={adminStyles.card}>
        <Text style={adminStyles.sectionTitle}>온라인 판매처 · {providers.length}</Text>
        {loading && <View style={styles.loading}><ActivityIndicator /><Text style={adminStyles.muted}>불러오는 중...</Text></View>}
        {!loading && providers.length === 0 && <Text style={styles.empty}>조건에 맞는 온라인 판매처가 없습니다.</Text>}
        {!loading && providers.map((provider) => (
          <View key={provider.id} style={styles.providerRow}>
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
                  disabled={busyId === provider.id}
                  label={status.label}
                  onPress={() => changeStatus(provider, status.value)}
                />
              ))}
            </View>

            <Text style={[adminStyles.label, styles.brandLabel]}>브랜드 연결</Text>
            <View style={adminStyles.row}>
              <Choice active={!provider.brand_id} disabled={busyId === provider.id} label="미지정" onPress={() => changeBrand(provider, null)} />
              {activeBrands.map((brand) => (
                <Choice
                  key={brand.id}
                  active={provider.brand_id === brand.id}
                  disabled={busyId === provider.id}
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
    <Pressable disabled={disabled} onPress={onPress} style={[styles.choice, active && styles.choiceActive, disabled && styles.disabled]}>
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
