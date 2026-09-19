import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { adminStyles } from '@/components/admin/admin-shell';
import { createBrand, getBrands, updateBrand } from '@/lib/admin-api';
import type { AdminBrand } from '@/lib/admin-api';

export default function AdminBrandsScreen() {
  const [brands, setBrands] = useState<AdminBrand[]>([]);
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
      setBrands(await getBrands());
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '브랜드를 불러오지 못했습니다.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const addBrand = async () => {
    const name = newName.trim();
    if (!name) {
      setError('브랜드 이름을 입력해 주세요.');
      return;
    }

    setCreating(true);
    setError('');
    setMessage('');
    try {
      const result = await createBrand({ name, slug: newSlug.trim() || null });
      if (result[0]) {
        const created = result[0];
        setBrands((current) => [...current, created].sort((a, b) => a.name.localeCompare(b.name, 'ko')));
      }
      setNewName('');
      setNewSlug('');
      setMessage(`${name} 브랜드를 추가했습니다.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '브랜드를 추가하지 못했습니다.');
    } finally {
      setCreating(false);
    }
  };

  const toggleActive = async (brand: AdminBrand) => {
    setError('');
    try {
      const result = await updateBrand(brand.id, { is_active: !brand.is_active });
      if (result[0]) setBrands((current) => current.map((item) => item.id === result[0].id ? result[0] : item));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '브랜드 상태를 변경하지 못했습니다.');
    }
  };

  return (
    <View style={styles.page}>
      <View>
        <Text style={adminStyles.pageTitle}>브랜드</Text>
        <Text style={adminStyles.pageDescription}>상품 등록에 사용할 브랜드를 추가하고 활성 상태를 관리합니다.</Text>
      </View>

      <View style={adminStyles.card}>
        <Text style={adminStyles.sectionTitle}>브랜드 추가</Text>
        <Text style={[adminStyles.muted, { marginTop: 6 }]}>새 브랜드는 활성 상태로 생성되어 바로 상품 등록에 사용할 수 있습니다.</Text>
        <View style={styles.addRow}>
          <TextInput accessibilityLabel="새 브랜드 이름" value={newName} onChangeText={setNewName} placeholder="예: 농심" style={[adminStyles.input, styles.addInput]} />
          <TextInput accessibilityLabel="새 브랜드 slug" autoCapitalize="none" value={newSlug} onChangeText={setNewSlug} placeholder="영문 식별자 · 선택" style={[adminStyles.input, styles.addInput]} />
          <Pressable disabled={creating} onPress={addBrand} style={[adminStyles.primaryButton, creating && { opacity: 0.5 }]}>
            <Text style={adminStyles.primaryButtonText}>{creating ? '추가 중' : '추가'}</Text>
          </Pressable>
        </View>
      </View>

      {!!error && <Text accessibilityRole="alert" style={adminStyles.error}>{error}</Text>}
      {!!message && <Text accessibilityLiveRegion="polite" style={adminStyles.success}>{message}</Text>}

      <View style={adminStyles.card}>
        <View style={styles.sectionHeader}>
          <Text style={adminStyles.sectionTitle}>전체 브랜드 · {brands.length}</Text>
          <Pressable disabled={loading} onPress={load} style={adminStyles.secondaryButton}>
            <Text style={adminStyles.secondaryButtonText}>새로고침</Text>
          </Pressable>
        </View>

        {loading && <View style={styles.loading}><ActivityIndicator /><Text style={adminStyles.muted}>불러오는 중...</Text></View>}
        {!loading && brands.length === 0 && <Text style={styles.empty}>등록된 브랜드가 없습니다.</Text>}
        {!loading && brands.map((brand) => (
          <View key={brand.id} style={styles.brandRow}>
            <View style={styles.nameArea}>
              <Text style={styles.name}>{brand.name}</Text>
              <Text style={styles.slug}>{brand.slug ?? '식별자 없음'}</Text>
            </View>
            <Pressable onPress={() => toggleActive(brand)} style={[styles.pill, brand.is_active && styles.pillActive]}>
              <Text style={[styles.pillText, brand.is_active && styles.pillTextActive]}>{brand.is_active ? '활성' : '비활성'}</Text>
            </Pressable>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { gap: 22 },
  addRow: { marginTop: 16, flexDirection: 'row', gap: 10, flexWrap: 'wrap', alignItems: 'center' },
  addInput: { flexGrow: 1, flexBasis: 210 },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 10 },
  loading: { minHeight: 90, alignItems: 'center', justifyContent: 'center', gap: 10 },
  empty: { color: '#9CA3AF', fontSize: 13, paddingVertical: 28 },
  brandRow: { borderTopWidth: 1, borderTopColor: '#F0F1F3', paddingVertical: 14, flexDirection: 'row', alignItems: 'center', gap: 12, flexWrap: 'wrap' },
  nameArea: { flexGrow: 1, flexBasis: 230, minWidth: 210 },
  name: { color: '#111827', fontSize: 14, fontWeight: '700' },
  slug: { marginTop: 4, color: '#9CA3AF', fontSize: 11 },
  pill: { minHeight: 34, justifyContent: 'center', paddingHorizontal: 12, borderRadius: 17, backgroundColor: '#F3F4F6' },
  pillActive: { backgroundColor: '#ECFDF3' },
  pillText: { color: '#6B7280', fontSize: 12, fontWeight: '700' },
  pillTextActive: { color: '#2F6B45' },
});
