import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { adminStyles } from '@/components/admin/admin-shell';
import { AdminBrandPicker } from '@/components/admin/brand-picker';
import { AdminCategoryPicker } from '@/components/admin/category-picker';
import { ADMIN_PAGE_SIZE, createItem, createItemAlias, deleteItemAlias, getBrands, getCategories, getItemAliases, getItemEditorialFeature, getItems, moveItemCategory, previewItemCategoryMove, setItemEditorialFeature, updateItem, updateItemAlias } from '@/lib/admin-api';
import type { AdminBrand, AdminCategory, AdminItem, AdminItemAlias, AdminItemCategoryMove, AdminItemStatus } from '@/lib/admin-api';
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

const FILTERS: Array<{ value: AdminItemStatus | 'all'; label: string }> = [
  { value: 'all', label: '전체' },
  { value: 'active', label: '활성' },
  { value: 'pending', label: '대기' },
  { value: 'discontinued', label: '단종' },
  { value: 'hidden', label: '숨김' },
  { value: 'rejected', label: '반려' },
  { value: 'merged', label: '병합' },
];

const EDITABLE_STATUSES: AdminItemStatus[] = ['active', 'discontinued', 'hidden', 'rejected'];

export function ItemsPanel() {
  const [items, setItems] = useState<AdminItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<AdminItemStatus | 'all'>('all');
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [showCreate, setShowCreate] = useState(false);

  const load = async (nextStatus = status) => {
    setLoading(true);
    setError('');
    try {
      const result = await getItems({ query, status: nextStatus });
      setItems(result);
      setHasMore(result.length === ADMIN_PAGE_SIZE);
      setSelectedId((current) => current && result.some((item) => item.id === current) ? current : result[0]?.id ?? null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '상품을 불러오지 못했습니다.');
    } finally {
      setLoading(false);
    }
  };

  const loadMore = async () => {
    if (loadingMore || !hasMore) return;
    setLoadingMore(true);
    setError('');
    try {
      const result = await getItems({ query, status, offset: items.length });
      setItems((current) => [...current, ...result]);
      setHasMore(result.length === ADMIN_PAGE_SIZE);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '상품을 더 불러오지 못했습니다.');
    } finally {
      setLoadingMore(false);
    }
  };

  useEffect(() => {
    load('all');
  }, []);

  const selected = items.find((item) => item.id === selectedId) ?? null;

  return (
    <View style={styles.page}>
      <View style={styles.header}>
        <Text style={adminStyles.muted}>한 번에 최대 100건만 조회합니다.</Text>
        <Pressable onPress={() => setShowCreate((value) => !value)} style={adminStyles.secondaryButton}>
          <Text style={adminStyles.secondaryButtonText}>{showCreate ? '새 상품 등록 닫기' : '새 상품 등록'}</Text>
        </Pressable>
      </View>

      {showCreate && (
        <NewItemPanel
          onCancel={() => setShowCreate(false)}
          onCreated={(item) => {
            setShowCreate(false);
            setMessage(`${item.name} 상품을 등록했습니다.`);
            setError('');
            void load();
            setSelectedId(item.id);
          }}
          onError={setError}
        />
      )}

      <View style={styles.toolbar}>
        <TextInput
          accessibilityLabel="상품 검색"
          value={query}
          onChangeText={setQuery}
          onSubmitEditing={() => load()}
          placeholder="상품명 검색"
          style={[adminStyles.input, styles.search]}
        />
        <Pressable onPress={() => load()} style={adminStyles.secondaryButton}>
          <Text style={adminStyles.secondaryButtonText}>검색</Text>
        </Pressable>
      </View>

      <View style={adminStyles.row}>
        {FILTERS.map((filter) => (
          <Pressable
            key={filter.value}
            onPress={() => {
              setStatus(filter.value);
              load(filter.value);
            }}
            style={[styles.filter, status === filter.value && styles.filterActive]}
          >
            <Text style={[styles.filterText, status === filter.value && styles.filterTextActive]}>{filter.label}</Text>
          </Pressable>
        ))}
      </View>

      {!!error && <Text accessibilityRole="alert" style={adminStyles.error}>{error}</Text>}
      {!!message && <Text accessibilityLiveRegion="polite" style={adminStyles.success}>{message}</Text>}

      <View style={styles.workspace}>
        <View style={[adminStyles.card, styles.listPanel]}>
          <View style={styles.panelHeader}>
            <Text style={adminStyles.sectionTitle}>검색 결과 · {items.length}</Text>
            {loading && <ActivityIndicator size="small" />}
          </View>
          {!loading && items.length === 0 && <Text style={styles.empty}>조건에 맞는 상품이 없습니다.</Text>}
          {items.map((item) => (
            <Pressable key={item.id} onPress={() => setSelectedId(item.id)} style={[styles.itemRow, selectedId === item.id && styles.itemRowSelected]}>
              <View style={styles.itemBody}>
                <Text style={styles.itemName}>{item.name}</Text>
                <Text style={adminStyles.muted}>{item.categories?.name ?? '카테고리 없음'} · {item.model_code ?? '모델코드 없음'}</Text>
              </View>
              <StatusBadge status={item.status} />
            </Pressable>
          ))}
          {hasMore && (
            <Pressable disabled={loadingMore} onPress={loadMore} style={[adminStyles.secondaryButton, styles.loadMore]}>
              <Text style={adminStyles.secondaryButtonText}>{loadingMore ? '불러오는 중' : '더 보기'}</Text>
            </Pressable>
          )}
        </View>

        <View style={[adminStyles.card, styles.detailPanel]}>
          <Text style={adminStyles.sectionTitle}>상품 상세</Text>
          {!selected && <Text style={styles.empty}>상품을 선택해 주세요.</Text>}
          {selected && <ItemEditor item={selected} onSaved={(next) => {
            setItems((current) => current.map((item) => item.id === next.id ? next : item));
            setMessage(`${next.name} 상품을 저장했습니다.`);
          }} onMoved={(next) => {
            // The move section shows its own result; only refresh the list here.
            setItems((current) => current.map((item) => item.id === next.id ? next : item));
          }} onError={setError} />}
        </View>
      </View>
    </View>
  );
}

function NewItemPanel({ onCreated, onCancel, onError }: { onCreated: (item: AdminItem) => void; onCancel: () => void; onError: (message: string) => void }) {
  const [categories, setCategories] = useState<AdminCategory[]>([]);
  const [brands, setBrands] = useState<AdminBrand[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState('');
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [brandId, setBrandId] = useState<string | null>(null);
  const [officialUrl, setOfficialUrl] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    Promise.all([getCategories(), getBrands()])
      .then(([nextCategories, nextBrands]) => {
        if (!active) return;
        setCategories(nextCategories);
        setBrands(nextBrands);
      })
      .catch((caught) => onError(caught instanceof Error ? caught.message : '카테고리·브랜드를 불러오지 못했습니다.'))
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [onError]);

  const domainCategories = categories.map(toDomainCategory);
  const eligible = selectableCategories(domainCategories);
  const selectedCategory = categories.find((category) => category.id === categoryId) ?? null;
  const ready = Boolean(name.trim() && selectedCategory);

  const submit = async () => {
    if (!selectedCategory || saving) return;
    if (officialUrl.trim() && !officialUrl.trim().startsWith('https://')) {
      onError('공식 URL은 https:// 주소만 입력해 주세요.');
      return;
    }
    setSaving(true);
    onError('');
    try {
      const result = await createItem({ categoryId: selectedCategory.id, categorySlug: selectedCategory.slug, name, brandId, officialUrl: officialUrl.trim() || null });
      if (result[0]) onCreated(result[0]);
    } catch (caught) {
      onError(caught instanceof Error ? caught.message : '상품을 등록하지 못했습니다.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={adminStyles.card}>
      <Text style={adminStyles.sectionTitle}>새 상품 등록</Text>
      <Text style={[adminStyles.muted, { marginTop: 6 }]}>검수 요청 없이 운영자가 바로 정식 상품을 등록합니다. 같은 상품이 이미 있는지 먼저 검색해 주세요.</Text>

      {loading ? <View style={styles.loading}><ActivityIndicator /><Text style={adminStyles.muted}>불러오는 중...</Text></View> : <View style={styles.editor}>
        <View>
          <Text style={adminStyles.label}>상품명</Text>
          <TextInput accessibilityLabel="새 상품명" value={name} onChangeText={setName} maxLength={100} placeholder="예: 진라면 매운맛" style={adminStyles.input} />
        </View>

        <View>
          <Text style={adminStyles.label}>카테고리</Text>
          <AdminCategoryPicker
            accessibilityLabel="새 상품 카테고리 검색"
            categories={domainCategories}
            selectable={eligible}
            value={categoryId}
            onChange={setCategoryId}
          />
        </View>

        <View>
          <Text style={adminStyles.label}>브랜드 · 선택 사항</Text>
          <AdminBrandPicker accessibilityLabel="새 상품 브랜드 검색" brands={brands.filter((brand) => brand.is_active)} value={brandId} onChange={setBrandId} />
        </View>

        <View>
          <Text style={adminStyles.label}>공식 URL · 선택 사항</Text>
          <TextInput autoCapitalize="none" value={officialUrl} onChangeText={setOfficialUrl} placeholder="https://" style={adminStyles.input} />
        </View>

        <View style={adminStyles.row}>
          <Pressable disabled={saving || !ready} onPress={submit} style={[adminStyles.primaryButton, (saving || !ready) && { opacity: 0.5 }]}>
            <Text style={adminStyles.primaryButtonText}>{saving ? '등록 중' : '상품 등록'}</Text>
          </Pressable>
          <Pressable disabled={saving} onPress={onCancel} style={adminStyles.secondaryButton}>
            <Text style={adminStyles.secondaryButtonText}>취소</Text>
          </Pressable>
        </View>
      </View>}
    </View>
  );
}

function ItemEditor({ item, onSaved, onMoved, onError }: { item: AdminItem; onSaved: (item: AdminItem) => void; onMoved: (item: AdminItem) => void; onError: (message: string) => void }) {
  const [status, setStatus] = useState(item.status);
  const [modelCode, setModelCode] = useState(item.model_code ?? '');
  const [officialUrl, setOfficialUrl] = useState(item.official_url ?? '');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setStatus(item.status);
    setModelCode(item.model_code ?? '');
    setOfficialUrl(item.official_url ?? '');
  }, [item.id]);

  const save = async () => {
    if (officialUrl.trim() && !officialUrl.trim().startsWith('https://')) {
      onError('공식 URL은 https:// 주소만 입력해 주세요.');
      return;
    }
    setSaving(true);
    onError('');
    try {
      const result = await updateItem(item.id, {
        status,
        model_code: modelCode.trim() || null,
        official_url: officialUrl.trim() || null,
      });
      if (result[0]) onSaved(result[0]);
    } catch (caught) {
      onError(caught instanceof Error ? caught.message : '상품을 저장하지 못했습니다.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={styles.editor}>
      <View>
        <Text style={styles.detailName}>{item.name}</Text>
        <Text style={[adminStyles.muted, { marginTop: 5 }]}>{item.categories?.name ?? '카테고리 없음'} · {item.id}</Text>
      </View>

      <View>
        <Text style={adminStyles.label}>상태</Text>
        <View style={adminStyles.row}>
          {EDITABLE_STATUSES.map((value) => (
            <Pressable key={value} onPress={() => setStatus(value)} style={[styles.statusChoice, status === value && styles.statusChoiceActive]}>
              <Text style={[styles.statusChoiceText, status === value && styles.statusChoiceTextActive]}>{statusLabel(value)}</Text>
            </Pressable>
          ))}
        </View>
        {(item.status === 'pending' || item.status === 'merged') && <Text style={styles.note}>현재 상태는 검수/병합 전용 흐름에서 변경하는 것이 안전합니다.</Text>}
      </View>

      <View>
        <Text style={adminStyles.label}>모델 코드</Text>
        <TextInput value={modelCode} onChangeText={setModelCode} placeholder="선택 입력" style={adminStyles.input} />
      </View>
      <View>
        <Text style={adminStyles.label}>공식 URL</Text>
        <TextInput autoCapitalize="none" value={officialUrl} onChangeText={setOfficialUrl} placeholder="https://" style={adminStyles.input} />
      </View>

      <Pressable disabled={saving} onPress={save} style={[adminStyles.primaryButton, saving && { opacity: 0.5 }]}> 
        <Text style={adminStyles.primaryButtonText}>{saving ? '저장 중' : '상품 정보 저장'}</Text>
      </Pressable>

      <CategoryMoveEditor item={item} onMoved={onMoved} />
      <EditorialFeatureEditor item={item} />
      <AliasManager itemId={item.id} itemName={item.name} />
    </View>
  );
}

function CategoryMoveEditor({ item, onMoved }: { item: AdminItem; onMoved: (item: AdminItem) => void }) {
  const [categories, setCategories] = useState<AdminCategory[]>([]);
  const [targetId, setTargetId] = useState<string | null>(null);
  const [preview, setPreview] = useState<AdminItemCategoryMove | null>(null);
  const [checking, setChecking] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [moving, setMoving] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  useEffect(() => {
    let mounted = true;
    getCategories()
      .then((rows) => { if (mounted) setCategories(rows); })
      .catch((caught) => { if (mounted) setError(caught instanceof Error ? caught.message : '카테고리를 불러오지 못했습니다.'); });
    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    setTargetId(null);
    setPreview(null);
    setConfirming(false);
    setError('');
    setMessage('');
  }, [item.id]);

  const domainCategories = categories.map(toDomainCategory);
  const candidates = selectableCategories(domainCategories).filter((category) => category.id !== item.category_id);
  const targetCategory = candidates.find((category) => category.id === targetId) ?? null;
  const target = targetCategory ? { id: targetCategory.id, label: categoryLabel(targetCategory, domainCategories) } : null;

  const choose = async (categoryId: string) => {
    setTargetId(categoryId);
    setPreview(null);
    setConfirming(false);
    setError('');
    setMessage('');
    setChecking(true);
    try {
      setPreview(await previewItemCategoryMove(item.id, categoryId));
    } catch (caught) {
      setError(categoryMoveMessage(caught instanceof Error ? caught.message : '', 0));
    } finally {
      setChecking(false);
    }
  };

  const move = async () => {
    if (!target || !preview || preview.blocked_reason || moving) return;
    if (!confirming) {
      setConfirming(true);
      return;
    }
    setMoving(true);
    setError('');
    try {
      const result = await moveItemCategory(item.id, target.id);
      const name = targetCategory?.name ?? target.label;
      setMessage(`${target.label}(으)로 옮겼습니다. 원픽 ${result.pick_count}건이 함께 이동했습니다.`);
      setTargetId(null);
      setPreview(null);
      onMoved({ ...item, category_id: target.id, categories: { name } });
    } catch (caught) {
      // Things may have changed since the preview; show the server's current view instead of the stale one.
      const fresh = await previewItemCategoryMove(item.id, target.id).catch(() => null);
      if (fresh?.blocked_reason) setPreview(fresh);
      else setError(categoryMoveMessage(caught instanceof Error ? caught.message : '', fresh?.conflict_count ?? 0));
    } finally {
      setMoving(false);
      setConfirming(false);
    }
  };

  const blocked = preview?.blocked_reason ? categoryMoveMessage(preview.blocked_reason, preview.conflict_count) : '';

  return (
    <View style={styles.editorialSection}>
      <View>
        <Text style={adminStyles.sectionTitle}>카테고리 이동</Text>
        <Text style={[adminStyles.muted, { marginTop: 4 }]}>잘못 분류된 상품을 다른 카테고리로 옮깁니다. 이 상품을 고른 원픽(과거 기록 포함)과 한줄평·댓글이 모두 함께 이동합니다.</Text>
      </View>
      <AdminCategoryPicker
        accessibilityLabel="이동할 카테고리 검색"
        categories={domainCategories}
        selectable={candidates}
        value={targetId}
        onChange={choose}
        disabled={moving}
      />
      {checking && <ActivityIndicator size="small" />}
      {preview && !blocked && target && (
        <Text accessibilityLiveRegion="polite" style={adminStyles.muted}>
          {`${item.categories?.name ?? '현재 카테고리'} → ${target.label}\n현재 원픽 ${preview.active_pick_count}건, 과거 기록 포함 ${preview.pick_count}건이 함께 이동합니다.`}
        </Text>
      )}
      {!!blocked && <Text accessibilityRole="alert" style={adminStyles.error}>{blocked}</Text>}
      {!!error && <Text accessibilityRole="alert" style={adminStyles.error}>{error}</Text>}
      {!!message && <Text accessibilityLiveRegion="polite" style={adminStyles.success}>{message}</Text>}
      <Pressable disabled={!preview || !!blocked || moving} onPress={move}
        style={[confirming ? adminStyles.primaryButton : adminStyles.secondaryButton, styles.editorialSave, (!preview || !!blocked || moving) && styles.disabled]}>
        <Text style={confirming ? adminStyles.primaryButtonText : adminStyles.secondaryButtonText}>
          {moving ? '이동 중' : confirming ? '한 번 더 눌러 이동 확정' : '카테고리 이동'}
        </Text>
      </Pressable>
    </View>
  );
}

function categoryMoveMessage(code: string, conflictCount: number) {
  if (code.includes('PICK_CONFLICT')) return `이 상품을 고른 사용자 중 ${conflictCount || '일부'}명이 옮길 카테고리에 같은 채널(음식은 매장·온라인·레시피별)의 원픽이 이미 있습니다. 누구의 원픽도 자동으로 바꾸지 않으므로 이동할 수 없습니다.`;
  if (code.includes('ITEM_DUPLICATE')) return '옮길 카테고리에 같은 이름의 상품이 이미 있습니다. 이동 대신 병합을 사용해 주세요.';
  if (code.includes('ALIAS_CONFLICT')) return '이 상품의 검색 별칭이 옮길 카테고리의 다른 상품 이름·별칭과 겹칩니다. 별칭을 먼저 정리해 주세요.';
  if (code.includes('PLACE_CATEGORY_REQUIRED')) return '매장에 연결된 상품은 매장 검색을 쓰는 카테고리로만 옮길 수 있습니다.';
  if (code.includes('PLACE_ALREADY_LINKED')) return '같은 매장의 상품이 옮길 카테고리에 이미 있습니다.';
  if (code.includes('PROVIDER_ALREADY_LINKED')) return '같은 판매처의 상품이 옮길 카테고리에 이미 있습니다.';
  if (code.includes('ITEM_CATEGORY_LOCKED')) return '외부 DB(영화·책·게임 등)에서 가져온 상품은 카테고리를 옮길 수 없습니다.';
  if (code.includes('CATEGORY_NOT_PICKABLE')) return '원픽을 고를 수 있는 공개 하위 카테고리로만 옮길 수 있습니다.';
  if (code.includes('CATEGORY_UNCHANGED')) return '이미 이 카테고리에 있는 상품입니다.';
  if (code.includes('ITEM_NOT_FOUND')) return '상품을 찾지 못했습니다. 목록을 새로고침해 주세요.';
  if (code.includes('duplicate key')) return '이동하는 동안 다른 원픽이 생겨 충돌했습니다. 다시 확인해 주세요.';
  return code || '카테고리를 옮기지 못했습니다.';
}

function EditorialFeatureEditor({ item }: { item: AdminItem }) {
  const [active, setActive] = useState(false);
  const [priority, setPriority] = useState('100');
  const [note, setNote] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const eligible = item.status === 'active' || item.status === 'discontinued';

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    setError('');
    setMessage('');
    getItemEditorialFeature(item.id)
      .then((rows) => {
        if (!mounted) return;
        const feature = rows[0];
        setActive(feature?.is_active ?? false);
        setPriority(String(feature?.priority ?? 100));
        setNote(feature?.note ?? '');
      })
      .catch((caught) => {
        if (mounted) setError(caught instanceof Error ? caught.message : '추천 노출 상태를 불러오지 못했습니다.');
      })
      .finally(() => { if (mounted) setLoading(false); });
    return () => { mounted = false; };
  }, [item.id]);

  const save = async () => {
    if (!eligible || saving) return;
    const parsedPriority = Number.parseInt(priority, 10);
    if (!Number.isFinite(parsedPriority) || parsedPriority < 0 || parsedPriority > 1000) {
      setError('추천 노출 순서는 0~1000 사이 숫자로 입력해 주세요.');
      return;
    }
    if (note.trim().length > 200) {
      setError('추천 이유는 200자 이하로 입력해 주세요.');
      return;
    }

    setSaving(true);
    setError('');
    setMessage('');
    try {
      const result = await setItemEditorialFeature({
        itemId: item.id,
        isActive: active,
        priority: parsedPriority,
        note: note.trim() || null,
      });
      setActive(result.is_active);
      setPriority(String(result.priority));
      setNote(result.note ?? '');
      setMessage(result.is_active ? '홈의 초기 추천 영역에 노출됩니다.' : '초기 추천 노출을 해제했습니다.');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '추천 노출 설정을 저장하지 못했습니다.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={styles.editorialSection}>
      <View style={styles.aliasHeader}>
        <View>
          <Text style={adminStyles.sectionTitle}>초기 추천 노출</Text>
          <Text style={[adminStyles.muted, { marginTop: 4 }]}>운영 초기에 먼저 소개하고 싶은 원픽을 홈 상단에 노출합니다. 이 설정은 사용자 추천 수나 인기 순위에는 영향을 주지 않습니다.</Text>
        </View>
        {loading && <ActivityIndicator size="small" />}
      </View>

      {!loading && <>
        <Pressable accessibilityRole="switch" accessibilityState={{ checked: active }} disabled={!eligible}
          onPress={() => setActive((value) => !value)}
          style={[styles.statusChoice, styles.editorialToggle, active && styles.statusChoiceActive, !eligible && styles.disabled]}>
          <Text style={[styles.statusChoiceText, active && styles.statusChoiceTextActive]}>홈 추천 {active ? 'ON' : 'OFF'}</Text>
        </Pressable>
        <View>
          <Text style={adminStyles.label}>추천 이유 · 선택 사항</Text>
          <TextInput
            accessibilityLabel={`${item.name} 초기 추천 이유`}
            value={note}
            onChangeText={setNote}
            editable={eligible}
            maxLength={200}
            placeholder="왜 먼저 소개하고 싶은지 짧게 적어주세요."
            style={adminStyles.input}
          />
        </View>
        <View>
          <Text style={adminStyles.label}>노출 순서 · 숫자가 작을수록 먼저</Text>
          <TextInput
            accessibilityLabel={`${item.name} 초기 추천 노출 순서`}
            value={priority}
            onChangeText={setPriority}
            editable={eligible}
            keyboardType="number-pad"
            style={[adminStyles.input, styles.priorityInput]}
          />
        </View>
        {!eligible ? <Text style={styles.note}>활성 또는 단종 상태의 상품만 초기 추천으로 노출할 수 있습니다.</Text> : null}
        {!!error && <Text accessibilityRole="alert" style={adminStyles.error}>{error}</Text>}
        {!!message && <Text accessibilityLiveRegion="polite" style={adminStyles.success}>{message}</Text>}
        <Pressable disabled={!eligible || saving} onPress={save}
          style={[adminStyles.secondaryButton, styles.editorialSave, (!eligible || saving) && styles.disabled]}>
          <Text style={adminStyles.secondaryButtonText}>{saving ? '저장 중' : '추천 노출 저장'}</Text>
        </Pressable>
      </>}
    </View>
  );
}

function AliasManager({ itemId, itemName }: { itemId: string; itemName: string }) {
  const [aliases, setAliases] = useState<AdminItemAlias[]>([]);
  const [draft, setDraft] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    setDraft('');
    setEditingId(null);
    getItemAliases(itemId)
      .then((result) => {
        if (active) setAliases(result);
      })
      .catch((caught) => {
        if (active) setError(aliasErrorMessage(caught));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [itemId]);

  const addAlias = async () => {
    const value = draft.trim();
    if (!value || saving) return;
    setSaving(true);
    setError('');
    try {
      const result = await createItemAlias(itemId, value);
      if (result[0]) setAliases((current) => sortAliases([...current, result[0]]));
      setDraft('');
    } catch (caught) {
      setError(aliasErrorMessage(caught));
    } finally {
      setSaving(false);
    }
  };

  const saveEdit = async (alias: AdminItemAlias) => {
    const value = editingValue.trim();
    if (!value || saving) return;
    setSaving(true);
    setError('');
    try {
      const result = await updateItemAlias(alias.id, value);
      if (result[0]) setAliases((current) => sortAliases(current.map((entry) => entry.id === alias.id ? result[0] : entry)));
      setEditingId(null);
      setEditingValue('');
    } catch (caught) {
      setError(aliasErrorMessage(caught));
    } finally {
      setSaving(false);
    }
  };

  const removeAlias = async (alias: AdminItemAlias) => {
    if (saving) return;
    setSaving(true);
    setError('');
    try {
      await deleteItemAlias(alias.id);
      setAliases((current) => current.filter((entry) => entry.id !== alias.id));
      if (editingId === alias.id) {
        setEditingId(null);
        setEditingValue('');
      }
    } catch (caught) {
      setError(aliasErrorMessage(caught));
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={styles.aliasSection}>
      <View style={styles.aliasHeader}>
        <View>
          <Text style={adminStyles.sectionTitle}>검색 별칭</Text>
          <Text style={[adminStyles.muted, { marginTop: 4 }]}>사용자가 다른 표기로 검색해도 {itemName}을 찾을 수 있게 합니다.</Text>
        </View>
        {loading && <ActivityIndicator size="small" />}
      </View>

      <View style={styles.aliasComposer}>
        <TextInput
          accessibilityLabel={`${itemName} 별칭 추가`}
          value={draft}
          onChangeText={setDraft}
          onSubmitEditing={addAlias}
          placeholder="예: 아이폰16, iPhone 16"
          maxLength={100}
          style={[adminStyles.input, styles.aliasInput]}
        />
        <Pressable disabled={saving || !draft.trim()} onPress={addAlias} style={[adminStyles.secondaryButton, (saving || !draft.trim()) && styles.disabled]}>
          <Text style={adminStyles.secondaryButtonText}>추가</Text>
        </Pressable>
      </View>

      {!!error && <Text accessibilityRole="alert" style={adminStyles.error}>{error}</Text>}
      {!loading && aliases.length === 0 && <Text style={styles.aliasEmpty}>등록된 별칭이 없습니다.</Text>}

      <View style={styles.aliasList}>
        {aliases.map((alias) => (
          <View key={alias.id} style={styles.aliasRow}>
            {editingId === alias.id ? (
              <>
                <TextInput
                  accessibilityLabel="별칭 수정"
                  value={editingValue}
                  onChangeText={setEditingValue}
                  onSubmitEditing={() => saveEdit(alias)}
                  maxLength={100}
                  autoFocus
                  style={[adminStyles.input, styles.aliasEditInput]}
                />
                <View style={styles.aliasActions}>
                  <Pressable disabled={saving} onPress={() => saveEdit(alias)}><Text style={styles.aliasAction}>저장하기</Text></Pressable>
                  <Pressable disabled={saving} onPress={() => { setEditingId(null); setEditingValue(''); }}><Text style={styles.aliasActionMuted}>취소</Text></Pressable>
                </View>
              </>
            ) : (
              <>
                <View style={styles.aliasBody}>
                  <Text style={styles.aliasText}>{alias.alias}</Text>
                  <Text style={styles.aliasNormalized}>{alias.normalized_alias}</Text>
                </View>
                <View style={styles.aliasActions}>
                  <Pressable disabled={saving} onPress={() => { setEditingId(alias.id); setEditingValue(alias.alias); }}><Text style={styles.aliasAction}>수정</Text></Pressable>
                  <Pressable disabled={saving} onPress={() => removeAlias(alias)}><Text style={styles.aliasDelete}>삭제</Text></Pressable>
                </View>
              </>
            )}
          </View>
        ))}
      </View>

      <Text style={styles.aliasHelp}>같은 카테고리의 다른 상품명/별칭과 충돌하거나 현재 상품명과 동일한 별칭은 서버에서 자동 차단됩니다.</Text>
    </View>
  );
}

function StatusBadge({ status }: { status: AdminItemStatus }) {
  return <View style={styles.badge}><Text style={styles.badgeText}>{statusLabel(status)}</Text></View>;
}

function statusLabel(status: AdminItemStatus) {
  return ({ pending: '대기', active: '활성', discontinued: '단종', hidden: '숨김', merged: '병합', rejected: '반려' } as Record<AdminItemStatus, string>)[status];
}

function sortAliases(aliases: AdminItemAlias[]) {
  return [...aliases].sort((a, b) => a.alias.localeCompare(b.alias, 'ko'));
}

function aliasErrorMessage(caught: unknown) {
  const message = caught instanceof Error ? caught.message : '';
  if (message.includes('ALIAS_REDUNDANT')) return '상품명과 동일한 별칭은 추가할 수 없습니다.';
  if (message.includes('ALIAS_CONFLICT')) return '같은 카테고리의 다른 상품에서 이미 사용 중인 이름입니다.';
  if (message.includes('ALIAS_INVALID')) return '별칭은 1~100자 사이로 입력해 주세요.';
  if (message.toLowerCase().includes('duplicate key')) return '이미 등록된 별칭입니다.';
  return message || '별칭을 처리하지 못했습니다.';
}

const styles = StyleSheet.create({
  page: { gap: 20 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 16, flexWrap: 'wrap' },
  toolbar: { flexDirection: 'row', gap: 8, alignItems: 'center', flexWrap: 'wrap' },
  loading: { minHeight: 90, alignItems: 'center', justifyContent: 'center', gap: 10 },
  search: { flexGrow: 1, flexBasis: 280, maxWidth: 520 },
  filter: { minHeight: 34, justifyContent: 'center', borderRadius: 17, paddingHorizontal: 12, backgroundColor: OnePick.surface, borderWidth: 1, borderColor: OnePick.border },
  filterActive: { backgroundColor: OnePick.text, borderColor: OnePick.text },
  filterText: { color: OnePick.muted, fontSize: 12, fontWeight: '600' },
  filterTextActive: { color: OnePick.onAccent },
  workspace: { flexDirection: 'row', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' },
  listPanel: { flexGrow: 1, flexBasis: 520, minWidth: 320 },
  detailPanel: { flexGrow: 1, flexBasis: 360, minWidth: 300 },
  panelHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  empty: { color: OnePick.hint, fontSize: 13, paddingVertical: 24 },
  loadMore: { marginTop: 12, alignSelf: 'center' },
  itemRow: { minHeight: 68, flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingHorizontal: 8, borderTopWidth: 1, borderTopColor: OnePick.sunken, borderRadius: 8 },
  itemRowSelected: { backgroundColor: OnePick.sunken },
  itemBody: { flex: 1, minWidth: 0 },
  itemName: { color: OnePick.text, fontSize: 14, fontWeight: '700', marginBottom: 5 },
  badge: { borderRadius: 14, backgroundColor: OnePick.sunken, paddingHorizontal: 9, paddingVertical: 5 },
  badgeText: { color: OnePick.muted, fontSize: 11, fontWeight: '700' },
  editor: { marginTop: 18, gap: 18 },
  detailName: { color: OnePick.text, fontSize: 21, fontWeight: '800' },
  statusChoice: { minHeight: 34, justifyContent: 'center', paddingHorizontal: 11, borderRadius: 8, borderWidth: 1, borderColor: OnePick.border },
  statusChoiceActive: { backgroundColor: OnePick.text, borderColor: OnePick.text },
  statusChoiceText: { color: OnePick.muted, fontSize: 12, fontWeight: '600' },
  statusChoiceTextActive: { color: OnePick.onAccent },
  note: { marginTop: 8, color: OnePick.warning, fontSize: 11, lineHeight: 17 },
  editorialSection: { borderTopWidth: 1, borderTopColor: OnePick.border, paddingTop: 18, gap: 12 },
  editorialSave: { alignSelf: 'flex-start' },
  editorialToggle: { alignSelf: 'flex-start' },
  priorityInput: { width: 120 },
  aliasSection: { borderTopWidth: 1, borderTopColor: OnePick.border, paddingTop: 18, gap: 12 },
  aliasHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 },
  aliasComposer: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  aliasInput: { flex: 1, minWidth: 210 },
  aliasEditInput: { flex: 1, minWidth: 180 },
  aliasList: { borderTopWidth: 1, borderTopColor: OnePick.sunken },
  aliasRow: { minHeight: 58, flexDirection: 'row', alignItems: 'center', gap: 12, borderBottomWidth: 1, borderBottomColor: OnePick.sunken, paddingVertical: 9 },
  aliasBody: { flex: 1, minWidth: 0 },
  aliasText: { color: OnePick.text, fontSize: 13, fontWeight: '700' },
  aliasNormalized: { marginTop: 3, color: OnePick.hint, fontSize: 10 },
  aliasActions: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  aliasAction: { color: OnePick.muted, fontSize: 12, fontWeight: '700' },
  aliasActionMuted: { color: OnePick.hint, fontSize: 12, fontWeight: '600' },
  aliasDelete: { color: OnePick.danger, fontSize: 12, fontWeight: '700' },
  aliasEmpty: { color: OnePick.hint, fontSize: 12, paddingVertical: 8 },
  aliasHelp: { color: OnePick.hint, fontSize: 11, lineHeight: 17 },
  disabled: { opacity: 0.45 },
});
