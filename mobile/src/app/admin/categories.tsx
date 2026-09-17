import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { adminStyles } from '@/components/admin/admin-shell';
import { createCategory, getCategories, updateCategory } from '@/lib/admin-api';
import type { AdminCategory } from '@/lib/admin-api';

const STATUSES: AdminCategory['status'][] = ['draft', 'open', 'paused', 'closed'];

export default function AdminCategoriesScreen() {
  const [categories, setCategories] = useState<AdminCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [newName, setNewName] = useState('');
  const [newSlug, setNewSlug] = useState('');
  const [creating, setCreating] = useState(false);

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      setCategories(await getCategories());
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '카테고리를 불러오지 못했습니다.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const addCategory = async () => {
    const name = newName.trim();
    const slug = newSlug.trim().toLowerCase();
    if (!name || !slug) {
      setError('카테고리명과 slug를 모두 입력해 주세요.');
      return;
    }
    if (!/^[a-z0-9-]+$/.test(slug)) {
      setError('slug는 영문 소문자, 숫자, 하이픈만 사용할 수 있습니다.');
      return;
    }

    setCreating(true);
    setError('');
    setMessage('');
    try {
      await createCategory({ name, slug });
      setNewName('');
      setNewSlug('');
      setMessage(`${name} 카테고리를 draft 상태로 추가했습니다.`);
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '카테고리를 추가하지 못했습니다.');
    } finally {
      setCreating(false);
    }
  };

  return (
    <View style={styles.page}>
      <View>
        <Text style={adminStyles.pageTitle}>카테고리</Text>
        <Text style={adminStyles.pageDescription}>노출 여부, Pick 가능 여부, 상태와 정렬 순서를 관리합니다.</Text>
      </View>

      <View style={adminStyles.card}>
        <Text style={adminStyles.sectionTitle}>카테고리 추가</Text>
        <Text style={[adminStyles.muted, { marginTop: 6 }]}>새 카테고리는 안전하게 draft · 비노출 상태로 생성됩니다.</Text>
        <View style={styles.addRow}>
          <TextInput accessibilityLabel="새 카테고리 이름" value={newName} onChangeText={setNewName} placeholder="예: 라면" style={[adminStyles.input, styles.addInput]} />
          <TextInput accessibilityLabel="새 카테고리 slug" autoCapitalize="none" value={newSlug} onChangeText={setNewSlug} placeholder="예: ramyeon" style={[adminStyles.input, styles.addInput]} />
          <Pressable disabled={creating} onPress={addCategory} style={[adminStyles.primaryButton, creating && { opacity: 0.5 }]}>
            <Text style={adminStyles.primaryButtonText}>{creating ? '추가 중' : '추가'}</Text>
          </Pressable>
        </View>
      </View>

      {!!error && <Text accessibilityRole="alert" style={adminStyles.error}>{error}</Text>}
      {!!message && <Text accessibilityLiveRegion="polite" style={adminStyles.success}>{message}</Text>}

      <View style={adminStyles.card}>
        <View style={styles.sectionHeader}>
          <Text style={adminStyles.sectionTitle}>전체 카테고리 · {categories.length}</Text>
          <Pressable disabled={loading} onPress={load} style={adminStyles.secondaryButton}>
            <Text style={adminStyles.secondaryButtonText}>새로고침</Text>
          </Pressable>
        </View>

        {loading && <View style={styles.loading}><ActivityIndicator /><Text style={adminStyles.muted}>불러오는 중...</Text></View>}
        {!loading && categories.length === 0 && <Text style={styles.empty}>등록된 카테고리가 없습니다.</Text>}
        {!loading && categories.map((category) => (
          <CategoryRow
            key={category.id}
            category={category}
            onSaved={(next) => {
              setCategories((items) => items.map((item) => item.id === next.id ? next : item));
              setMessage(`${next.name} 카테고리를 저장했습니다.`);
              setError('');
            }}
            onError={setError}
          />
        ))}
      </View>
    </View>
  );
}

function CategoryRow({ category, onSaved, onError }: { category: AdminCategory; onSaved: (value: AdminCategory) => void; onError: (message: string) => void }) {
  const [name, setName] = useState(category.name);
  const [status, setStatus] = useState(category.status);
  const [visible, setVisible] = useState(category.is_visible);
  const [pickable, setPickable] = useState(category.is_pickable);
  const [sortOrder, setSortOrder] = useState(String(category.sort_order));
  const [saving, setSaving] = useState(false);

  const cycleStatus = () => {
    const index = STATUSES.indexOf(status);
    setStatus(STATUSES[(index + 1) % STATUSES.length]);
  };

  const save = async () => {
    const order = Number.parseInt(sortOrder, 10);
    if (!name.trim()) {
      onError('카테고리명은 비워둘 수 없습니다.');
      return;
    }
    if (!Number.isFinite(order)) {
      onError('정렬 순서는 숫자로 입력해 주세요.');
      return;
    }

    setSaving(true);
    onError('');
    try {
      const result = await updateCategory(category.id, {
        name: name.trim(),
        status,
        is_visible: visible,
        is_pickable: pickable,
        sort_order: order,
      });
      if (result[0]) onSaved(result[0]);
    } catch (caught) {
      onError(caught instanceof Error ? caught.message : '카테고리를 저장하지 못했습니다.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={styles.categoryRow}>
      <View style={styles.nameArea}>
        <TextInput accessibilityLabel={`${category.name} 이름`} value={name} onChangeText={setName} style={[adminStyles.input, styles.nameInput]} />
        <Text style={styles.slug}>{category.slug}</Text>
      </View>

      <Pressable onPress={cycleStatus} style={styles.pill}>
        <Text style={styles.pillText}>{status}</Text>
      </Pressable>

      <Toggle label="노출" value={visible} onPress={() => setVisible((value) => !value)} />
      <Toggle label="Pick" value={pickable} onPress={() => setPickable((value) => !value)} />

      <View style={styles.orderArea}>
        <Text style={styles.smallLabel}>순서</Text>
        <TextInput accessibilityLabel={`${category.name} 정렬 순서`} keyboardType="number-pad" value={sortOrder} onChangeText={setSortOrder} style={[adminStyles.input, styles.orderInput]} />
      </View>

      <Pressable disabled={saving} onPress={save} style={[adminStyles.secondaryButton, saving && { opacity: 0.5 }]}>
        <Text style={adminStyles.secondaryButtonText}>{saving ? '저장 중' : '저장'}</Text>
      </Pressable>
    </View>
  );
}

function Toggle({ label, value, onPress }: { label: string; value: boolean; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="switch" accessibilityState={{ checked: value }} onPress={onPress} style={styles.toggleWrap}>
      <Text style={styles.smallLabel}>{label}</Text>
      <View style={[styles.toggle, value && styles.toggleOn]}>
        <View style={[styles.toggleKnob, value && styles.toggleKnobOn]} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  page: { gap: 22 },
  addRow: { marginTop: 16, flexDirection: 'row', gap: 10, flexWrap: 'wrap', alignItems: 'center' },
  addInput: { flexGrow: 1, flexBasis: 210 },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 10 },
  loading: { minHeight: 90, alignItems: 'center', justifyContent: 'center', gap: 10 },
  empty: { color: '#9CA3AF', fontSize: 13, paddingVertical: 28 },
  categoryRow: { borderTopWidth: 1, borderTopColor: '#F0F1F3', paddingVertical: 14, flexDirection: 'row', alignItems: 'center', gap: 12, flexWrap: 'wrap' },
  nameArea: { flexGrow: 1, flexBasis: 230, minWidth: 210 },
  nameInput: { width: '100%' },
  slug: { marginTop: 5, color: '#9CA3AF', fontSize: 11 },
  pill: { minHeight: 36, justifyContent: 'center', paddingHorizontal: 11, borderRadius: 18, backgroundColor: '#F3F4F6' },
  pillText: { color: '#374151', fontSize: 12, fontWeight: '700' },
  toggleWrap: { alignItems: 'center', gap: 5 },
  smallLabel: { color: '#6B7280', fontSize: 10, fontWeight: '700' },
  toggle: { width: 38, height: 22, borderRadius: 11, backgroundColor: '#D1D5DB', padding: 3 },
  toggleOn: { backgroundColor: '#111827' },
  toggleKnob: { width: 16, height: 16, borderRadius: 8, backgroundColor: '#FFFFFF' },
  toggleKnobOn: { marginLeft: 16 },
  orderArea: { alignItems: 'center', gap: 4 },
  orderInput: { width: 68, textAlign: 'center' },
});
