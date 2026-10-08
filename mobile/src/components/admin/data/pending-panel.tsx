import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Image, Linking, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { adminStyles } from '@/components/admin/admin-shell';
import { AppError } from '@/errors/appError';
import { ADMIN_PAGE_SIZE, REJECT_REASON_MAX_LENGTH, createCategory, getCategories, getMergeCandidates, getPendingItemCategorySuggestion, getPendingItems, isOnlineSellerRequest, mergePendingItem, resolveOnlineSellerRequest, updatePendingItem } from '@/lib/admin-api';
import type { AdminCategory, AdminItem, AdminItemCategorySuggestion, PendingItem } from '@/lib/admin-api';
import { chooseItemPhoto, importItemPhoto, itemPhotoUrl, saveItemPhoto } from '@/lib/admin/itemPhoto';
import { categoryLabel, newLeafParentCategories, selectableCategories } from '@/lib/categories/categoryTree';
import { photoFailureMessage } from '@/lib/photos/photoFailure';
import type { PickPhotoDraft } from '@/types/domain/photo';
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

// The full selectable list runs to hundreds of chips; only search results are shown.
const CATEGORY_RESULT_LIMIT = 30;

type SuggestionConfidence = AdminItemCategorySuggestion['suggestions'][number]['confidence'];
const CONFIDENCE_LABELS: Record<SuggestionConfidence, string> = { high: '높음', medium: '보통', low: '낮음' };

const QUICK_REJECT_REASONS = ['중복 상품', '원픽 대상 아님', '정보 부족', '부적절한 내용', '배달앱 링크'];

function confidenceRank(confidence: SuggestionConfidence) {
  return confidence === 'high' ? 2 : confidence === 'medium' ? 1 : 0;
}

const CATEGORY_SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

function newCategoryErrorMessage(caught: unknown) {
  const message = caught instanceof Error ? caught.message : '';
  if (/duplicate key|23505|categories_slug/i.test(message)) return '이미 사용 중인 slug입니다. 다른 slug를 입력해 주세요.';
  if (message.includes('CATEGORY_INVALID')) return '카테고리명(1~60자), slug 형식, 상위 카테고리(3단계 이하)를 확인해 주세요.';
  return message || '카테고리를 만들지 못했습니다.';
}

function reviewErrorMessage(caught: unknown, fallback: string) {
  const message = caught instanceof Error ? caught.message : '';
  if (message.includes('CATEGORY_NOT_PICKABLE')) return '선택한 카테고리는 원픽 대상이 아닙니다. 운영 중인 하위 카테고리를 골라 주세요.';
  if (message.includes('ITEM_DUPLICATE')) return '같은 카테고리에 같은 이름의 정식 상품이 이미 있습니다. 병합을 사용해 주세요.';
  if (message.includes('PLACE_ITEM_CATEGORY_LOCKED')) return '매장 원픽은 사용자가 고른 메뉴 카테고리로만 승인할 수 있습니다. 카테고리가 맞지 않으면 반려해 주세요.';
  if (message.includes('ITEM_NAME_INVALID')) return '상품명이 비어 있거나 100자를 넘어 승인할 수 없습니다.';
  if (message.includes('SOURCE_ITEM_NOT_PENDING')) return '이미 처리된 요청입니다. 목록을 새로고침해 주세요.';
  if (message.includes('online_stores_not_delivery_app')) return '배달앱 링크는 온라인 판매처가 될 수 없습니다. 배달은 매장 원픽이므로 반려해 주세요.';
  if (message.includes('REJECT_REASON_INVALID')) return `반려 사유를 1~${REJECT_REASON_MAX_LENGTH}자로 입력해 주세요.`;
  if (message.includes('SOURCE_ITEM_IN_USE')) return '이 요청에 이미 원픽이 연결되어 있어 병합할 수 없습니다.';
  return message || fallback;
}

export function PendingPanel() {
  const [items, setItems] = useState<PendingItem[]>([]);
  const [categories, setCategories] = useState<AdminCategory[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [reviewCategoryId, setReviewCategoryId] = useState('');
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [mergeQuery, setMergeQuery] = useState('');
  const [mergeCandidates, setMergeCandidates] = useState<AdminItem[]>([]);
  const [mergeSearching, setMergeSearching] = useState(false);
  const [mergingId, setMergingId] = useState<string | null>(null);
  const [categoryQuery, setCategoryQuery] = useState('');
  const [newCategoryOpen, setNewCategoryOpen] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [newCategorySlug, setNewCategorySlug] = useState('');
  const [newCategoryParentId, setNewCategoryParentId] = useState('');
  const [parentQuery, setParentQuery] = useState('');
  const [creatingCategory, setCreatingCategory] = useState(false);
  // Set after creating a category so the category reload selects it instead of
  // resetting the review form.
  const createdCategoryId = useRef<string | null>(null);
  const [suggestion, setSuggestion] = useState<AdminItemCategorySuggestion | null>(null);
  const [suggestionLoading, setSuggestionLoading] = useState(false);
  const [photoSaving, setPhotoSaving] = useState<'file' | 'link' | null>(null);
  const [onlineOnly, setOnlineOnly] = useState(false);
  const [sellerName, setSellerName] = useState('');
  const [sellerUrl, setSellerUrl] = useState('');
  const [storeType, setStoreType] = useState<'official_site' | 'platform_store'>('official_site');
  const [platform, setPlatform] = useState('');
  const [storeKey, setStoreKey] = useState('');
  const [resolving, setResolving] = useState(false);
  const [rejectReason, setRejectReason] = useState('');

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const [result, categoryResult] = await Promise.all([getPendingItems(), getCategories()]);
      setItems(result);
      setCategories(categoryResult);
      setHasMore(result.length === ADMIN_PAGE_SIZE);
      setSelectedId((current) => current && result.some((item) => item.id === current) ? current : result[0]?.id ?? null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '검수 대기 상품을 불러오지 못했습니다.');
    } finally {
      setLoading(false);
    }
  };

  const loadMore = async () => {
    if (loadingMore || !hasMore) return;
    setLoadingMore(true);
    setError('');
    try {
      const result = await getPendingItems(items.length);
      setItems((current) => [...current, ...result]);
      setHasMore(result.length === ADMIN_PAGE_SIZE);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '검수 대기 상품을 더 불러오지 못했습니다.');
    } finally {
      setLoadingMore(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const onlineRequestCount = useMemo(() => items.filter(isOnlineSellerRequest).length, [items]);
  const visible = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    const scoped = onlineOnly ? items.filter(isOnlineSellerRequest) : items;
    if (!keyword) return scoped;
    return scoped.filter((item) => `${item.name} ${item.categories?.name ?? ''}`.toLowerCase().includes(keyword));
  }, [items, onlineOnly, query]);

  const selected = items.find((item) => item.id === selectedId) ?? null;
  const domainCategories = useMemo(() => categories.map(toDomainCategory), [categories]);
  const reviewCategories = useMemo(() => {
    const selectableIds = new Set(selectableCategories(domainCategories).map((category) => category.id));
    return categories.filter((category) => selectableIds.has(category.id));
  }, [categories, domainCategories]);
  const reviewCategoryLabel = (category: AdminCategory) => categoryLabel(toDomainCategory(category), domainCategories);
  const isUnclassified = selected?.categories?.slug === 'pending-product';
  // 온라인 판매처 requests resolve into an online provider item; plain approval would
  // create a channel-less item that never shows under the 온라인 tab.
  const isSellerRequest = Boolean(selected && isOnlineSellerRequest(selected));
  const busy = processing || !!mergingId || resolving;
  const canResolve = !busy && Boolean(sellerName.trim()) && Boolean(sellerUrl.trim());
  const canReject = !busy && Boolean(rejectReason.trim());

  useEffect(() => {
    if (createdCategoryId.current) {
      const id = createdCategoryId.current;
      createdCategoryId.current = null;
      if (reviewCategories.some((category) => category.id === id)) {
        setReviewCategoryId(id);
        setMergeCandidates([]);
        return;
      }
    }
    setMergeCandidates([]);
    setNewCategoryOpen(false);
    setMergeQuery(selected?.name ?? '');
    setCategoryQuery('');
    setSuggestion(null);
    setSellerName(selected?.name ?? '');
    setSellerUrl(selected?.official_url ?? '');
    setStoreType('official_site');
    setPlatform('');
    setStoreKey('');
    setRejectReason('');
    const ownCategoryIsSelectable = Boolean(
      selected
      && selected.categories?.slug !== 'pending-product'
      && reviewCategories.some((category) => category.id === selected.category_id),
    );
    setReviewCategoryId(ownCategoryIsSelectable && selected ? selected.category_id : '');
    if (!selected) return;

    let active = true;
    setSuggestionLoading(true);
    getPendingItemCategorySuggestion(selected.id)
      .then((result) => {
        if (!active) return;
        setSuggestion(result);
        if (ownCategoryIsSelectable || !result) return;
        const ranked = [...result.suggestions].sort((a, b) => confidenceRank(b.confidence) - confidenceRank(a.confidence));
        const first = ranked.find((entry) => reviewCategories.some((category) => category.id === entry.categoryId));
        if (first) setReviewCategoryId(first.categoryId);
      })
      .catch(() => { if (active) setSuggestion(null); })
      .finally(() => { if (active) setSuggestionLoading(false); });
    return () => { active = false; };
  }, [selectedId, reviewCategories]);

  const parentCategories = useMemo(() => {
    const allowed = new Set(newLeafParentCategories(domainCategories).map((category) => category.id));
    return categories.filter((category) => allowed.has(category.id));
  }, [categories, domainCategories]);
  const visibleParentCategories = useMemo(() => {
    const keyword = parentQuery.trim().toLowerCase();
    const matches = keyword
      ? parentCategories.filter((category) => `${reviewCategoryLabel(category)} ${category.slug}`.toLowerCase().includes(keyword))
      : parentCategories;
    return matches.slice(0, CATEGORY_RESULT_LIMIT);
  }, [parentCategories, parentQuery, domainCategories]);
  const newCategoryParent = parentCategories.find((category) => category.id === newCategoryParentId) ?? null;
  const newCategorySlugValid = CATEGORY_SLUG_PATTERN.test(newCategorySlug.trim());
  const canCreateCategory = !creatingCategory && !busy && Boolean(newCategoryName.trim())
    && newCategoryName.trim().length <= 60 && newCategorySlugValid && Boolean(newCategoryParent);

  const openNewCategory = () => {
    setNewCategoryName(categoryQuery.trim() || selected?.requested_category_label?.trim() || '');
    setNewCategorySlug('');
    setNewCategoryParentId('');
    setParentQuery('');
    setNewCategoryOpen(true);
  };

  const addReviewCategory = async () => {
    if (!canCreateCategory || !newCategoryParent) return;
    const name = newCategoryName.trim();
    setCreatingCategory(true);
    setError('');
    setMessage('');
    try {
      const [created] = await createCategory({ name, slug: newCategorySlug.trim(), parentId: newCategoryParent.id, openLeaf: true });
      const refreshed = await getCategories();
      if (created) createdCategoryId.current = created.id;
      setCategories(refreshed);
      setNewCategoryOpen(false);
      setCategoryQuery('');
      setMessage(`${reviewCategoryLabel(newCategoryParent)} › ${name} 카테고리를 만들고 선택했습니다.`);
    } catch (caught) {
      setError(newCategoryErrorMessage(caught));
    } finally {
      setCreatingCategory(false);
    }
  };

  const reviewCategory = reviewCategories.find((category) => category.id === reviewCategoryId) ?? null;
  const visibleReviewCategories = useMemo(() => {
    const keyword = categoryQuery.trim().toLowerCase();
    if (!keyword) return [];
    return reviewCategories.filter((category) => `${reviewCategoryLabel(category)} ${category.slug}`.toLowerCase().includes(keyword));
  }, [reviewCategories, categoryQuery, domainCategories]);

  const removeSelected = (name: string, resultMessage: string) => {
    if (!selected) return;
    const remaining = items.filter((item) => item.id !== selected.id);
    setItems(remaining);
    setSelectedId(remaining[0]?.id ?? null);
    setMessage(`${name} ${resultMessage}`);
  };

  const process = async (status: 'active' | 'rejected') => {
    if (!selected || processing) return;
    if (status === 'active' && !reviewCategoryId) {
      setError('승인할 실제 카테고리를 먼저 선택해 주세요.');
      return;
    }
    if (status === 'rejected' && !rejectReason.trim()) {
      setError('반려 사유를 입력해 주세요.');
      return;
    }
    setProcessing(true);
    setError('');
    setMessage('');
    try {
      await updatePendingItem(
        selected.id,
        status,
        status === 'active' ? reviewCategoryId : undefined,
        status === 'rejected' ? rejectReason : undefined,
      );
      removeSelected(
        selected.name,
        status === 'active' && reviewCategory ? `상품을 ${reviewCategoryLabel(reviewCategory)} 카테고리로 승인했습니다.` : '상품을 반려했습니다.',
      );
    } catch (caught) {
      setError(reviewErrorMessage(caught, '상품 검수 처리에 실패했습니다.'));
    } finally {
      setProcessing(false);
    }
  };

  const addPhoto = async (source: 'file' | 'link') => {
    if (!selected || photoSaving) return;
    const { id: itemId, name } = selected;
    setError('');
    setMessage('');
    setPhotoSaving(source);
    try {
      let photo: PickPhotoDraft | null;
      if (source === 'link') {
        if (!selected.official_url) return;
        photo = await importItemPhoto(selected.official_url);
      } else {
        photo = await chooseItemPhoto();
      }
      if (!photo) return;
      const uploaded = await saveItemPhoto(itemId, photo);
      setItems((current) => current.map((item) => item.id === itemId
        ? { ...item, image_path: uploaded.imagePath, thumbnail_path: uploaded.thumbnailPath }
        : item));
      setMessage(`${name} 사진을 등록했습니다.`);
    } catch (caught) {
      setError(caught instanceof AppError || !(caught instanceof Error) ? photoFailureMessage(caught) : caught.message);
    } finally {
      setPhotoSaving(null);
    }
  };

  const searchMergeCandidates = async () => {
    if (!selected) return;
    const categoryId = reviewCategoryId || (!isUnclassified ? selected.category_id : '');
    if (!categoryId) {
      setError('중복 상품을 찾기 전에 실제 카테고리를 선택해 주세요.');
      return;
    }
    setMergeSearching(true);
    setError('');
    try {
      const result = await getMergeCandidates(mergeQuery, categoryId);
      setMergeCandidates(result.filter((item) => item.id !== selected.id));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '병합 후보를 검색하지 못했습니다.');
    } finally {
      setMergeSearching(false);
    }
  };

  const mergeInto = async (target: AdminItem) => {
    if (!selected || mergingId) return;
    if (!window.confirm(`${selected.name} 상품을 ${target.name}에 병합하시겠습니까? 병합은 되돌릴 수 없습니다.`)) return;
    setMergingId(target.id);
    setError('');
    setMessage('');
    try {
      const sourceName = selected.name;
      await mergePendingItem(selected.id, target.id);
      removeSelected(sourceName, `상품을 ${target.name}에 병합했습니다.`);
      setMergeCandidates([]);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '상품을 병합하지 못했습니다.');
    } finally {
      setMergingId(null);
    }
  };

  const resolveSellerRequest = async () => {
    if (!selected || !isSellerRequest || !canResolve) return;
    if (!window.confirm(`${selected.name} 요청을 온라인 판매처 "${sellerName.trim()}"로 연결하시겠습니까? 요청은 판매처 원픽 항목에 병합되며 되돌릴 수 없습니다.`)) return;
    setResolving(true);
    setError('');
    setMessage('');
    try {
      const sourceName = selected.name;
      await resolveOnlineSellerRequest({
        itemId: selected.id,
        name: sellerName,
        storeType,
        officialUrl: sellerUrl,
        platform: storeType === 'platform_store' ? platform : null,
        storeKey: storeType === 'platform_store' ? storeKey : null,
      });
      removeSelected(sourceName, '요청을 온라인 판매처로 연결했습니다. 요청자에게 알림이 가고, 등록 화면의 온라인에서 고를 수 있습니다.');
    } catch (caught) {
      setError(reviewErrorMessage(caught, '온라인 판매처로 연결하지 못했습니다.'));
    } finally {
      setResolving(false);
    }
  };

  return (
    <View style={styles.page}>
      <View style={styles.header}>
        <TextInput
          accessibilityLabel="검수 대기 상품 검색"
          value={query}
          onChangeText={setQuery}
          placeholder="상품명 또는 카테고리 검색"
          style={[adminStyles.input, styles.search]}
        />
        <Pressable accessibilityRole="button" accessibilityState={{ selected: onlineOnly }} accessibilityLabel="온라인 판매처 요청만 보기"
          onPress={() => setOnlineOnly((current) => !current)}
          style={[styles.categoryChoice, onlineOnly && styles.categoryChoiceSelected]}>
          <Text style={[styles.categoryChoiceText, onlineOnly && styles.categoryChoiceTextSelected]}>온라인 판매처 요청 · {onlineRequestCount}</Text>
        </Pressable>
        <Pressable disabled={loading} onPress={load} style={adminStyles.secondaryButton}>
          <Text style={adminStyles.secondaryButtonText}>새로고침</Text>
        </Pressable>
      </View>

      {!!error && <Text accessibilityRole="alert" style={adminStyles.error}>{error}</Text>}
      {!!message && <Text accessibilityLiveRegion="polite" style={adminStyles.success}>{message}</Text>}

      <View style={styles.workspace}>
        <View style={[adminStyles.card, styles.listPanel]}>
          <View style={styles.panelHeader}>
            <Text style={adminStyles.sectionTitle}>대기 상품 · {items.length}</Text>
            {loading && <ActivityIndicator size="small" />}
          </View>

          {!loading && visible.length === 0 && <Text style={styles.empty}>검수 대기 상품이 없습니다.</Text>}
          {visible.map((item) => (
            <Pressable
              accessibilityRole="button"
              key={item.id}
              onPress={() => setSelectedId(item.id)}
              style={[styles.itemRow, selectedId === item.id && styles.itemRowSelected]}
            >
              <View style={styles.itemThumb}>
                {item.thumbnail_path || item.image_path ? (
                  <Image
                    accessibilityLabel={`${item.name} 사진`}
                    source={{ uri: itemPhotoUrl(item.thumbnail_path ?? item.image_path) ?? undefined }}
                    resizeMode="cover"
                    style={styles.itemThumbImage}
                  />
                ) : <Text style={styles.itemThumbEmpty}>사진 없음</Text>}
              </View>
              <View style={styles.itemBody}>
                <Text style={styles.itemName}>{item.name}</Text>
                <Text style={adminStyles.muted}>{item.categories?.name ?? '카테고리 없음'} · {formatDate(item.created_at)}{item.official_url ? ` · 링크 ${linkHost(item.official_url)}` : ''}</Text>
              </View>
              {isOnlineSellerRequest(item) ? <Text style={styles.onlineBadge}>온라인 판매처 요청</Text> : <Text style={styles.pendingBadge}>pending</Text>}
            </Pressable>
          ))}
          {hasMore && (
            <Pressable disabled={loadingMore} onPress={loadMore} style={[adminStyles.secondaryButton, styles.loadMore]}>
              <Text style={adminStyles.secondaryButtonText}>{loadingMore ? '불러오는 중' : '더 보기'}</Text>
            </Pressable>
          )}
        </View>

        <View style={[adminStyles.card, styles.detailPanel]}>
          <Text style={adminStyles.sectionTitle}>검수 상세</Text>
          {!selected && <Text style={styles.empty}>왼쪽에서 상품을 선택해 주세요.</Text>}
          {selected && (
            <View style={styles.detailBody}>
              <View style={styles.photoBox}>
                {selected.image_path || selected.thumbnail_path ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`${selected.name} 사진 원본 크게 보기`}
                    onPress={() => {
                      const url = itemPhotoUrl(selected.image_path ?? selected.thumbnail_path);
                      if (url) void Linking.openURL(url);
                    }}
                  >
                    <Image
                      accessibilityLabel={`${selected.name} 사진`}
                      source={{ uri: itemPhotoUrl(selected.image_path ?? selected.thumbnail_path) ?? undefined }}
                      resizeMode="contain"
                      style={styles.previewImage}
                    />
                    <Text style={styles.previewHint}>사진을 누르면 원본을 새 탭에서 엽니다.</Text>
                  </Pressable>
                ) : (
                  <View style={styles.preview}>
                    <Text style={styles.previewIcon}>◇</Text>
                    <Text style={adminStyles.muted}>사용자가 사진 없이 요청했습니다.</Text>
                  </View>
                )}
                <View style={adminStyles.row}>
                  <Pressable
                    accessibilityRole="button"
                    disabled={!!photoSaving}
                    onPress={() => addPhoto('file')}
                    style={[selected.image_path ? adminStyles.secondaryButton : adminStyles.primaryButton, !!photoSaving && styles.disabled]}
                  >
                    <Text style={selected.image_path ? adminStyles.secondaryButtonText : adminStyles.primaryButtonText}>
                      {photoSaving === 'file' ? '올리는 중' : selected.image_path ? '사진 교체' : '사진 직접 올리기'}
                    </Text>
                  </Pressable>
                  {!!selected.official_url && (
                    <Pressable accessibilityRole="button" disabled={!!photoSaving} onPress={() => addPhoto('link')} style={[adminStyles.secondaryButton, !!photoSaving && styles.disabled]}>
                      <Text style={adminStyles.secondaryButtonText}>{photoSaving === 'link' ? '가져오는 중' : '원본 링크에서 가져오기'}</Text>
                    </Pressable>
                  )}
                </View>
              </View>

              <View>
                <Text style={styles.detailName}>{selected.name}</Text>
                <Text style={[adminStyles.muted, { marginTop: 6 }]}>{selected.categories?.name ?? '카테고리 없음'}</Text>
              </View>

              <View style={styles.metaBox}>
                <Meta label="상품 ID" value={selected.id} />
                <Meta label="등록일" value={new Date(selected.created_at).toLocaleString('ko-KR')} />
                <Meta label="요청 카테고리" value={selected.requested_category_label ?? '없음'} />
                <Meta label="원본 링크" value={selected.official_url ?? '없음'} />
              </View>

              {isSellerRequest ? <View style={styles.sellerBox}>
                <Text style={styles.mergeTitle}>온라인 판매처로 연결</Text>
                <Text style={styles.note}>사용자가 맛집 등록에서 "온라인"을 골라 보낸 요청입니다. 링크를 확인한 뒤 판매처를 만들면 요청은 {selected.categories?.name ?? '같은 카테고리'}의 판매처 원픽 항목에 병합되고, 등록 화면의 온라인에서 고를 수 있습니다. 배달앱 링크는 매장 원픽이므로 반려해 주세요.</Text>
                <TextInput accessibilityLabel="온라인 판매처 이름" value={sellerName} onChangeText={setSellerName} editable={!busy}
                  placeholder="판매처 이름 (예: ○○곰탕 공식몰)" style={adminStyles.input} />
                <TextInput accessibilityLabel="온라인 판매처 URL" value={sellerUrl} onChangeText={setSellerUrl} editable={!busy}
                  autoCapitalize="none" placeholder="https://…" style={adminStyles.input} />
                <View style={styles.categoryChoices}>
                  {(['official_site', 'platform_store'] as const).map((type) => (
                    <Pressable key={type} accessibilityRole="button" accessibilityState={{ selected: storeType === type }}
                      onPress={() => setStoreType(type)} style={[styles.categoryChoice, storeType === type && styles.categoryChoiceSelected]}>
                      <Text style={[styles.categoryChoiceText, storeType === type && styles.categoryChoiceTextSelected]}>{type === 'official_site' ? '공식몰' : '플랫폼 스토어'}</Text>
                    </Pressable>
                  ))}
                </View>
                {storeType === 'platform_store' ? <View style={styles.mergeSearchRow}>
                  <TextInput accessibilityLabel="플랫폼 식별자" value={platform} onChangeText={setPlatform} editable={!busy}
                    autoCapitalize="none" placeholder="예: smartstore" style={[adminStyles.input, styles.mergeInput]} />
                  <TextInput accessibilityLabel="스토어 키" value={storeKey} onChangeText={setStoreKey} editable={!busy}
                    autoCapitalize="none" placeholder="예: smartstore:gomtang" style={[adminStyles.input, styles.mergeInput]} />
                </View> : null}
                <Pressable accessibilityRole="button" accessibilityState={{ disabled: !canResolve }} disabled={!canResolve} onPress={resolveSellerRequest}
                  style={[adminStyles.primaryButton, !canResolve && { opacity: 0.5 }]}>
                  <Text style={adminStyles.primaryButtonText}>{resolving ? '연결 중' : '판매처 만들고 요청 연결'}</Text>
                </Pressable>
              </View> : null}

              <View style={styles.classifyBox}>
                <View style={styles.classifyHeader}>
                  <View style={styles.classifyHeaderText}>
                    <Text style={styles.mergeTitle}>승인 카테고리</Text>
                    <Text style={styles.note}>{isUnclassified ? '사용자가 카테고리 없이 등록한 요청입니다. 승인 전에 실제 카테고리를 지정해야 합니다.' : '필요하면 승인 전에 카테고리를 바로잡을 수 있습니다.'}</Text>
                  </View>
                  {suggestionLoading && <ActivityIndicator size="small" />}
                </View>

                {selected.requested_category_label ? (
                  <Text style={styles.requestHint}>사용자 힌트: {selected.requested_category_label}</Text>
                ) : null}

                <View style={styles.categoryCurrent}>
                  <Text style={styles.categoryCurrentLabel}>선택됨</Text>
                  <Text style={[styles.categoryCurrentValue, !reviewCategory && styles.categoryCurrentMissing]}>
                    {reviewCategory ? reviewCategoryLabel(reviewCategory) : '아직 선택되지 않음'}
                  </Text>
                </View>

                {suggestion && suggestion.suggestions.length > 0 && (
                  <View style={styles.suggestionBlock}>
                    <Text style={styles.suggestionTitle}>AI 추천 · {suggestion.model_name}</Text>
                    {suggestion.suggestions.map((entry) => {
                      const category = reviewCategories.find((candidate) => candidate.id === entry.categoryId);
                      const active = reviewCategoryId === entry.categoryId;
                      return (
                        <Pressable
                          key={entry.categoryId}
                          accessibilityRole="button"
                          accessibilityState={{ selected: active, disabled: !category }}
                          disabled={!category}
                          onPress={() => { setReviewCategoryId(entry.categoryId); setMergeCandidates([]); }}
                          style={[styles.suggestionRow, active && styles.suggestionRowActive, !category && styles.suggestionRowDisabled]}
                        >
                          <View style={styles.suggestionBody}>
                            <Text style={[styles.suggestionLabel, active && styles.suggestionLabelActive]}>{category ? reviewCategoryLabel(category) : entry.label}</Text>
                            <Text style={styles.suggestionReason}>{entry.reason}{category ? '' : ' · 현재 선택 불가한 카테고리'}</Text>
                          </View>
                          <Text style={[styles.confidence, confidenceStyle(entry.confidence)]}>확신도 {CONFIDENCE_LABELS[entry.confidence]}</Text>
                        </Pressable>
                      );
                    })}
                  </View>
                )}
                {suggestion?.needs_new_category && (
                  <Text style={styles.suggestionWarning}>AI가 맞는 카테고리를 찾지 못했습니다. 새 카테고리가 필요할 수 있습니다.</Text>
                )}
                {!suggestionLoading && !suggestion && isUnclassified && (
                  <Text style={styles.note}>이 요청에는 AI 추천 기록이 없습니다.</Text>
                )}

                <TextInput
                  accessibilityLabel="카테고리 검색"
                  value={categoryQuery}
                  onChangeText={setCategoryQuery}
                  placeholder="카테고리 이름 검색"
                  style={adminStyles.input}
                />
                <View style={styles.categoryChoices}>
                  {!categoryQuery.trim() && <Text style={styles.mergeEmpty}>다른 카테고리가 필요하면 이름으로 검색해 주세요.</Text>}
                  {!!categoryQuery.trim() && visibleReviewCategories.length === 0 && <Text style={styles.mergeEmpty}>조건에 맞는 카테고리가 없습니다.</Text>}
                  {!newCategoryOpen && ((!!categoryQuery.trim() && visibleReviewCategories.length === 0) || suggestion?.needs_new_category) && (
                    <Pressable accessibilityRole="button" disabled={busy} onPress={openNewCategory} style={adminStyles.secondaryButton}>
                      <Text style={adminStyles.secondaryButtonText}>{categoryQuery.trim() ? `'${categoryQuery.trim()}' 새 카테고리 만들기` : '새 카테고리 만들기'}</Text>
                    </Pressable>
                  )}
                  {visibleReviewCategories.slice(0, CATEGORY_RESULT_LIMIT).map((category) => (
                    <Pressable
                      key={category.id}
                      accessibilityRole="button"
                      accessibilityState={{ selected: reviewCategoryId === category.id }}
                      onPress={() => { setReviewCategoryId(category.id); setMergeCandidates([]); }}
                      style={[styles.categoryChoice, reviewCategoryId === category.id && styles.categoryChoiceSelected]}
                    >
                      <Text style={[styles.categoryChoiceText, reviewCategoryId === category.id && styles.categoryChoiceTextSelected]}>{reviewCategoryLabel(category)}</Text>
                    </Pressable>
                  ))}
                  {visibleReviewCategories.length > CATEGORY_RESULT_LIMIT && (
                    <Text style={styles.mergeEmpty}>{visibleReviewCategories.length - CATEGORY_RESULT_LIMIT}개 더 있습니다. 검색어를 더 구체적으로 입력해 주세요.</Text>
                  )}
                </View>
              </View>

              {newCategoryOpen && (
                <View style={styles.newCategoryBox}>
                  <Text style={styles.mergeTitle}>새 카테고리 만들기</Text>
                  <Text style={styles.note}>운영 중 · 노출 · 원픽 대상 하위 카테고리로 바로 만들어지고, 이 요청의 카테고리로 선택됩니다.</Text>
                  <View style={styles.mergeSearchRow}>
                    <TextInput accessibilityLabel="새 카테고리 이름" value={newCategoryName} onChangeText={setNewCategoryName} editable={!creatingCategory}
                      maxLength={60} placeholder="예: 김치" style={[adminStyles.input, styles.mergeInput]} />
                    <TextInput accessibilityLabel="새 카테고리 slug" value={newCategorySlug} onChangeText={(value) => setNewCategorySlug(value.toLowerCase())}
                      editable={!creatingCategory} autoCapitalize="none" maxLength={80} placeholder="예: kimchi" style={[adminStyles.input, styles.mergeInput]} />
                  </View>
                  {!!newCategorySlug.trim() && !newCategorySlugValid && (
                    <Text style={styles.suggestionWarning}>slug는 영문 소문자, 숫자, 하이픈(단어 사이)만 쓸 수 있습니다.</Text>
                  )}
                  <Text style={styles.suggestionTitle}>상위 카테고리 {newCategoryParent ? `· ${reviewCategoryLabel(newCategoryParent)}` : '(필수)'}</Text>
                  <TextInput accessibilityLabel="상위 카테고리 검색" value={parentQuery} onChangeText={setParentQuery}
                    placeholder="상위 카테고리 검색" style={adminStyles.input} />
                  <View style={styles.categoryChoices}>
                    {visibleParentCategories.length === 0 && <Text style={styles.mergeEmpty}>새 하위 카테고리를 둘 수 있는 상위 카테고리가 없습니다.</Text>}
                    {visibleParentCategories.map((category) => (
                      <Pressable key={category.id} accessibilityRole="button" accessibilityState={{ selected: newCategoryParentId === category.id }}
                        onPress={() => setNewCategoryParentId(category.id)}
                        style={[styles.categoryChoice, newCategoryParentId === category.id && styles.categoryChoiceSelected]}>
                        <Text style={[styles.categoryChoiceText, newCategoryParentId === category.id && styles.categoryChoiceTextSelected]}>{reviewCategoryLabel(category)}</Text>
                      </Pressable>
                    ))}
                  </View>
                  <View style={adminStyles.row}>
                    <Pressable accessibilityRole="button" accessibilityState={{ disabled: !canCreateCategory }} disabled={!canCreateCategory} onPress={addReviewCategory}
                      style={[adminStyles.primaryButton, !canCreateCategory && { opacity: 0.5 }]}>
                      <Text style={adminStyles.primaryButtonText}>{creatingCategory ? '만드는 중' : '만들고 이 요청에 적용'}</Text>
                    </Pressable>
                    <Pressable accessibilityRole="button" disabled={creatingCategory} onPress={() => setNewCategoryOpen(false)} style={adminStyles.secondaryButton}>
                      <Text style={adminStyles.secondaryButtonText}>취소</Text>
                    </Pressable>
                  </View>
                </View>
              )}

              <View style={styles.mergeBox}>
                <Text style={styles.mergeTitle}>기존 상품과 병합</Text>
                <Text style={styles.note}>같은 카테고리의 활성/단종 상품을 검색합니다. 병합되면 이 pending 항목은 merged 상태가 됩니다.</Text>
                <View style={styles.mergeSearchRow}>
                  <TextInput
                    accessibilityLabel="병합 대상 상품 검색"
                    value={mergeQuery}
                    onChangeText={setMergeQuery}
                    onSubmitEditing={searchMergeCandidates}
                    placeholder="기존 상품명 검색"
                    style={[adminStyles.input, styles.mergeInput]}
                  />
                  <Pressable disabled={mergeSearching} onPress={searchMergeCandidates} style={adminStyles.secondaryButton}>
                    <Text style={adminStyles.secondaryButtonText}>{mergeSearching ? '검색 중' : '중복 검색'}</Text>
                  </Pressable>
                </View>

                {mergeCandidates.map((candidate) => (
                  <View key={candidate.id} style={styles.candidateRow}>
                    <View style={styles.candidateBody}>
                      <Text style={styles.candidateName}>{candidate.name}</Text>
                      <Text style={adminStyles.muted}>{candidate.categories?.name ?? '카테고리 없음'} · {candidate.status}</Text>
                    </View>
                    <Pressable disabled={!!mergingId} onPress={() => mergeInto(candidate)} style={adminStyles.secondaryButton}>
                      <Text style={adminStyles.secondaryButtonText}>{mergingId === candidate.id ? '병합 중' : '여기에 병합'}</Text>
                    </Pressable>
                  </View>
                ))}
                {!mergeSearching && mergeCandidates.length === 0 && <Text style={styles.mergeEmpty}>검색하면 병합 가능한 기존 상품이 여기에 표시됩니다.</Text>}
              </View>

              <View style={styles.rejectBox}>
                <Text style={styles.mergeTitle}>반려 사유</Text>
                <Text style={adminStyles.muted}>반려하면 요청한 사용자에게 이 사유가 알림으로 전달됩니다.</Text>
                <View style={styles.categoryChoices}>
                  {QUICK_REJECT_REASONS.map((reason) => (
                    <Pressable key={reason} accessibilityRole="button" accessibilityState={{ selected: rejectReason === reason }} disabled={busy}
                      onPress={() => setRejectReason(reason)} style={[styles.categoryChoice, rejectReason === reason && styles.categoryChoiceSelected]}>
                      <Text style={[styles.categoryChoiceText, rejectReason === reason && styles.categoryChoiceTextSelected]}>{reason}</Text>
                    </Pressable>
                  ))}
                </View>
                <TextInput
                  accessibilityLabel="반려 사유"
                  value={rejectReason}
                  onChangeText={setRejectReason}
                  editable={!busy}
                  multiline
                  maxLength={REJECT_REASON_MAX_LENGTH}
                  placeholder="직접 입력하거나 위에서 골라 주세요."
                  style={[adminStyles.input, styles.rejectInput]}
                />
                <Text style={styles.rejectCount}>{rejectReason.trim().length}/{REJECT_REASON_MAX_LENGTH}</Text>
              </View>

              <View style={adminStyles.row}>
                {isSellerRequest ? null : <Pressable
                  accessibilityState={{ disabled: busy || !reviewCategoryId }}
                  disabled={busy || !reviewCategoryId}
                  onPress={() => process('active')}
                  style={[adminStyles.primaryButton, (busy || !reviewCategoryId) && { opacity: 0.5 }]}
                >
                  <Text style={adminStyles.primaryButtonText}>{processing ? '처리 중' : '승인'}</Text>
                </Pressable>}
                <Pressable accessibilityState={{ disabled: !canReject }} disabled={!canReject} onPress={() => process('rejected')} style={[adminStyles.dangerButton, !canReject && { opacity: 0.5 }]}>
                  <Text style={adminStyles.dangerButtonText}>반려</Text>
                </Pressable>
              </View>
            </View>
          )}
        </View>
      </View>
    </View>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.metaRow}>
      <Text style={styles.metaLabel}>{label}</Text>
      <Text selectable style={styles.metaValue}>{value}</Text>
    </View>
  );
}

function confidenceStyle(confidence: SuggestionConfidence) {
  return confidence === 'high' ? styles.confidenceHigh : confidence === 'medium' ? styles.confidenceMedium : styles.confidenceLow;
}

function linkHost(value: string) {
  try { return new URL(value).hostname; } catch { return '링크'; }
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('ko-KR', { month: '2-digit', day: '2-digit' }).format(new Date(value));
}

const styles = StyleSheet.create({
  page: { gap: 22 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' },
  search: { flexGrow: 1, flexBasis: 280, maxWidth: 420 },
  workspace: { flexDirection: 'row', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' },
  listPanel: { flexGrow: 1, flexBasis: 480, minWidth: 300 },
  detailPanel: { flexGrow: 1, flexBasis: 390, minWidth: 300 },
  panelHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  empty: { color: OnePick.hint, fontSize: 13, paddingVertical: 26 },
  loadMore: { marginTop: 12, alignSelf: 'center' },
  itemRow: { minHeight: 68, borderTopWidth: 1, borderTopColor: OnePick.sunken, paddingVertical: 13, paddingHorizontal: 8, flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 8 },
  itemRowSelected: { backgroundColor: OnePick.sunken },
  itemThumb: { width: 80, height: 80, borderRadius: 8, overflow: 'hidden', backgroundColor: OnePick.sunken, alignItems: 'center', justifyContent: 'center' },
  itemThumbImage: { width: 80, height: 80 },
  itemThumbEmpty: { color: OnePick.hint, fontSize: 10, fontWeight: '700' },
  itemBody: { flex: 1, minWidth: 0 },
  itemName: { color: OnePick.text, fontSize: 14, fontWeight: '700', marginBottom: 5 },
  onlineBadge: { color: OnePick.accentDeep, backgroundColor: OnePick.accentSoft, borderRadius: 14, paddingHorizontal: 9, paddingVertical: 5, fontSize: 11, fontWeight: '700' },
  sellerBox: { gap: 10, borderWidth: 1, borderColor: OnePick.accent, borderRadius: 10, padding: 14, backgroundColor: OnePick.surface },
  pendingBadge: { color: OnePick.warning, backgroundColor: OnePick.warningSoft, borderRadius: 14, paddingHorizontal: 9, paddingVertical: 5, fontSize: 11, fontWeight: '700' },
  detailBody: { marginTop: 16, gap: 18 },
  photoBox: { gap: 10 },
  previewImage: { width: '100%', height: 400, borderRadius: 10, backgroundColor: OnePick.sunken },
  previewHint: { marginTop: 6, color: OnePick.hint, fontSize: 11 },
  disabled: { opacity: 0.5 },
  preview: { minHeight: 150, borderRadius: 10, backgroundColor: OnePick.sunken, alignItems: 'center', justifyContent: 'center', gap: 8 },
  previewIcon: { color: OnePick.hint, fontSize: 34 },
  detailName: { color: OnePick.text, fontSize: 21, fontWeight: '800' },
  metaBox: { borderTopWidth: 1, borderTopColor: OnePick.sunken },
  metaRow: { minHeight: 46, borderBottomWidth: 1, borderBottomColor: OnePick.sunken, flexDirection: 'row', gap: 12, alignItems: 'center' },
  metaLabel: { width: 82, color: OnePick.muted, fontSize: 12, fontWeight: '700' },
  metaValue: { flex: 1, color: OnePick.muted, fontSize: 12 },
  note: { color: OnePick.muted, fontSize: 12, lineHeight: 19 },
  classifyBox: { gap: 10, borderWidth: 1, borderColor: OnePick.border, borderRadius: 10, padding: 14, backgroundColor: OnePick.surface },
  classifyHeader: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 },
  classifyHeaderText: { flex: 1, gap: 4 },
  requestHint: { color: OnePick.warning, backgroundColor: OnePick.warningSoft, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, fontSize: 12, fontWeight: '700' },
  categoryCurrent: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: OnePick.accentSoft, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 9 },
  categoryCurrentLabel: { color: OnePick.accentDeep, fontSize: 11, fontWeight: '800' },
  categoryCurrentValue: { flex: 1, color: OnePick.text, fontSize: 13, fontWeight: '700' },
  categoryCurrentMissing: { color: OnePick.danger },
  suggestionBlock: { gap: 6 },
  suggestionTitle: { color: OnePick.muted, fontSize: 11, fontWeight: '800' },
  suggestionRow: { flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1, borderColor: OnePick.border, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 9 },
  suggestionRowActive: { borderColor: OnePick.accent, backgroundColor: OnePick.accentSoft },
  suggestionRowDisabled: { opacity: 0.5 },
  suggestionBody: { flex: 1, minWidth: 0 },
  suggestionLabel: { color: OnePick.text, fontSize: 13, fontWeight: '700' },
  suggestionLabelActive: { color: OnePick.accentDeep },
  suggestionReason: { marginTop: 2, color: OnePick.muted, fontSize: 11, lineHeight: 16 },
  suggestionWarning: { color: OnePick.warning, fontSize: 12, lineHeight: 18 },
  confidence: { fontSize: 10, fontWeight: '800', borderRadius: 10, paddingHorizontal: 7, paddingVertical: 4 },
  confidenceHigh: { color: OnePick.success, backgroundColor: OnePick.successSoft },
  confidenceMedium: { color: OnePick.warning, backgroundColor: OnePick.warningSoft },
  confidenceLow: { color: OnePick.muted, backgroundColor: OnePick.sunken },
  categoryChoices: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  categoryChoice: { borderWidth: 1, borderColor: OnePick.border, borderRadius: 999, paddingHorizontal: 11, paddingVertical: 8, backgroundColor: OnePick.surface },
  categoryChoiceSelected: { borderColor: OnePick.accent, backgroundColor: OnePick.accentSoft },
  categoryChoiceText: { color: OnePick.muted, fontSize: 12, fontWeight: '700' },
  categoryChoiceTextSelected: { color: OnePick.accent },
  mergeBox: { gap: 10, borderWidth: 1, borderColor: OnePick.border, borderRadius: 10, padding: 14, backgroundColor: OnePick.sunken },
  mergeTitle: { color: OnePick.text, fontSize: 14, fontWeight: '700' },
  mergeSearchRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap', alignItems: 'center' },
  mergeInput: { flexGrow: 1, flexBasis: 210 },
  candidateRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: OnePick.sunken },
  candidateBody: { flex: 1, minWidth: 0 },
  candidateName: { color: OnePick.text, fontSize: 13, fontWeight: '700', marginBottom: 3 },
  mergeEmpty: { color: OnePick.hint, fontSize: 12, paddingTop: 4 },
  newCategoryBox: { gap: 10, borderWidth: 1, borderColor: OnePick.accent, borderRadius: 10, padding: 14, backgroundColor: OnePick.surface },
  rejectBox: { gap: 10, borderWidth: 1, borderColor: OnePick.border, borderRadius: 10, padding: 14, backgroundColor: OnePick.surface },
  rejectInput: { minHeight: 72, textAlignVertical: 'top' },
  rejectCount: { alignSelf: 'flex-end', color: OnePick.hint, fontSize: 11 },
});
