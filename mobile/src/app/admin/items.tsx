import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { adminStyles } from '@/components/admin/admin-shell';
import { getItems, updateItem } from '@/lib/admin-api';
import type { AdminItem, AdminItemStatus } from '@/lib/admin-api';

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

export default function AdminItemsScreen() {
  const [items, setItems] = useState<AdminItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<AdminItemStatus | 'all'>('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const load = async (nextStatus = status) => {
    setLoading(true);
    setError('');
    try {
      const result = await getItems({ query, status: nextStatus });
      setItems(result);
      setSelectedId((current) => current && result.some((item) => item.id === current) ? current : result[0]?.id ?? null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '상품을 불러오지 못했습니다.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load('all');
  }, []);

  const selected = items.find((item) => item.id === selectedId) ?? null;

  return (
    <View style={styles.page}>
      <View>
        <Text style={adminStyles.pageTitle}>상품</Text>
        <Text style={adminStyles.pageDescription}>상품 상태와 운영 메타데이터를 관리합니다. 한 번에 최대 100건만 조회합니다.</Text>
      </View>

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
        </View>

        <View style={[adminStyles.card, styles.detailPanel]}>
          <Text style={adminStyles.sectionTitle}>상품 상세</Text>
          {!selected && <Text style={styles.empty}>상품을 선택해 주세요.</Text>}
          {selected && <ItemEditor item={selected} onSaved={(next) => {
            setItems((current) => current.map((item) => item.id === next.id ? next : item));
            setMessage(`${next.name} 상품을 저장했습니다.`);
          }} onError={setError} />}
        </View>
      </View>
    </View>
  );
}

function ItemEditor({ item, onSaved, onError }: { item: AdminItem; onSaved: (item: AdminItem) => void; onError: (message: string) => void }) {
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
        <Text style={adminStyles.primaryButtonText}>{saving ? '저장 중' : '저장'}</Text>
      </Pressable>
    </View>
  );
}

function StatusBadge({ status }: { status: AdminItemStatus }) {
  return <View style={styles.badge}><Text style={styles.badgeText}>{statusLabel(status)}</Text></View>;
}

function statusLabel(status: AdminItemStatus) {
  return ({ pending: '대기', active: '활성', discontinued: '단종', hidden: '숨김', merged: '병합', rejected: '반려' } as Record<AdminItemStatus, string>)[status];
}

const styles = StyleSheet.create({
  page: { gap: 20 },
  toolbar: { flexDirection: 'row', gap: 8, alignItems: 'center', flexWrap: 'wrap' },
  search: { flexGrow: 1, flexBasis: 280, maxWidth: 520 },
  filter: { minHeight: 34, justifyContent: 'center', borderRadius: 17, paddingHorizontal: 12, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#E5E7EB' },
  filterActive: { backgroundColor: '#111827', borderColor: '#111827' },
  filterText: { color: '#6B7280', fontSize: 12, fontWeight: '600' },
  filterTextActive: { color: '#FFFFFF' },
  workspace: { flexDirection: 'row', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' },
  listPanel: { flexGrow: 1, flexBasis: 520, minWidth: 320 },
  detailPanel: { flexGrow: 1, flexBasis: 360, minWidth: 300 },
  panelHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  empty: { color: '#9CA3AF', fontSize: 13, paddingVertical: 24 },
  itemRow: { minHeight: 68, flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingHorizontal: 8, borderTopWidth: 1, borderTopColor: '#F0F1F3', borderRadius: 8 },
  itemRowSelected: { backgroundColor: '#F7F7F8' },
  itemBody: { flex: 1, minWidth: 0 },
  itemName: { color: '#111827', fontSize: 14, fontWeight: '700', marginBottom: 5 },
  badge: { borderRadius: 14, backgroundColor: '#F3F4F6', paddingHorizontal: 9, paddingVertical: 5 },
  badgeText: { color: '#4B5563', fontSize: 11, fontWeight: '700' },
  editor: { marginTop: 18, gap: 18 },
  detailName: { color: '#111827', fontSize: 21, fontWeight: '800' },
  statusChoice: { minHeight: 34, justifyContent: 'center', paddingHorizontal: 11, borderRadius: 8, borderWidth: 1, borderColor: '#E5E7EB' },
  statusChoiceActive: { backgroundColor: '#111827', borderColor: '#111827' },
  statusChoiceText: { color: '#6B7280', fontSize: 12, fontWeight: '600' },
  statusChoiceTextActive: { color: '#FFFFFF' },
  note: { marginTop: 8, color: '#8A5A16', fontSize: 11, lineHeight: 17 },
});
