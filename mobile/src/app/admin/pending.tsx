import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { adminStyles } from '@/components/admin/admin-shell';
import { getPendingItems, updatePendingItem } from '@/lib/admin-api';
import type { PendingItem } from '@/lib/admin-api';

export default function AdminPendingScreen() {
  const [items, setItems] = useState<PendingItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

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

  const process = async (status: 'active' | 'rejected') => {
    if (!selected || processing) return;
    setProcessing(true);
    setError('');
    setMessage('');
    try {
      await updatePendingItem(selected.id, status);
      const remaining = items.filter((item) => item.id !== selected.id);
      setItems(remaining);
      setSelectedId(remaining[0]?.id ?? null);
      setMessage(`${selected.name} 상품을 ${status === 'active' ? '승인' : '반려'}했습니다.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '상품 검수 처리에 실패했습니다.');
    } finally {
      setProcessing(false);
    }
  };

  return (
    <View style={styles.page}>
      <View style={styles.header}>
        <View>
          <Text style={adminStyles.pageTitle}>검수 대기</Text>
          <Text style={adminStyles.pageDescription}>사용자가 추가한 pending 상품을 확인하고 정식 상품으로 승인하거나 반려합니다.</Text>
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

              <Text style={styles.note}>승인하면 상품 상태가 active로 바뀌어 서비스에서 사용할 수 있습니다. 병합 기능은 다음 단계에서 별도 중복 검색 흐름으로 추가합니다.</Text>

              <View style={adminStyles.row}>
                <Pressable disabled={processing} onPress={() => process('active')} style={[adminStyles.primaryButton, processing && { opacity: 0.5 }]}>
                  <Text style={adminStyles.primaryButtonText}>{processing ? '처리 중' : '승인'}</Text>
                </Pressable>
                <Pressable disabled={processing} onPress={() => process('rejected')} style={[adminStyles.dangerButton, processing && { opacity: 0.5 }]}>
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
  detailPanel: { flexGrow: 1, flexBasis: 360, minWidth: 300 },
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
  note: { color: '#6B7280', fontSize: 12, lineHeight: 19, backgroundColor: '#F9FAFB', borderRadius: 8, padding: 12 },
});
