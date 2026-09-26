import { Image } from 'expo-image';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { adminStyles } from '@/components/admin/admin-shell';
import { brandLogoUrl, chooseBrandLogo, removeBrandLogo, saveBrandLogo } from '@/lib/admin/brandLogo';
import { createBrand, getBrands, updateBrand } from '@/lib/admin-api';
import type { AdminBrand } from '@/lib/admin-api';
import { OnePick } from '@/constants/onepick';

export function BrandsPanel() {
  const [brands, setBrands] = useState<AdminBrand[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [newName, setNewName] = useState('');
  const [newSlug, setNewSlug] = useState('');
  const [creating, setCreating] = useState(false);
  const [logoBusyId, setLogoBusyId] = useState<string | null>(null);

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
      await createBrand({ name, slug: newSlug.trim() || null });
      setNewName('');
      setNewSlug('');
      setMessage(`${name} 브랜드를 추가했습니다.`);
      await load();
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

  const replaceBrand = (next: AdminBrand | undefined) => {
    if (next) setBrands((current) => current.map((item) => item.id === next.id ? next : item));
  };

  const changeLogo = async (brand: AdminBrand) => {
    setError('');
    setMessage('');
    try {
      const logo = await chooseBrandLogo();
      if (!logo) return;
      setLogoBusyId(brand.id);
      replaceBrand((await saveBrandLogo(brand.id, logo, brand.logo_path))[0]);
      setMessage(`${brand.name} 로고를 저장했습니다.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '로고를 저장하지 못했습니다.');
    } finally {
      setLogoBusyId(null);
    }
  };

  const clearLogo = async (brand: AdminBrand) => {
    if (!brand.logo_path) return;
    setError('');
    setMessage('');
    setLogoBusyId(brand.id);
    try {
      replaceBrand((await removeBrandLogo(brand.id, brand.logo_path))[0]);
      setMessage(`${brand.name} 로고를 삭제했습니다.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '로고를 삭제하지 못했습니다.');
    } finally {
      setLogoBusyId(null);
    }
  };

  return (
    <View style={styles.page}>
      <View style={adminStyles.card}>
        <Text style={adminStyles.sectionTitle}>브랜드 추가</Text>
        <Text style={[adminStyles.muted, { marginTop: 6 }]}>새 브랜드는 활성 상태로 생성되어 바로 상품 등록에 사용할 수 있습니다. 로고는 추가한 뒤 목록에서 등록합니다. 메뉴 사진이 없는 카드에는 로고가 대신 보입니다.</Text>
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
            <View style={styles.logoBox}>
              {brand.logo_path
                ? <Image source={{ uri: brandLogoUrl(brand.logo_path)! }} accessibilityLabel={`${brand.name} 로고`} style={styles.logoImage} contentFit="contain" />
                : <Text style={styles.logoEmpty}>로고 없음</Text>}
            </View>
            <View style={styles.nameArea}>
              <Text style={styles.name}>{brand.name}</Text>
              <Text style={styles.slug}>{brand.slug ?? '식별자 없음'}</Text>
            </View>
            <Pressable disabled={logoBusyId === brand.id} onPress={() => changeLogo(brand)} accessibilityLabel={`${brand.name} 로고 ${brand.logo_path ? '변경' : '등록'}`}
              style={[adminStyles.secondaryButton, logoBusyId === brand.id && { opacity: 0.5 }]}>
              <Text style={adminStyles.secondaryButtonText}>{logoBusyId === brand.id ? '저장 중' : brand.logo_path ? '로고 변경' : '로고 등록'}</Text>
            </Pressable>
            {brand.logo_path ? <Pressable disabled={logoBusyId === brand.id} onPress={() => clearLogo(brand)} accessibilityLabel={`${brand.name} 로고 삭제`}
              style={[adminStyles.secondaryButton, logoBusyId === brand.id && { opacity: 0.5 }]}>
              <Text style={adminStyles.secondaryButtonText}>로고 삭제</Text>
            </Pressable> : null}
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
  empty: { color: OnePick.hint, fontSize: 13, paddingVertical: 28 },
  brandRow: { borderTopWidth: 1, borderTopColor: OnePick.sunken, paddingVertical: 14, flexDirection: 'row', alignItems: 'center', gap: 12, flexWrap: 'wrap' },
  logoBox: { width: 48, height: 48, borderRadius: 10, borderWidth: 1, borderColor: OnePick.border, backgroundColor: '#FFFFFF', padding: 4, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  logoImage: { width: '100%', height: '100%' },
  logoEmpty: { color: OnePick.hint, fontSize: 10, textAlign: 'center' },
  nameArea: { flexGrow: 1, flexBasis: 230, minWidth: 210 },
  name: { color: OnePick.text, fontSize: 14, fontWeight: '700' },
  slug: { marginTop: 4, color: OnePick.hint, fontSize: 11 },
  pill: { minHeight: 34, justifyContent: 'center', paddingHorizontal: 12, borderRadius: 17, backgroundColor: OnePick.sunken },
  pillActive: { backgroundColor: OnePick.successSoft },
  pillText: { color: OnePick.muted, fontSize: 12, fontWeight: '700' },
  pillTextActive: { color: OnePick.success },
});
