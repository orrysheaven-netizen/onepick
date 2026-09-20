import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { adminStyles } from '@/components/admin/admin-shell';
import { getCategories, getEditorialCandidates, getEditorialFeatures, setItemEditorialFeature } from '@/lib/admin-api';
import type { AdminCategory, AdminEditorialFeatureWithItem, AdminItem } from '@/lib/admin-api';
import { categoryLabel } from '@/lib/categories/categoryTree';
import type { Category } from '@/types/domain/category';

const domain = (c: AdminCategory): Category => ({
  id: c.id, parentId: c.parent_id, name: c.name, slug: c.slug, status: c.status,
  isVisible: c.is_visible, isPickable: c.is_pickable, rankingMinSample: c.ranking_min_sample,
  sortOrder: c.sort_order, imageUrl: c.image_url, createdAt: '', updatedAt: '',
});

function visibleNow(f: AdminEditorialFeatureWithItem) {
  const now = Date.now();
  return f.is_active && Date.parse(f.starts_at) <= now && (!f.ends_at || Date.parse(f.ends_at) > now)
    && Boolean(f.items && ['active', 'discontinued'].includes(f.items.status));
}

export default function AdminEditorialScreen() {
  const [features, setFeatures] = useState<AdminEditorialFeatureWithItem[]>([]);
  const [categories, setCategories] = useState<AdminCategory[]>([]);
  const [query, setQuery] = useState('');
  const [candidates, setCandidates] = useState<AdminItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [searching, setSearching] = useState(false);
  const [addingId, setAddingId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const [f, c] = await Promise.all([getEditorialFeatures(), getCategories()]);
      setFeatures(f); setCategories(c);
    } catch (e) { setError(e instanceof Error ? e.message : '홈 추천 설정을 불러오지 못했습니다.'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const domainCategories = useMemo(() => categories.map(domain), [categories]);
  const labels = useMemo(() => new Map(domainCategories.map((c) => [c.id, categoryLabel(c, domainCategories)])), [domainCategories]);
  const visible = features.filter(visibleNow);
  const inactive = features.filter((f) => !visibleNow(f));
  const activeIds = new Set(visible.map((f) => f.item_id));

  const search = async () => {
    if (searching) return;
    setSearching(true); setError(''); setMessage('');
    try { setCandidates(await getEditorialCandidates(query)); }
    catch (e) { setError(e instanceof Error ? e.message : '추천 후보를 검색하지 못했습니다.'); }
    finally { setSearching(false); }
  };

  const add = async (item: AdminItem) => {
    if (addingId) return;
    setAddingId(item.id); setError(''); setMessage('');
    try {
      const old = features.find((f) => f.item_id === item.id);
      const priority = old?.priority ?? (visible.length ? Math.max(...visible.map((f) => f.priority)) + 10 : 10);
      await setItemEditorialFeature({ itemId: item.id, isActive: true, priority: Math.min(priority, 1000), note: old?.note ?? null });
      setMessage(item.name + '을 홈 추천에 추가했습니다.');
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : '홈 추천에 추가하지 못했습니다.'); }
    finally { setAddingId(null); }
  };

  return <View style={styles.page}>
    <View style={styles.header}>
      <View style={styles.grow}><Text style={adminStyles.pageTitle}>홈 추천</Text>
        <Text style={adminStyles.pageDescription}>초기 운영에서 먼저 소개할 원픽을 직접 고릅니다. 사용자 추천 수·인기 순위와는 별도입니다.</Text></View>
      <Pressable disabled={loading} onPress={() => void load()} style={adminStyles.secondaryButton}>
        <Text style={adminStyles.secondaryButtonText}>{loading ? '새로고침 중' : '새로고침'}</Text>
      </Pressable>
    </View>

    <View style={styles.rule}><Text style={styles.ruleTitle}>운영 원칙</Text>
      <Text style={styles.ruleText}>홈 추천의 노출 여부·순서는 실제 원픽 수, TOP 3, 인기 집계에 반영되지 않습니다.</Text></View>
    {!!error && <Text accessibilityRole="alert" style={adminStyles.error}>{error}</Text>}
    {!!message && <Text accessibilityLiveRegion="polite" style={adminStyles.success}>{message}</Text>}

    <View style={styles.section}>
      <View style={styles.header}><View><Text style={adminStyles.sectionTitle}>현재 홈 노출 · {visible.length}</Text>
        <Text style={adminStyles.muted}>숫자가 작을수록 먼저 노출되며 홈에서는 최대 6개를 보여줍니다.</Text></View>{loading && <ActivityIndicator />}</View>
      {!loading && !visible.length ? <Text style={styles.empty}>아직 추천 원픽이 없습니다. 아래에서 기존 상품을 검색해 추가하세요.</Text> : null}
      {visible.map((f) => <FeatureRow key={f.item_id} feature={f} label={f.items ? labels.get(f.items.category_id) : undefined} onSaved={load} />)}
    </View>

    <View style={styles.section}>
      <Text style={adminStyles.sectionTitle}>추천할 기존 상품 찾기</Text>
      <Text style={adminStyles.muted}>활성·단종 상품을 검색해 홈 추천에 추가합니다.</Text>
      <View style={styles.header}>
        <TextInput accessibilityLabel="홈 추천 상품 검색" value={query} onChangeText={setQuery} onSubmitEditing={() => void search()}
          placeholder="상품명 검색" style={[adminStyles.input, styles.grow]} />
        <Pressable disabled={searching} onPress={() => void search()} style={adminStyles.secondaryButton}>
          <Text style={adminStyles.secondaryButtonText}>{searching ? '검색 중' : '검색'}</Text>
        </Pressable>
      </View>
      {candidates.map((item) => <View key={item.id} style={styles.row}>
        <View style={styles.grow}><Text style={styles.name}>{item.name}</Text>
          <Text style={adminStyles.muted}>{labels.get(item.category_id) ?? item.categories?.name ?? '카테고리 없음'} · {item.status === 'discontinued' ? '단종' : '활성'}</Text></View>
        <Pressable disabled={activeIds.has(item.id) || addingId !== null} onPress={() => void add(item)}
          style={[adminStyles.secondaryButton, (activeIds.has(item.id) || addingId !== null) && styles.disabled]}>
          <Text style={adminStyles.secondaryButtonText}>{activeIds.has(item.id) ? '추천 중' : addingId === item.id ? '추가 중' : '홈 추천에 추가'}</Text>
        </Pressable>
      </View>)}
      {!searching && !candidates.length ? <Text style={styles.empty}>검색 결과가 여기에 표시됩니다.</Text> : null}
    </View>

    {inactive.length ? <View style={styles.section}><Text style={adminStyles.sectionTitle}>비활성 추천 · {inactive.length}</Text>
      <Text style={adminStyles.muted}>이전에 추천한 항목입니다. 필요하면 다시 켤 수 있습니다.</Text>
      {inactive.map((f) => <FeatureRow key={f.item_id} feature={f} label={f.items ? labels.get(f.items.category_id) : undefined} onSaved={load} />)}
    </View> : null}
  </View>;
}

function FeatureRow({ feature, label, onSaved }: { feature: AdminEditorialFeatureWithItem; label?: string; onSaved: () => Promise<void> }) {
  const [active, setActive] = useState(feature.is_active);
  const [priority, setPriority] = useState(String(feature.priority));
  const [note, setNote] = useState(feature.note ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const item = feature.items;
  const eligible = Boolean(item && ['active', 'discontinued'].includes(item.status));

  useEffect(() => { setActive(feature.is_active); setPriority(String(feature.priority)); setNote(feature.note ?? ''); },
    [feature.is_active, feature.note, feature.priority]);

  const save = async () => {
    if (!item || saving) return;
    const order = Number.parseInt(priority, 10);
    if (!Number.isFinite(order) || order < 0 || order > 1000) { setError('노출 순서는 0~1000 사이 숫자로 입력해 주세요.'); return; }
    if (note.trim().length > 200) { setError('추천 이유는 200자 이하로 입력해 주세요.'); return; }
    setSaving(true); setError('');
    try { await setItemEditorialFeature({ itemId: item.id, isActive: active, priority: order, note: note.trim() || null }); await onSaved(); }
    catch (e) { setError(e instanceof Error ? e.message : '홈 추천 설정을 저장하지 못했습니다.'); }
    finally { setSaving(false); }
  };

  return <View style={styles.feature}>
    <View style={styles.header}><View style={styles.grow}><Text style={styles.name}>{item?.name ?? '삭제된 상품'}</Text>
      <Text style={adminStyles.muted}>{item ? (label ?? item.categories?.name ?? '카테고리 없음') : '상품 정보 없음'}{item?.status === 'discontinued' ? ' · 단종' : ''}</Text></View>
      <Pressable accessibilityRole="switch" accessibilityState={{ checked: active }} disabled={!eligible || saving}
        onPress={() => setActive((v) => !v)} style={[styles.switch, active && styles.switchOn, (!eligible || saving) && styles.disabled]}>
        <Text style={[styles.switchText, active && styles.switchTextOn]}>{active ? '노출 ON' : '노출 OFF'}</Text>
      </Pressable></View>
    <View style={styles.editor}><View style={styles.grow}><Text style={adminStyles.label}>추천 이유</Text>
      <TextInput value={note} onChangeText={setNote} editable={eligible && !saving} maxLength={200} placeholder="왜 먼저 소개하는지 짧게 적어주세요." style={adminStyles.input} /></View>
      <View style={styles.order}><Text style={adminStyles.label}>순서</Text>
        <TextInput value={priority} onChangeText={setPriority} editable={eligible && !saving} keyboardType="number-pad" style={adminStyles.input} /></View></View>
    {!eligible && <Text style={adminStyles.error}>활성 또는 단종 상품만 노출할 수 있습니다.</Text>}
    {!!error && <Text accessibilityRole="alert" style={adminStyles.error}>{error}</Text>}
    <Pressable disabled={!eligible || saving} onPress={() => void save()} style={[adminStyles.primaryButton, styles.save, (!eligible || saving) && styles.disabled]}>
      <Text style={adminStyles.primaryButtonText}>{saving ? '저장 중' : '설정 저장'}</Text></Pressable>
  </View>;
}

const styles = StyleSheet.create({
  page: { gap: 20 }, header: { flexDirection: 'row', alignItems: 'center', gap: 12, flexWrap: 'wrap' }, grow: { flex: 1, minWidth: 220 },
  rule: { borderWidth: 1, borderColor: '#DDDDF7', backgroundColor: '#FAFAFF', borderRadius: 12, padding: 16 },
  ruleTitle: { color: '#3730A3', fontSize: 13, fontWeight: '900' }, ruleText: { color: '#5B5F70', fontSize: 12, lineHeight: 18, marginTop: 5 },
  section: { backgroundColor: '#FFF', borderWidth: 1, borderColor: '#E5E7EB', borderRadius: 12, padding: 18, gap: 12 },
  empty: { color: '#9CA3AF', fontSize: 13, paddingVertical: 8 }, row: { flexDirection: 'row', alignItems: 'center', gap: 12, borderTopWidth: 1, borderTopColor: '#F0F1F3', paddingTop: 12 },
  name: { color: '#111827', fontSize: 14, fontWeight: '800' }, feature: { borderTopWidth: 1, borderTopColor: '#F0F1F3', paddingTop: 14, gap: 10 },
  editor: { flexDirection: 'row', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }, order: { width: 110 }, save: { alignSelf: 'flex-start' },
  switch: { borderWidth: 1, borderColor: '#D1D5DB', borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8 }, switchOn: { backgroundColor: '#EEF2FF', borderColor: '#A5B4FC' },
  switchText: { color: '#6B7280', fontSize: 11, fontWeight: '800' }, switchTextOn: { color: '#3730A3' }, disabled: { opacity: 0.45 },
});
