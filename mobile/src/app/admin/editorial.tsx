import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { adminStyles } from '@/components/admin/admin-shell';
import { getCategories, getEditorialCandidates, getEditorialFeatures, setItemEditorialFeature } from '@/lib/admin-api';
import type { AdminCategory, AdminEditorialFeatureWithItem, AdminItem } from '@/lib/admin-api';
import { categoryLabel } from '@/lib/categories/categoryTree';
import type { Category } from '@/types/domain/category';

const HOME_LIMIT = 6;
const RECOMMENDED_MIN = 4;
const RECOMMENDED_CATEGORY_COUNT = 3;

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

function itemHasImage(item: AdminEditorialFeatureWithItem['items'] | AdminItem | null) {
  return Boolean(item?.image_path || item?.thumbnail_path || item?.image_source_url);
}

function readinessText(input: {
  activeCount: number;
  missingReasons: number;
  missingImages: number;
  uniqueCategories: number;
  displayedCount: number;
}) {
  if (input.activeCount === 0) return '추천 원픽을 추가하면 준비 상태를 확인할 수 있습니다.';
  if (input.activeCount < RECOMMENDED_MIN) return `권장 노출 수까지 ${RECOMMENDED_MIN - input.activeCount}개 더 고르는 것을 권장합니다.`;
  if (input.activeCount > HOME_LIMIT) return `활성 추천이 ${HOME_LIMIT}개를 넘었습니다. 홈에는 앞의 ${HOME_LIMIT}개만 노출됩니다.`;
  if (input.missingReasons > 0) return `추천 이유가 없는 항목이 ${input.missingReasons}개 있습니다.`;
  if (input.missingImages > 0) return `대표 이미지가 없는 항목이 ${input.missingImages}개 있습니다.`;
  const target = Math.min(RECOMMENDED_CATEGORY_COUNT, input.displayedCount);
  if (input.uniqueCategories < target) return `세부 카테고리를 ${target}개 이상 섞으면 첫 화면이 덜 편중됩니다.`;
  return '초기 홈 추천 권장 기준을 충족했습니다.';
}

export default function AdminEditorialScreen() {
  const [features, setFeatures] = useState<AdminEditorialFeatureWithItem[]>([]);
  const [categories, setCategories] = useState<AdminCategory[]>([]);
  const [query, setQuery] = useState('');
  const [candidates, setCandidates] = useState<AdminItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [searching, setSearching] = useState(false);
  const [addingId, setAddingId] = useState<string | null>(null);
  const [movingId, setMovingId] = useState<string | null>(null);
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
  const visible = [...features.filter(visibleNow)].sort((a, b) => a.priority - b.priority || a.item_id.localeCompare(b.item_id));
  const displayed = visible.slice(0, HOME_LIMIT);
  const inactive = features.filter((f) => !visibleNow(f));
  const activeIds = new Set(visible.map((f) => f.item_id));
  const missingReasons = displayed.filter((f) => !f.note?.trim()).length;
  const missingImages = displayed.filter((f) => !itemHasImage(f.items)).length;
  const uniqueCategories = new Set(displayed.map((f) => f.items?.category_id).filter(Boolean)).size;
  const launchReady = visible.length >= RECOMMENDED_MIN && visible.length <= HOME_LIMIT
    && missingReasons === 0 && missingImages === 0
    && uniqueCategories >= Math.min(RECOMMENDED_CATEGORY_COUNT, displayed.length);
  const readiness = readinessText({
    activeCount: visible.length,
    missingReasons,
    missingImages,
    uniqueCategories,
    displayedCount: displayed.length,
  });

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
      setMessage(item.name + '을 홈 추천에 추가했습니다. 추천 이유를 입력해 주세요.');
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : '홈 추천에 추가하지 못했습니다.'); }
    finally { setAddingId(null); }
  };

  const move = async (feature: AdminEditorialFeatureWithItem, delta: -1 | 1) => {
    if (movingId) return;
    const index = visible.findIndex((entry) => entry.item_id === feature.item_id);
    const targetIndex = index + delta;
    if (index < 0 || targetIndex < 0 || targetIndex >= visible.length) return;

    const reordered = [...visible];
    [reordered[index], reordered[targetIndex]] = [reordered[targetIndex], reordered[index]];
    setMovingId(feature.item_id); setError(''); setMessage('');
    try {
      await Promise.all(reordered.map((entry, order) => setItemEditorialFeature({
        itemId: entry.item_id,
        isActive: true,
        priority: (order + 1) * 10,
        note: entry.note,
        startsAt: entry.starts_at,
        endsAt: entry.ends_at,
      })));
      const priorities = new Map(reordered.map((entry, order) => [entry.item_id, (order + 1) * 10]));
      setFeatures((current) => current.map((entry) => priorities.has(entry.item_id)
        ? { ...entry, priority: priorities.get(entry.item_id)! }
        : entry));
      setMessage('홈 추천 노출 순서를 변경했습니다.');
    } catch (e) {
      setError(e instanceof Error ? e.message : '추천 순서를 변경하지 못했습니다.');
    } finally {
      setMovingId(null);
    }
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

    <View style={[styles.readiness, launchReady && styles.readinessReady]}>
      <View style={styles.header}>
        <View style={styles.grow}>
          <Text style={styles.readinessTitle}>{launchReady ? '초기 추천 준비 완료' : '초기 추천 준비도'}</Text>
          <Text style={styles.readinessText}>{readiness}</Text>
        </View>
        <Text style={[styles.readinessState, launchReady && styles.readinessStateReady]}>{launchReady ? 'READY' : 'CHECK'}</Text>
      </View>
      <View style={styles.metricGrid}>
        <ReadinessMetric label="활성 추천" value={`${visible.length}/${HOME_LIMIT}`} hint="권장 4~6개" good={visible.length >= RECOMMENDED_MIN && visible.length <= HOME_LIMIT} />
        <ReadinessMetric label="추천 이유" value={`${displayed.length - missingReasons}/${displayed.length}`} hint="홈 노출 대상 기준" good={displayed.length > 0 && missingReasons === 0} />
        <ReadinessMetric label="대표 이미지" value={`${displayed.length - missingImages}/${displayed.length}`} hint="홈 노출 대상 기준" good={displayed.length > 0 && missingImages === 0} />
        <ReadinessMetric label="세부 카테고리" value={`${uniqueCategories}개`} hint="권장 3개 이상" good={displayed.length > 0 && uniqueCategories >= Math.min(RECOMMENDED_CATEGORY_COUNT, displayed.length)} />
      </View>
    </View>

    <View style={styles.section}>
      <View style={styles.header}><View><Text style={adminStyles.sectionTitle}>현재 홈 노출 · {visible.length}</Text>
        <Text style={adminStyles.muted}>위·아래 버튼으로 순서를 조정할 수 있습니다. 홈에서는 앞의 6개만 보여줍니다.</Text></View>{loading && <ActivityIndicator />}</View>
      {!loading && !visible.length ? <Text style={styles.empty}>아직 추천 원픽이 없습니다. 아래에서 기존 상품을 검색해 추가하세요.</Text> : null}
      {visible.map((f, index) => <FeatureRow key={f.item_id} feature={f}
        label={f.items ? labels.get(f.items.category_id) : undefined}
        rank={index + 1}
        canMoveUp={index > 0}
        canMoveDown={index < visible.length - 1}
        moving={movingId !== null}
        onMoveUp={() => void move(f, -1)}
        onMoveDown={() => void move(f, 1)}
        onSaved={load} />)}
    </View>

    <View style={styles.section}>
      <Text style={adminStyles.sectionTitle}>추천할 기존 상품 찾기</Text>
      <Text style={adminStyles.muted}>활성·단종 상품을 검색해 홈 추천에 추가합니다. 이미지가 없는 상품도 추가할 수 있지만 준비도에서 표시됩니다.</Text>
      <View style={styles.header}>
        <TextInput accessibilityLabel="홈 추천 상품 검색" value={query} onChangeText={setQuery} onSubmitEditing={() => void search()}
          placeholder="상품명 검색" style={[adminStyles.input, styles.grow]} />
        <Pressable disabled={searching} onPress={() => void search()} style={adminStyles.secondaryButton}>
          <Text style={adminStyles.secondaryButtonText}>{searching ? '검색 중' : '검색'}</Text>
        </Pressable>
      </View>
      {candidates.map((item) => <View key={item.id} style={styles.row}>
        <View style={styles.grow}><Text style={styles.name}>{item.name}</Text>
          <Text style={adminStyles.muted}>{labels.get(item.category_id) ?? item.categories?.name ?? '카테고리 없음'} · {item.status === 'discontinued' ? '단종' : '활성'}</Text>
          <View style={styles.badges}><Text style={[styles.badge, itemHasImage(item) ? styles.badgeGood : styles.badgeWarn]}>{itemHasImage(item) ? '이미지 있음' : '이미지 필요'}</Text></View>
        </View>
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

function ReadinessMetric({ label, value, hint, good }: { label: string; value: string; hint: string; good: boolean }) {
  return <View style={[styles.metric, good && styles.metricGood]}>
    <Text style={styles.metricLabel}>{label}</Text>
    <Text style={styles.metricValue}>{value}</Text>
    <Text style={styles.metricHint}>{hint}</Text>
  </View>;
}

function FeatureRow({
  feature,
  label,
  rank,
  canMoveUp = false,
  canMoveDown = false,
  moving = false,
  onMoveUp,
  onMoveDown,
  onSaved,
}: {
  feature: AdminEditorialFeatureWithItem;
  label?: string;
  rank?: number;
  canMoveUp?: boolean;
  canMoveDown?: boolean;
  moving?: boolean;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  onSaved: () => Promise<void>;
}) {
  const [active, setActive] = useState(feature.is_active);
  const [priority, setPriority] = useState(String(feature.priority));
  const [note, setNote] = useState(feature.note ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const item = feature.items;
  const eligible = Boolean(item && ['active', 'discontinued'].includes(item.status));
  const hasImage = itemHasImage(item);

  useEffect(() => {
    setActive(feature.is_active);
    setPriority(String(feature.priority));
    setNote(feature.note ?? '');
  }, [feature.item_id, feature.updated_at]);

  const save = async () => {
    if (!item || saving) return;
    const order = Number.parseInt(priority, 10);
    if (!Number.isFinite(order) || order < 0 || order > 1000) { setError('노출 순서는 0~1000 사이 숫자로 입력해 주세요.'); return; }
    if (note.trim().length > 200) { setError('추천 이유는 200자 이하로 입력해 주세요.'); return; }
    setSaving(true); setError('');
    const expiredEnd = feature.ends_at && Date.parse(feature.ends_at) <= Date.now();
    try {
      await setItemEditorialFeature({
        itemId: item.id,
        isActive: active,
        priority: order,
        note: note.trim() || null,
        startsAt: feature.starts_at,
        endsAt: active && expiredEnd ? null : feature.ends_at,
      });
      await onSaved();
    } catch (e) { setError(e instanceof Error ? e.message : '홈 추천 설정을 저장하지 못했습니다.'); }
    finally { setSaving(false); }
  };

  return <View style={styles.feature}>
    <View style={styles.header}>
      {rank ? <Text style={styles.rank}>#{rank}</Text> : null}
      <View style={styles.grow}><Text style={styles.name}>{item?.name ?? '삭제된 상품'}</Text>
        <Text style={adminStyles.muted}>{item ? (label ?? item.categories?.name ?? '카테고리 없음') : '상품 정보 없음'}{item?.status === 'discontinued' ? ' · 단종' : ''}</Text>
        <View style={styles.badges}>
          <Text style={[styles.badge, note.trim() ? styles.badgeGood : styles.badgeWarn]}>{note.trim() ? '추천 이유 있음' : '추천 이유 필요'}</Text>
          <Text style={[styles.badge, hasImage ? styles.badgeGood : styles.badgeWarn]}>{hasImage ? '이미지 있음' : '이미지 필요'}</Text>
        </View>
      </View>
      {rank ? <View style={styles.orderButtons}>
        <Pressable accessibilityRole="button" accessibilityLabel={`${item?.name ?? '상품'} 위로 이동`} disabled={!canMoveUp || moving}
          onPress={onMoveUp} style={[styles.moveButton, (!canMoveUp || moving) && styles.disabled]}><Text style={styles.moveText}>↑</Text></Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel={`${item?.name ?? '상품'} 아래로 이동`} disabled={!canMoveDown || moving}
          onPress={onMoveDown} style={[styles.moveButton, (!canMoveDown || moving) && styles.disabled]}><Text style={styles.moveText}>↓</Text></Pressable>
      </View> : null}
      <Pressable accessibilityRole="switch" accessibilityState={{ checked: active }} disabled={!eligible || saving}
        onPress={() => setActive((v) => !v)} style={[styles.switch, active && styles.switchOn, (!eligible || saving) && styles.disabled]}>
        <Text style={[styles.switchText, active && styles.switchTextOn]}>{active ? '노출 ON' : '노출 OFF'}</Text>
      </Pressable>
    </View>
    <View style={styles.editor}><View style={styles.grow}><Text style={adminStyles.label}>추천 이유</Text>
      <TextInput value={note} onChangeText={setNote} editable={eligible && !saving} maxLength={200} placeholder="왜 먼저 소개하는지 짧게 적어주세요." style={adminStyles.input} /></View>
      <View style={styles.order}><Text style={adminStyles.label}>순서 값</Text>
        <TextInput value={priority} onChangeText={setPriority} editable={eligible && !saving} keyboardType="number-pad" style={adminStyles.input} /></View></View>
    {!eligible && <Text style={adminStyles.error}>활성 또는 단종 상품만 노출할 수 있습니다.</Text>}
    {!!error && <Text accessibilityRole="alert" style={adminStyles.error}>{error}</Text>}
    <Pressable disabled={!eligible || saving} onPress={() => void save()} style={[adminStyles.primaryButton, styles.save, (!eligible || saving) && styles.disabled]}>
      <Text style={adminStyles.primaryButtonText}>{saving ? '저장 중' : '설정 저장'}</Text></Pressable>
  </View>;
}

const styles = StyleSheet.create({
  page: { gap: 20 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, flexWrap: 'wrap' },
  grow: { flex: 1, minWidth: 220 },
  rule: { borderWidth: 1, borderColor: '#DDDDF7', backgroundColor: '#FAFAFF', borderRadius: 12, padding: 16 },
  ruleTitle: { color: '#3730A3', fontSize: 13, fontWeight: '900' },
  ruleText: { color: '#5B5F70', fontSize: 12, lineHeight: 18, marginTop: 5 },
  readiness: { borderWidth: 1, borderColor: '#E5E7EB', backgroundColor: '#FFFFFF', borderRadius: 12, padding: 18, gap: 14 },
  readinessReady: { borderColor: '#B7DEC6', backgroundColor: '#F7FCF9' },
  readinessTitle: { color: '#111827', fontSize: 16, fontWeight: '900' },
  readinessText: { color: '#6B7280', fontSize: 12, lineHeight: 18, marginTop: 5 },
  readinessState: { color: '#92400E', backgroundColor: '#FFF7ED', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6, fontSize: 10, fontWeight: '900' },
  readinessStateReady: { color: '#166534', backgroundColor: '#ECFDF3' },
  metricGrid: { flexDirection: 'row', gap: 10, flexWrap: 'wrap' },
  metric: { flexGrow: 1, flexBasis: 150, borderWidth: 1, borderColor: '#E5E7EB', borderRadius: 10, padding: 12 },
  metricGood: { borderColor: '#B7DEC6', backgroundColor: '#F7FCF9' },
  metricLabel: { color: '#6B7280', fontSize: 10, fontWeight: '800' },
  metricValue: { color: '#111827', fontSize: 19, fontWeight: '900', marginTop: 5 },
  metricHint: { color: '#9CA3AF', fontSize: 10, marginTop: 3 },
  section: { backgroundColor: '#FFF', borderWidth: 1, borderColor: '#E5E7EB', borderRadius: 12, padding: 18, gap: 12 },
  empty: { color: '#9CA3AF', fontSize: 13, paddingVertical: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, borderTopWidth: 1, borderTopColor: '#F0F1F3', paddingTop: 12 },
  name: { color: '#111827', fontSize: 14, fontWeight: '800' },
  feature: { borderTopWidth: 1, borderTopColor: '#F0F1F3', paddingTop: 14, gap: 10 },
  rank: { color: '#4F46E5', fontSize: 13, fontWeight: '900', minWidth: 28 },
  badges: { flexDirection: 'row', gap: 6, flexWrap: 'wrap', marginTop: 6 },
  badge: { borderRadius: 999, paddingHorizontal: 8, paddingVertical: 4, fontSize: 9, fontWeight: '800' },
  badgeGood: { color: '#166534', backgroundColor: '#ECFDF3' },
  badgeWarn: { color: '#92400E', backgroundColor: '#FFF7ED' },
  orderButtons: { flexDirection: 'row', gap: 5 },
  moveButton: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#D1D5DB', borderRadius: 8, backgroundColor: '#FFFFFF' },
  moveText: { color: '#374151', fontSize: 16, fontWeight: '900' },
  editor: { flexDirection: 'row', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' },
  order: { width: 110 },
  save: { alignSelf: 'flex-start' },
  switch: { borderWidth: 1, borderColor: '#D1D5DB', borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8 },
  switchOn: { backgroundColor: '#EEF2FF', borderColor: '#A5B4FC' },
  switchText: { color: '#6B7280', fontSize: 11, fontWeight: '800' },
  switchTextOn: { color: '#3730A3' },
  disabled: { opacity: 0.45 },
});
