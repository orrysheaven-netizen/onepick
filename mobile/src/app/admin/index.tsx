import { useMemo, useState } from 'react';
import { useRouter } from 'expo-router';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAdminAccess, useAdminActions, useAdminDashboard } from '@/hooks/useAdmin';
import { useAuthSession } from '@/hooks/useAuthSession';
import type { Category } from '@/types/domain/category';
import type { Product } from '@/types/domain/product';

function categoryPath(category: Category, categories: Category[]) {
  const parent = category.parentId ? categories.find((item) => item.id === category.parentId) : null;
  return parent ? `${parent.name} > ${category.name}` : category.name;
}

function similarProducts(product: Product, products: Product[]) {
  const needle = product.normalizedName.toLowerCase();
  return products
    .filter((item) =>
      item.id !== product.id &&
      item.categoryId === product.categoryId &&
      (item.status === 'active' || item.status === 'discontinued'),
    )
    .map((item) => ({
      item,
      score: item.normalizedName === needle
        ? 0
        : item.normalizedName.includes(needle) || needle.includes(item.normalizedName)
          ? 1
          : 2,
    }))
    .sort((a, b) => a.score - b.score || a.item.name.localeCompare(b.item.name))
    .slice(0, 3)
    .map(({ item }) => item);
}

function Section({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {description ? <Text style={styles.sectionDescription}>{description}</Text> : null}
      {children}
    </View>
  );
}

export default function AdminScreen() {
  const router = useRouter();
  const auth = useAuthSession();
  const access = useAdminAccess(Boolean(auth.user));
  const dashboard = useAdminDashboard(Boolean(auth.user && access.data));
  const actions = useAdminActions();

  const [productName, setProductName] = useState('');
  const [productCategoryId, setProductCategoryId] = useState('');
  const [productBrandId, setProductBrandId] = useState<string | null>(null);
  const [productUrl, setProductUrl] = useState('');

  const [categoryName, setCategoryName] = useState('');
  const [categorySlug, setCategorySlug] = useState('');
  const [categoryParentId, setCategoryParentId] = useState<string | null>(null);
  const [categoryVisible, setCategoryVisible] = useState(true);
  const [categoryPickable, setCategoryPickable] = useState(true);

  const [brandName, setBrandName] = useState('');
  const [brandSlug, setBrandSlug] = useState('');

  const data = dashboard.data;
  const categories = data?.categories ?? [];
  const brands = data?.brands ?? [];
  const products = data?.products ?? [];
  const leafCategories = useMemo(
    () => categories.filter((category) => !categories.some((item) => item.parentId === category.id)),
    [categories],
  );

  const busy = actions.approveProduct.isPending || actions.rejectProduct.isPending ||
    actions.mergeProduct.isPending || actions.createProduct.isPending ||
    actions.createCategory.isPending || actions.createBrand.isPending;

  const submitProduct = async () => {
    if (!productName.trim() || !productCategoryId || busy) return;
    try {
      await actions.createProduct.mutateAsync({
        name: productName,
        categoryId: productCategoryId,
        brandId: productBrandId,
        officialUrl: productUrl.trim() || null,
        status: 'active',
      });
      setProductName('');
      setProductUrl('');
    } catch {
      // Mutation state is rendered below.
    }
  };

  const submitCategory = async () => {
    if (!categoryName.trim() || !categorySlug.trim() || busy) return;
    try {
      await actions.createCategory.mutateAsync({
        name: categoryName,
        slug: categorySlug,
        parentId: categoryParentId,
        status: 'open',
        isVisible: categoryVisible,
        isPickable: categoryPickable,
      });
      setCategoryName('');
      setCategorySlug('');
    } catch {
      // Mutation state is rendered below.
    }
  };

  const submitBrand = async () => {
    if (!brandName.trim() || busy) return;
    try {
      await actions.createBrand.mutateAsync({
        name: brandName,
        slug: brandSlug.trim() || null,
        isActive: true,
      });
      setBrandName('');
      setBrandSlug('');
    } catch {
      // Mutation state is rendered below.
    }
  };

  if (auth.isLoading) {
    return <SafeAreaView style={styles.safe}><View style={styles.center}><ActivityIndicator /><Text style={styles.muted}>로그인 상태를 확인하고 있어요</Text></View></SafeAreaView>;
  }

  if (!auth.user) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.center}>
          <Text style={styles.centerTitle}>관리자 로그인이 필요합니다</Text>
          <Pressable style={styles.primary} onPress={() => router.push('/auth/login')}><Text style={styles.primaryText}>로그인</Text></Pressable>
        </View>
      </SafeAreaView>
    );
  }

  if (access.isPending) {
    return <SafeAreaView style={styles.safe}><View style={styles.center}><ActivityIndicator /><Text style={styles.muted}>관리자 권한을 확인하고 있어요</Text></View></SafeAreaView>;
  }

  if (access.isError || access.data !== true) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.center}>
          <Text style={styles.centerTitle}>관리자만 사용할 수 있습니다</Text>
          <Text style={styles.muted}>제품과 카테고리 기준 데이터는 관리자 권한으로만 변경됩니다.</Text>
          <Pressable style={styles.secondary} onPress={() => router.replace('/')}><Text style={styles.secondaryText}>홈으로</Text></Pressable>
        </View>
      </SafeAreaView>
    );
  }

  if (dashboard.isPending || !data) {
    return <SafeAreaView style={styles.safe}><View style={styles.center}><ActivityIndicator /><Text style={styles.muted}>관리 데이터를 불러오고 있어요</Text></View></SafeAreaView>;
  }

  if (dashboard.isError) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.center}>
          <Text style={styles.centerTitle}>관리 데이터를 불러오지 못했습니다</Text>
          <Pressable style={styles.secondary} onPress={() => void dashboard.refetch()}><Text style={styles.secondaryText}>다시 불러오기</Text></Pressable>
        </View>
      </SafeAreaView>
    );
  }

  const actionError = actions.approveProduct.error || actions.rejectProduct.error || actions.mergeProduct.error ||
    actions.createProduct.error || actions.createCategory.error || actions.createBrand.error;

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.topRow}>
          <Pressable onPress={() => router.canGoBack() ? router.back() : router.replace('/')}><Text style={styles.back}>‹</Text></Pressable>
          <View style={styles.topCopy}>
            <Text style={styles.kicker}>ONEPICK ADMIN</Text>
            <Text style={styles.title}>기준 데이터 관리</Text>
          </View>
        </View>
        <Text style={styles.intro}>정식 제품은 관리자 승인 후에만 원픽으로 선택할 수 있습니다.</Text>

        {actionError ? <View style={styles.errorBox}><Text style={styles.errorText}>처리하지 못했습니다. 입력값과 중복 데이터를 확인해주세요.</Text></View> : null}

        <Section
          title={`승인 대기 제품 ${data.pending.length}개`}
          description="사용자가 찾지 못한 제품을 요청하면 여기에 쌓입니다. 기존 제품과 같으면 새로 만들지 말고 연결하세요.">
          {data.pending.length === 0 ? <Text style={styles.empty}>현재 승인 대기 제품이 없습니다.</Text> : null}
          {data.pending.map(({ product, submitter }) => {
            const category = categories.find((item) => item.id === product.categoryId);
            const candidates = similarProducts(product, products);
            return (
              <View key={product.id} style={styles.reviewCard}>
                <Text style={styles.productName}>{product.name}</Text>
                <Text style={styles.meta}>{category ? categoryPath(category, categories) : '카테고리 미확인'} · {submitter ? `@${submitter.username}` : '요청자 미확인'}</Text>
                {product.imageUrl ? <Text style={styles.meta}>대표 이미지 제출됨</Text> : null}

                {candidates.length > 0 ? (
                  <View style={styles.candidates}>
                    <Text style={styles.smallTitle}>기존 제품 후보</Text>
                    {candidates.map((candidate) => (
                      <Pressable
                        key={candidate.id}
                        disabled={busy}
                        onPress={() => void actions.mergeProduct.mutateAsync({ productId: product.id, targetProductId: candidate.id }).catch(() => {})}
                        style={({ pressed }) => [styles.candidate, pressed && styles.pressed]}>
                        <Text style={styles.candidateName}>{candidate.name}</Text>
                        <Text style={styles.link}>이 제품과 연결</Text>
                      </Pressable>
                    ))}
                  </View>
                ) : <Text style={styles.meta}>비슷한 기존 제품 후보가 없습니다.</Text>}

                <View style={styles.actionsRow}>
                  <Pressable disabled={busy} style={[styles.approveButton, busy && styles.disabled]} onPress={() => void actions.approveProduct.mutateAsync({ productId: product.id }).catch(() => {})}>
                    <Text style={styles.approveText}>새 제품으로 승인</Text>
                  </Pressable>
                  <Pressable disabled={busy} style={[styles.rejectButton, busy && styles.disabled]} onPress={() => void actions.rejectProduct.mutateAsync(product.id).catch(() => {})}>
                    <Text style={styles.rejectText}>거절</Text>
                  </Pressable>
                </View>
              </View>
            );
          })}
        </Section>

        <Section title="정식 제품 직접 등록" description="MVP 기준 제품은 관리자가 직접 등록합니다. 제품을 선택하면 카테고리는 이 데이터에서 자동으로 따라갑니다.">
          <Text style={styles.fieldLabel}>제품명</Text>
          <TextInput style={styles.input} value={productName} onChangeText={setProductName} placeholder="예: 신라면" />

          <Text style={styles.fieldLabel}>카테고리</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
            {leafCategories.map((category) => (
              <Pressable key={category.id} onPress={() => setProductCategoryId(category.id)} style={[styles.chip, productCategoryId === category.id && styles.chipActive]}>
                <Text style={[styles.chipText, productCategoryId === category.id && styles.chipTextActive]}>{categoryPath(category, categories)}</Text>
              </Pressable>
            ))}
          </ScrollView>

          <Text style={styles.fieldLabel}>브랜드 · 선택</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
            <Pressable onPress={() => setProductBrandId(null)} style={[styles.chip, productBrandId === null && styles.chipActive]}><Text style={[styles.chipText, productBrandId === null && styles.chipTextActive]}>없음</Text></Pressable>
            {brands.filter((brand) => brand.isActive).map((brand) => (
              <Pressable key={brand.id} onPress={() => setProductBrandId(brand.id)} style={[styles.chip, productBrandId === brand.id && styles.chipActive]}>
                <Text style={[styles.chipText, productBrandId === brand.id && styles.chipTextActive]}>{brand.name}</Text>
              </Pressable>
            ))}
          </ScrollView>

          <Text style={styles.fieldLabel}>공식 제품 URL · 선택</Text>
          <TextInput style={styles.input} value={productUrl} onChangeText={setProductUrl} placeholder="https://..." autoCapitalize="none" keyboardType="url" />
          <Pressable disabled={!productName.trim() || !productCategoryId || busy} style={[styles.primary, (!productName.trim() || !productCategoryId || busy) && styles.disabled]} onPress={() => void submitProduct()}>
            <Text style={styles.primaryText}>{actions.createProduct.isPending ? '등록 중...' : '정식 제품 등록'}</Text>
          </Pressable>
        </Section>

        <Section title="카테고리 추가" description="상위 카테고리와 하위 선택 카테고리를 연결합니다. 예: 먹을것 > 라면">
          <TextInput style={styles.input} value={categoryName} onChangeText={setCategoryName} placeholder="카테고리명" />
          <TextInput style={styles.input} value={categorySlug} onChangeText={setCategorySlug} placeholder="slug 예: ramen" autoCapitalize="none" />
          <Text style={styles.fieldLabel}>상위 카테고리 · 선택</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
            <Pressable onPress={() => setCategoryParentId(null)} style={[styles.chip, categoryParentId === null && styles.chipActive]}><Text style={[styles.chipText, categoryParentId === null && styles.chipTextActive]}>최상위</Text></Pressable>
            {categories.filter((item) => item.parentId === null).map((category) => (
              <Pressable key={category.id} onPress={() => setCategoryParentId(category.id)} style={[styles.chip, categoryParentId === category.id && styles.chipActive]}>
                <Text style={[styles.chipText, categoryParentId === category.id && styles.chipTextActive]}>{category.name}</Text>
              </Pressable>
            ))}
          </ScrollView>
          <View style={styles.switchRow}><Text style={styles.switchLabel}>사용자에게 노출</Text><Switch value={categoryVisible} onValueChange={setCategoryVisible} /></View>
          <View style={styles.switchRow}><Text style={styles.switchLabel}>원픽 선택 가능</Text><Switch value={categoryPickable} onValueChange={setCategoryPickable} /></View>
          <Pressable disabled={!categoryName.trim() || !categorySlug.trim() || busy} style={[styles.primary, (!categoryName.trim() || !categorySlug.trim() || busy) && styles.disabled]} onPress={() => void submitCategory()}>
            <Text style={styles.primaryText}>{actions.createCategory.isPending ? '추가 중...' : '카테고리 추가'}</Text>
          </Pressable>
          <View style={styles.compactList}>
            {categories.map((category) => <Text key={category.id} style={styles.listText}>{categoryPath(category, categories)} · {category.status}{category.isPickable ? ' · 선택 가능' : ''}</Text>)}
          </View>
        </Section>

        <Section title="브랜드 추가" description="제품 등록 시 브랜드를 선택할 수 있도록 기준 브랜드를 관리합니다.">
          <TextInput style={styles.input} value={brandName} onChangeText={setBrandName} placeholder="브랜드명 예: 농심" />
          <TextInput style={styles.input} value={brandSlug} onChangeText={setBrandSlug} placeholder="slug · 선택" autoCapitalize="none" />
          <Pressable disabled={!brandName.trim() || busy} style={[styles.primary, (!brandName.trim() || busy) && styles.disabled]} onPress={() => void submitBrand()}>
            <Text style={styles.primaryText}>{actions.createBrand.isPending ? '추가 중...' : '브랜드 추가'}</Text>
          </Pressable>
          <View style={styles.compactList}>
            {brands.map((brand) => <Text key={brand.id} style={styles.listText}>{brand.name}{brand.isActive ? '' : ' · 비활성'}</Text>)}
          </View>
        </Section>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#F7F5F2' },
  content: { width: '100%', maxWidth: 900, alignSelf: 'center', padding: 20, paddingBottom: 80 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 28 },
  centerTitle: { color: '#202124', fontSize: 20, fontWeight: '800', textAlign: 'center' },
  topRow: { flexDirection: 'row', alignItems: 'center' },
  back: { width: 44, color: '#202124', fontSize: 36, lineHeight: 42 },
  topCopy: { flex: 1 },
  kicker: { color: '#D96D4B', fontSize: 10, fontWeight: '900', letterSpacing: 2 },
  title: { color: '#202124', fontSize: 28, fontWeight: '900', marginTop: 4 },
  intro: { color: '#746F69', fontSize: 13, lineHeight: 20, marginTop: 10, marginBottom: 10 },
  section: { backgroundColor: '#FFFFFF', borderRadius: 22, padding: 18, marginTop: 16 },
  sectionTitle: { color: '#202124', fontSize: 18, fontWeight: '900' },
  sectionDescription: { color: '#8E8A85', fontSize: 12, lineHeight: 18, marginTop: 6, marginBottom: 14 },
  reviewCard: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#E7E1DB', paddingTop: 16, marginTop: 12 },
  productName: { color: '#202124', fontSize: 17, fontWeight: '900' },
  meta: { color: '#8E8A85', fontSize: 11, lineHeight: 17, marginTop: 5 },
  candidates: { backgroundColor: '#FAF8F5', borderRadius: 15, padding: 12, marginTop: 12 },
  smallTitle: { color: '#5E5954', fontSize: 11, fontWeight: '800', marginBottom: 5 },
  candidate: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 9 },
  candidateName: { flex: 1, color: '#202124', fontSize: 12, fontWeight: '700' },
  link: { color: '#D96D4B', fontSize: 11, fontWeight: '800', marginLeft: 10 },
  actionsRow: { flexDirection: 'row', gap: 9, marginTop: 13 },
  approveButton: { flex: 1, backgroundColor: '#202124', borderRadius: 13, alignItems: 'center', padding: 12 },
  approveText: { color: '#FFFFFF', fontSize: 12, fontWeight: '800' },
  rejectButton: { backgroundColor: '#F0ECE7', borderRadius: 13, alignItems: 'center', paddingHorizontal: 18, paddingVertical: 12 },
  rejectText: { color: '#786F68', fontSize: 12, fontWeight: '800' },
  fieldLabel: { color: '#5E5954', fontSize: 11, fontWeight: '800', marginTop: 13, marginBottom: 7 },
  input: { minHeight: 46, borderRadius: 14, backgroundColor: '#F7F5F2', color: '#202124', paddingHorizontal: 13, marginTop: 9, fontSize: 13 },
  chips: { gap: 7, paddingVertical: 3, paddingRight: 10 },
  chip: { backgroundColor: '#F0ECE7', borderRadius: 999, paddingHorizontal: 13, paddingVertical: 9 },
  chipActive: { backgroundColor: '#D96D4B' },
  chipText: { color: '#6C6863', fontSize: 11, fontWeight: '700' },
  chipTextActive: { color: '#FFFFFF' },
  primary: { minHeight: 48, borderRadius: 14, backgroundColor: '#D96D4B', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 18, marginTop: 15 },
  primaryText: { color: '#FFFFFF', fontSize: 13, fontWeight: '900' },
  secondary: { minHeight: 46, borderRadius: 14, backgroundColor: '#202124', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 18, marginTop: 18 },
  secondaryText: { color: '#FFFFFF', fontSize: 13, fontWeight: '800' },
  switchRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 9 },
  switchLabel: { color: '#5E5954', fontSize: 12, fontWeight: '700' },
  compactList: { marginTop: 15, gap: 6 },
  listText: { color: '#8E8A85', fontSize: 11, lineHeight: 16 },
  muted: { color: '#8E8A85', fontSize: 12, lineHeight: 18, textAlign: 'center', marginTop: 10 },
  empty: { color: '#8E8A85', fontSize: 12, paddingVertical: 12 },
  errorBox: { backgroundColor: '#FFF0EB', borderRadius: 14, padding: 12, marginTop: 12 },
  errorText: { color: '#A9482D', fontSize: 12, lineHeight: 18 },
  disabled: { opacity: 0.4 },
  pressed: { opacity: 0.7 },
});
