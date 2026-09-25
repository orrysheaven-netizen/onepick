import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { adminStyles } from '@/components/admin/admin-shell';
import { ADMIN_PAGE_SIZE, getCategories, getMergeCandidates, getPendingItemCategorySuggestion, getPendingItems, mergePendingItem, updatePendingItem } from '@/lib/admin-api';
import type { AdminCategory, AdminItem, AdminItemCategorySuggestion, PendingItem } from '@/lib/admin-api';
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

type SuggestionConfidence = AdminItemCategorySuggestion['suggestions'][number]['confidence'];
const CONFIDENCE_LABELS: Record<SuggestionConfidence, string> = { high: '높음', medium: '보통', low: '낮음' };

function confidenceRank(confidence: SuggestionConfidence) {
  return confidence === 'high' ? 2 : confidence === 'medium' ? 1 : 0;
}

function reviewErrorMessage(caught: unknown, fallback: string) {
  const message = caught instanceof Error ? caught.message : '';
  if (message.includes('CATEGORY_NOT_PICKABLE')) return '선택한 카테고리는 원픽 대상이 아닙니다. 운영 중인 하위 카테고리를 골라 주세요.';
  if (message.includes('ITEM_DUPLICATE')) return '같은 카테고리에 같은 이름의 정식 상품이 이미 있습니다. 병합을 사용해 주세요.';
  if (message.includes('ITEM_NAME_INVALID')) return '상품명이 비어 있거나 100자를 넘어 승인할 수 없습니다.';
  if (message.includes('SOURCE_ITEM_NOT_PENDING')) return '이미 처리된 요청입니다. 목록을 새로고침해 주세요.';
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
  const [suggestion, setSuggestion] = useState<AdminItemCategorySuggestion | null>(null);
  const [suggestionLoading, setSuggestionLoading] = useState(false);

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

  const visible = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    if (!keyword) return items;
    return items.filter((item) => `${item.name} ${item.categories?.name ?? ''}`.toLowerCase().includes(keyword));
  }, [items, query]);

  const selected = items.find((item) => item.id === selectedId) ?? null;
  const domainCategories = useMemo(() => categories.map(toDomainCategory), [categories]);
  const reviewCategories = useMemo(() => {
    const selectableIds = new Set(selectableCategories(domainCategories).map((category) => category.id));
    return categories.filter((category) => selectableIds.has(category.id));
  }, [categories, domainCategories]);
  const reviewCategoryLabel = (category: AdminCategory) => categoryLabel(toDomainCategory(category), domainCategories);
  const isUnclassified = selected?.categories?.slug === 'pending-product';

  useEffect(() => {
    setMergeCandidates([]);
    setMergeQuery(selected?.name ?? '');
    setCategoryQuery('');
    setSuggestion(null);
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

  const reviewCategory = reviewCategories.find((category) => category.id === reviewCategoryId) ?? null;
  const visibleReviewCategories = useMemo(() => {
    const keyword = categoryQuery.trim().toLowerCase();
    if (!keyword) return reviewCategories;
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
    if (status === 'rejected' && !window.confirm(`${selected.name} 상품을 반려하시겠습니까?`)) return;
    setProcessing(true);
    setError('');
    setMessage('');
    try {
      await updatePendingItem(selected.id, status, status === 'active' ? reviewCategoryId : undefined);
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
              <View style={styles.itemBody}>
                <Text style={styles.itemName}>{item.name}</Text>
                <Text style={adminStyles.muted}>{item.categories?.name ?? '카테고리 없음'} · {formatDate(item.created_at)}{item.official_url ? ` · 링크 ${linkHost(item.official_url)}` : ''}</Text>
              </View>
              <Text style={styles.pendingBadge}>pending</Text>
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
              <View style={styles.preview}>
                <Text style={styles.previewIcon}>◇</Text>
                <Text style={adminStyles.muted}>{selected.image_path ? '등록 이미지 경로가 있습니다.' : '등록 이미지 없음'}</Text>
              </View>

              <View>
                <Text style={styles.detailName}>{selected.name}</Text>
                <Text style={[adminStyles.muted, { marginTop: 6 }]}>{selected.categories?.name ?? '카테고리 없음'}</Text>
              </View>

              <View style={styles.metaBox}>
                <Meta label="상품 ID" value={selected.id} />
                <Meta label="등록일" value={new Date(selected.created_at).toLocaleString('ko-KR')} />
                <Meta label="이미지 경로" value={selected.image_path ?? '없음'} />
                <Meta label="요청 카테고리" value={selected.requested_category_label ?? '없음'} />
                <Meta label="원본 링크" value={selected.official_url ?? '없음'} />
              </View>

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
                  {visibleReviewCategories.length === 0 && <Text style={styles.mergeEmpty}>조건에 맞는 카테고리가 없습니다.</Text>}
                  {visibleReviewCategories.map((category) => (
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
                </View>
              </View>

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

              <View style={adminStyles.row}>
                <Pressable
                  accessibilityState={{ disabled: processing || !!mergingId || !reviewCategoryId }}
                  disabled={processing || !!mergingId || !reviewCategoryId}
                  onPress={() => process('active')}
                  style={[adminStyles.primaryButton, (processing || !!mergingId || !reviewCategoryId) && { opacity: 0.5 }]}
                >
                  <Text style={adminStyles.primaryButtonText}>{processing ? '처리 중' : '승인'}</Text>
                </Pressable>
                <Pressable disabled={processing || !!mergingId} onPress={() => process('rejected')} style={[adminStyles.dangerButton, (processing || !!mergingId) && { opacity: 0.5 }]}>
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
  itemBody: { flex: 1, minWidth: 0 },
  itemName: { color: OnePick.text, fontSize: 14, fontWeight: '700', marginBottom: 5 },
  pendingBadge: { color: OnePick.warning, backgroundColor: OnePick.warningSoft, borderRadius: 14, paddingHorizontal: 9, paddingVertical: 5, fontSize: 11, fontWeight: '700' },
  detailBody: { marginTop: 16, gap: 18 },
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
});
