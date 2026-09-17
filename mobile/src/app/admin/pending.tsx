import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { adminStyles } from '@/components/admin/admin-shell';
import { getMergeCandidates, getPendingItems, mergePendingItem, updatePendingItem } from '@/lib/admin-api';
import type { AdminItem, PendingItem } from '@/lib/admin-api';

export default function AdminPendingScreen() {
  const [items, setItems] = useState<PendingItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [mergeQuery, setMergeQuery] = useState('');
  const [mergeCandidates, setMergeCandidates] = useState<AdminItem[]>([]);
  const [mergeSearching, setMergeSearching] = useState(false);
  const [mergingId, setMergingId] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const result = await getPendingItems();
      setItems(result);
      setSelectedId((current) => current && result.some((item) => item.id === current) ? current : result[0]?.id ?? null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '검수 대기 상품을 불러오지 못했습니다.');
    } finally {
      setLoading(false);
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

  useEffect(() => {
    setMergeCandidates([]);
    setMergeQuery(selected?.name ?? '');
  }, [selectedId]);

  const removeSelected = (name: string, resultMessage: string) => {
    if (!selected) return;
    const remaining = items.filter((item) => item.id !== selected.id);
    setItems(remaining);
    setSelectedId(remaining[0]?.id ?? null);
    setMessage(`${name} ${resultMessage}`);
  };

  const process = async (status: 'active' | 'rejected') => {
    if (!selected || processing) return;
    setProcessing(true);
    setError('');
    setMessage('');
    try {
      await updatePendingItem(selected.id, status);
      removeSelected(selected.name, `상품을 ${status === 'active' ? '승인' : '반려'}했습니다.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '상품 검수 처리에 실패했습니다.');
    } finally {
      setProcessing(false);
    }
  };

  const searchMergeCandidates = async () => {
    if (!selected) return;
    setMergeSearching(true);
    setError('');
    try {
      const result = await getMergeCandidates(mergeQuery, selected.category_id);
      setMergeCandidates(result.filter((item) => item.id !== selected.id));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '병합 후보를 검색하지 못했습니다.');
    } finally {
      setMergeSearching(false);
    }
  };

  const mergeInto = async (target: AdminItem) => {
    if (!selected || mergingId) return;
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
        <View>
          <Text style={adminStyles.pageTitle}>검수 대기</Text>
          <Text style={adminStyles.pageDescription}>사용자가 추가한 pending 상품을 승인, 반려하거나 기존 상품과 병합합니다.</Text>
        </View>
        <Pressable disabled={loading} onPress={load} style={adminStyles.secondaryButton}>
          <Text style={adminStyles.secondaryButtonText}>새로고침</Text>
        </Pressable>
      </View>

      {!!error && <Text accessibilityRole="alert" style={adminStyles.error}>{error}</Text>}
      {!!message && <Text accessibilityLiveRegion="polite" style={adminStyles.success}>{message}</Text>}

      <TextInput
        accessibilityLabel="검수 대기 상품 검색"
        value={query}
        onChangeText={setQuery}
        placeholder="상품명 또는 카테고리 검색"
        style={[adminStyles.input, styles.search]}
      />

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
                <Text style={adminStyles.muted}>{item.categories?.name ?? '카테고리 없음'} · {formatDate(item.created_at)}</Text>
              </View>
              <Text style={styles.pendingBadge}>pending</Text>
            </Pressable>
          ))}
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
                <Pressable disabled={processing || !!mergingId} onPress={() => process('active')} style={[adminStyles.primaryButton, (processing || !!mergingId) && { opacity: 0.5 }]}>
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

function formatDate(value: string) {
  return new Intl.DateTimeFormat('ko-KR', { month: '2-digit', day: '2-digit' }).format(new Date(value));
}

const styles = StyleSheet.create({
  page: { gap: 22 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' },
  search: { maxWidth: 420 },
  workspace: { flexDirection: 'row', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' },
  listPanel: { flexGrow: 1, flexBasis: 480, minWidth: 300 },
  detailPanel: { flexGrow: 1, flexBasis: 390, minWidth: 300 },
  panelHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  empty: { color: '#9CA3AF', fontSize: 13, paddingVertical: 26 },
  itemRow: { minHeight: 68, borderTopWidth: 1, borderTopColor: '#F0F1F3', paddingVertical: 13, paddingHorizontal: 8, flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 8 },
  itemRowSelected: { backgroundColor: '#F7F7F8' },
  itemBody: { flex: 1, minWidth: 0 },
  itemName: { color: '#111827', fontSize: 14, fontWeight: '700', marginBottom: 5 },
  pendingBadge: { color: '#8A5A16', backgroundColor: '#FFF5DD', borderRadius: 14, paddingHorizontal: 9, paddingVertical: 5, fontSize: 11, fontWeight: '700' },
  detailBody: { marginTop: 16, gap: 18 },
  preview: { minHeight: 150, borderRadius: 10, backgroundColor: '#F7F7F8', alignItems: 'center', justifyContent: 'center', gap: 8 },
  previewIcon: { color: '#9CA3AF', fontSize: 34 },
  detailName: { color: '#111827', fontSize: 21, fontWeight: '800' },
  metaBox: { borderTopWidth: 1, borderTopColor: '#F0F1F3' },
  metaRow: { minHeight: 46, borderBottomWidth: 1, borderBottomColor: '#F0F1F3', flexDirection: 'row', gap: 12, alignItems: 'center' },
  metaLabel: { width: 82, color: '#6B7280', fontSize: 12, fontWeight: '700' },
  metaValue: { flex: 1, color: '#374151', fontSize: 12 },
  note: { color: '#6B7280', fontSize: 12, lineHeight: 19 },
  mergeBox: { gap: 10, borderWidth: 1, borderColor: '#E5E7EB', borderRadius: 10, padding: 14, backgroundColor: '#FAFAFB' },
  mergeTitle: { color: '#111827', fontSize: 14, fontWeight: '700' },
  mergeSearchRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap', alignItems: 'center' },
  mergeInput: { flexGrow: 1, flexBasis: 210 },
  candidateRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: '#EDEFF2' },
  candidateBody: { flex: 1, minWidth: 0 },
  candidateName: { color: '#111827', fontSize: 13, fontWeight: '700', marginBottom: 3 },
  mergeEmpty: { color: '#9CA3AF', fontSize: 12, paddingTop: 4 },
});
