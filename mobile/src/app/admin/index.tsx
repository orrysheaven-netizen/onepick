import { useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { PickPhoto } from '@/components/pick-photo';
import { AppError } from '@/errors/appError';
import { useAdminActions, useAdminDashboard } from '@/hooks/useAdmin';
import { useAuthSession } from '@/hooks/useAuthSession';
import { categoryLabel, selectableCategories } from '@/lib/categories/categoryTree';
import type { AdminCategoryInput } from '@/repositories/interfaces/adminRepository';
import type { Category, CategoryStatus } from '@/types/domain/category';
import type { Item } from '@/types/domain/item';

const statusNames: Record<CategoryStatus, string> = { draft: '준비 중', open: '운영 중', paused: '일시 중지', closed: '종료' };
const itemStatusNames = { active: '활성', discontinued: '단종', hidden: '숨김' } as const;
type ManagedItemStatus = keyof typeof itemStatusNames;
const emptyCategory = (): AdminCategoryInput => ({ name: '', slug: '', parentId: null, status: 'draft', isVisible: false, isPickable: false, sortOrder: 0 });
function errorText(error: unknown) {
  if (error instanceof AppError) {
    if (error.code === 'FORBIDDEN') return '관리자 권한이 필요합니다.';
    if (error.code === 'CATEGORY_INVALID') return '이름·식별자·순서를 확인해주세요. 상위 카테고리는 선택 불가여야 하며, 두 단계까지만 만들 수 있습니다.';
    if (error.code === 'PICK_CONFLICT') return '다른 관리자가 먼저 처리했거나 현재 상태에서는 수정할 수 없습니다. 새로고침 후 확인해주세요.';
    if (error.code === 'ITEM_NAME_INVALID') return '이름을 확인해주세요. 카테고리는 60자, 제품은 100자까지 입력할 수 있습니다.';
    if (error.code === 'ITEM_CATEGORY_MISMATCH') return '정식 제품의 카테고리는 기존 Pick 관계를 보호하기 위해 변경하지 않습니다.';
    if (error.code === 'ITEM_ALIAS_INVALID') return '검색 별칭은 1~100자로 입력해주세요.';
    if (error.code === 'ITEM_ALIAS_REDUNDANT') return '정식 제품명과 같은 별칭은 추가할 필요가 없습니다.';
    if (error.code === 'ITEM_ALIAS_CONFLICT') return '같은 카테고리의 다른 제품에서 이미 사용하는 검색 이름입니다.';
    if (error.code === 'CATEGORY_NOT_FOUND' || error.code === 'CATEGORY_NOT_PICKABLE') return '공개·운영 중인 선택 가능한 카테고리를 확인해주세요.';
  }
  return '저장하지 못했습니다. 입력 내용은 유지됩니다. 다시 시도해주세요.';
}
function Button({ children, onPress, disabled = false, selected = false }: { children: string; onPress: () => void; disabled?: boolean; selected?: boolean }) {
  return <Pressable accessibilityRole="button" accessibilityState={{ selected, disabled }} onPress={onPress} disabled={disabled} style={[styles.button, selected && styles.selected, disabled && styles.disabled]}><Text style={[styles.buttonText, selected && styles.selectedText]}>{children}</Text></Pressable>;
}

function similarItems(item: Item, items: Item[]) {
  const score = (item: Item) => item.normalizedName === item.normalizedName ? 0
    : item.normalizedName.includes(item.normalizedName) || item.normalizedName.includes(item.normalizedName) ? 1 : 2;
  return items.filter((item) => item.id !== item.id && item.categoryId === item.categoryId && ['active', 'discontinued'].includes(item.status))
    .sort((a, b) => score(a) - score(b) || a.name.localeCompare(b.name)).slice(0, 3);
}

export default function AdminScreen() {
  const auth = useAuthSession();
  return <AdminForm key={auth.user?.id ?? 'anonymous'} auth={auth} />;
}
function AdminForm({ auth }: { auth: ReturnType<typeof useAuthSession>; }) {
  const router = useRouter();
  const query = useAdminDashboard(auth.user?.id);
  const actions = useAdminActions();
  const [tab, setTab] = useState<'categories' | 'items' | 'requests' | 'brands' | 'aliases'>('categories');
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [category, setCategory] = useState(emptyCategory);
  const [sortOrder, setSortOrder] = useState('0');
  const [itemName, setItemName] = useState('');
  const [itemCategory, setItemCategory] = useState('');
  const [itemBrand, setItemBrand] = useState<string | null>(null);
  const [itemUrl, setItemUrl] = useState('');
  const [itemStatus, setItemStatus] = useState<ManagedItemStatus>('active');
  const [itemEditId, setItemEditId] = useState<string | null>(null);
  const [itemListQuery, setItemListQuery] = useState('');
  const [brandName, setBrandName] = useState('');
  const [brandSlug, setBrandSlug] = useState('');
  const [requestId, setRequestId] = useState<string | null>(null);
  const [aliasItemQuery, setAliasItemQuery] = useState('');
  const [aliasItemId, setAliasItemId] = useState<string | null>(null);
  const [aliasValue, setAliasValue] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [notice, setNotice] = useState('');
  const [saving, setSaving] = useState(false);
  const busy = useRef(false);
  const data = query.data;
  const categories = data?.categories ?? [];
  const eligible = selectableCategories(categories);
  const run = async (task: () => Promise<unknown>, success: string, after?: () => void) => {
    if (busy.current) return;
    busy.current = true; setSaving(true); setError(null); setNotice('');
    try { await task(); setNotice(success); after?.(); }
    catch (cause) { setError(cause); }
    finally { busy.current = false; setSaving(false); }
  };
  const clearCategory = () => { setCategoryId(null); setCategory(emptyCategory()); setSortOrder('0'); };
  const editCategory = (item: Category) => { setCategoryId(item.id); setCategory({ ...item }); setSortOrder(String(item.sortOrder)); setNotice(''); setError(null); };
  const clearItem = () => {
    setRequestId(null); setItemEditId(null); setItemName(''); setItemCategory('');
    setItemBrand(null); setItemUrl(''); setItemStatus('active');
  };
  const editRequest = (item: Item) => {
    setItemEditId(null); setRequestId(item.id); setItemName(item.name); setItemCategory(item.categoryId);
    setItemBrand(item.brandId); setItemUrl(item.officialUrl ?? ''); setItemStatus('active'); setNotice(''); setError(null);
  };
  const editFormalItem = (item: Item) => {
    if (!['active', 'discontinued', 'hidden'].includes(item.status)) return;
    setRequestId(null); setItemEditId(item.id); setItemName(item.name); setItemCategory(item.categoryId);
    setItemBrand(item.brandId); setItemUrl(item.officialUrl ?? ''); setItemStatus(item.status as ManagedItemStatus); setNotice(''); setError(null);
  };
  const saveCategory = () => run(async () => {
    if (!sortOrder.trim() || !/^-?\d+$/.test(sortOrder)) throw new AppError('CATEGORY_INVALID');
    const input = { ...category, sortOrder: Number(sortOrder) };
    return categoryId ? actions.updateCategory.mutateAsync({ id: categoryId, input }) : actions.createCategory.mutateAsync(input);
  }, '카테고리를 저장했습니다. 공개·운영 중·선택 가능 설정을 모두 켜면 사용자 앱에 표시됩니다.', clearCategory);
  const saveItem = () => run(() => {
    const common = { name: itemName, brandId: itemBrand, officialUrl: itemUrl.trim() || null };
    if (requestId) return actions.approveItem.mutateAsync({ itemId: requestId, edits: { ...common, categoryId: itemCategory } });
    if (itemEditId) return actions.updateItem.mutateAsync({ itemId: itemEditId, input: { ...common, status: itemStatus } });
    return actions.createItem.mutateAsync({ ...common, categoryId: itemCategory });
  }, requestId ? '승인했습니다. 이제 원픽으로 선택할 수 있습니다.' : itemEditId ? '정식 제품 정보를 수정했습니다.' : '정식 제품을 등록했습니다.', clearItem);
  const saveAlias = () => {
    if (!aliasItemId || !aliasValue.trim()) return;
    void run(() => actions.addItemAlias.mutateAsync({ itemId: aliasItemId, alias: aliasValue }), '검색 별칭을 추가했습니다.', () => setAliasValue(''));
  };
  const itemReady = Boolean(itemName.trim() && itemCategory && (itemEditId || eligible.some((item) => item.id === itemCategory)));
  const filteredItems = (data?.items ?? [])
    .filter((item) => ['active', 'discontinued', 'hidden'].includes(item.status))
    .filter((item) => !itemListQuery.trim() || item.name.toLowerCase().includes(itemListQuery.trim().toLowerCase()))
    .slice(0, 100);

  return <SafeAreaView style={styles.safe} edges={['top', 'bottom']}><ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
    <Button onPress={() => router.replace('/(tabs)/profile')}>‹ 내 프로필</Button>
    <Text style={styles.kicker}>ONEPICK ADMIN</Text><Text style={styles.title}>카테고리와 제품 관리</Text>
    {auth.isLoading ? <ActivityIndicator /> : auth.error ? <Button onPress={auth.retry}>로그인 상태 다시 확인</Button> : !auth.user ? <Text style={styles.notice}>관리자 계정으로 로그인한 후 내 프로필에서 다시 열어주세요.</Text> : query.isPending ? <ActivityIndicator /> : query.isError ? <View style={styles.card}><Text>{errorText(query.error)}</Text><Button onPress={() => void query.refetch()}>다시 확인</Button></View> : data ? <>
      <View style={styles.row}>{(['categories', 'items', 'aliases', 'requests', 'brands'] as const).map((value) => <Button key={value} disabled={saving} selected={tab === value} onPress={() => { setTab(value); clearItem(); setError(null); setNotice(''); }}>{value === 'categories' ? '카테고리' : value === 'items' ? '정식 제품' : value === 'aliases' ? '검색 별칭' : value === 'brands' ? '브랜드' : `등록 요청 ${data.pending.length}`}</Button>)}</View>
      <Button disabled={saving || query.isFetching} onPress={() => void query.refetch()}>새로고침</Button>
      {error ? <Text accessibilityRole="alert" style={styles.error}>{errorText(error)}</Text> : null}
      {notice ? <Text accessibilityRole="alert" style={styles.notice}>{notice}</Text> : null}
      {tab === 'categories' ? <>
        <View style={styles.card}><Text style={styles.heading}>{categoryId ? '카테고리 수정' : '카테고리 추가'}</Text>
          <Text style={styles.label}>이름</Text><TextInput accessibilityLabel="카테고리 이름" editable={!saving} style={styles.input} value={category.name} maxLength={60} onChangeText={(name) => setCategory({ ...category, name })} placeholder="예: 먹을것, 라면" />
          <Text style={styles.label}>식별자 · 영문 소문자, 숫자, 하이픈</Text><TextInput accessibilityLabel="카테고리 식별자" editable={!saving && !categoryId} autoCapitalize="none" style={styles.input} value={category.slug} maxLength={80} onChangeText={(slug) => setCategory({ ...category, slug })} placeholder="예: food, ramen" />
          {categoryId ? <Text style={styles.hint}>식별자는 기존 링크와 제품 분류 규칙을 위해 유지합니다.</Text> : null}
          <Text style={styles.label}>상위 카테고리</Text><View style={styles.row}>
            <Button disabled={saving} selected={!category.parentId} onPress={() => setCategory({ ...category, parentId: null })}>없음 · 최상위</Button>
            {categories.filter((item) => !item.parentId && !item.isPickable && item.id !== categoryId).map((item) => <Button key={item.id} disabled={saving} selected={category.parentId === item.id} onPress={() => setCategory({ ...category, parentId: item.id })}>{item.name}</Button>)}
          </View><Text style={styles.hint}>예: 먹을것 › 라면. 상위 분류는 ‘원픽 선택 가능’을 꺼주세요.</Text>
          <Text style={styles.label}>운영 상태</Text><View style={styles.row}>{(Object.keys(statusNames) as CategoryStatus[]).map((status) => <Button key={status} disabled={saving} selected={category.status === status} onPress={() => setCategory({ ...category, status })}>{statusNames[status]}</Button>)}</View>
          <View style={styles.toggle}><Text>사용자에게 공개</Text><Switch accessibilityLabel="사용자에게 공개" disabled={saving} value={category.isVisible} onValueChange={(isVisible) => setCategory({ ...category, isVisible })} /></View>
          <View style={styles.toggle}><Text>원픽 선택 가능</Text><Switch accessibilityLabel="원픽 선택 가능" disabled={saving} value={category.isPickable} onValueChange={(isPickable) => setCategory({ ...category, isPickable })} /></View>
          <Text style={styles.label}>표시 순서 · 작은 숫자부터</Text><TextInput accessibilityLabel="표시 순서" editable={!saving} style={styles.input} keyboardType="numbers-and-punctuation" value={sortOrder} onChangeText={setSortOrder} />
          <View style={styles.row}><Button selected disabled={saving || !category.name.trim() || !category.slug.trim()} onPress={() => void saveCategory()}>{saving ? '저장 중…' : '카테고리 저장'}</Button><Button disabled={saving} onPress={clearCategory}>새 카테고리</Button></View>
        </View>
        <Text style={styles.heading}>전체 카테고리 {categories.length}</Text>
        {categories.map((item) => <View key={item.id} style={styles.card}><Text style={styles.heading}>{categoryLabel(item, categories)}</Text><Text style={styles.hint}>{statusNames[item.status]} · {item.isVisible ? '공개' : '비공개'} · {eligible.some((c) => c.id === item.id) ? '선택 가능' : '선택 불가'} · 순서 {item.sortOrder}</Text><Button disabled={saving} onPress={() => editCategory(item)}>수정</Button></View>)}
      </> : tab === 'brands' ? <View style={styles.card}>
        <Text style={styles.heading}>브랜드 추가</Text>
        <TextInput accessibilityLabel="브랜드 이름" editable={!saving} style={styles.input} value={brandName} onChangeText={setBrandName} maxLength={80} placeholder="브랜드 이름" />
        <TextInput accessibilityLabel="브랜드 식별자" editable={!saving} style={styles.input} value={brandSlug} onChangeText={setBrandSlug} autoCapitalize="none" placeholder="영문 식별자 · 선택" />
        <Button selected disabled={saving || !brandName.trim()} onPress={() => void run(() => actions.createBrand.mutateAsync({ name: brandName, slug: brandSlug.trim() || null, isActive: true }), '브랜드를 추가했습니다.', () => { setBrandName(''); setBrandSlug(''); })}>브랜드 저장</Button>
        {data.brands.map((brand) => <Text key={brand.id}>{brand.name}{brand.isActive ? '' : ' · 비활성'}</Text>)}
      </View> : tab === 'aliases' ? <>
        <View style={styles.card}>
          <Text style={styles.heading}>제품 검색 별칭</Text>
          <Text style={styles.hint}>사용자가 다른 표현으로 검색해도 같은 정식 제품으로 연결합니다. 정식 제품명 자체와 같은 별칭은 만들지 않습니다.</Text>
          <TextInput accessibilityLabel="별칭 관리 제품 찾기" editable={!saving} style={styles.input} value={aliasItemQuery} onChangeText={setAliasItemQuery} placeholder="정식 제품명으로 찾기" />
          {aliasItemQuery.trim() ? <View style={styles.row}>{data.items
            .filter((item) => ['active', 'discontinued'].includes(item.status) && item.name.toLowerCase().includes(aliasItemQuery.trim().toLowerCase()))
            .slice(0, 20)
            .map((item) => <Button key={item.id} disabled={saving} selected={aliasItemId === item.id} onPress={() => { setAliasItemId(item.id); setAliasValue(''); setError(null); setNotice(''); }}>{item.name}</Button>)}</View> : <Text style={styles.hint}>제품명을 입력하면 최대 20개 후보를 보여줍니다.</Text>}
        </View>
        {aliasItemId ? (() => {
          const item = data.items.find((item) => item.id === aliasItemId);
          const aliases = data.aliases.filter((item) => item.itemId === aliasItemId);
          const itemCategoryItem = item ? categories.find((category) => category.id === item.categoryId) : null;
          return item ? <View style={styles.card}>
            <Text style={styles.heading}>{item.name}</Text>
            <Text style={styles.hint}>{itemCategoryItem ? categoryLabel(itemCategoryItem, categories) : '카테고리 확인 필요'}</Text>
            <Text style={styles.label}>새 검색 별칭</Text>
            <TextInput accessibilityLabel="새 검색 별칭" editable={!saving} style={styles.input} value={aliasValue} onChangeText={setAliasValue} maxLength={100} placeholder="다르게 검색할 수 있는 이름" />
            <Button selected disabled={saving || !aliasValue.trim()} onPress={saveAlias}>{saving ? '저장 중…' : '별칭 추가'}</Button>
            <Text style={styles.label}>등록된 별칭 {aliases.length}개</Text>
            {aliases.length ? aliases.map((item) => <View key={item.id} style={styles.aliasRow}><Text style={styles.aliasText}>{item.alias}</Text><Button disabled={saving} onPress={() => void run(() => actions.removeItemAlias.mutateAsync(item.id), '검색 별칭을 삭제했습니다.')}>삭제</Button></View>) : <Text style={styles.hint}>아직 별칭이 없습니다.</Text>}
          </View> : null;
        })() : null}
      </> : <>
        {tab === 'items' || requestId ? <View style={styles.card}>
          <Text style={styles.heading}>{requestId ? '요청 확인 후 승인' : itemEditId ? '정식 제품 수정' : '정식 제품 추가'}</Text>
          <Text style={styles.label}>제품명 · 맛과 종류 포함</Text><TextInput accessibilityLabel="관리할 제품명" editable={!saving} style={styles.input} value={itemName} maxLength={100} onChangeText={setItemName} placeholder="예: 진라면 매운맛" />
          <Text style={styles.label}>공식 제품 링크 · 선택 사항</Text><TextInput accessibilityLabel="공식 제품 링크" editable={!saving} style={styles.input} value={itemUrl} onChangeText={setItemUrl} autoCapitalize="none" keyboardType="url" maxLength={2048} placeholder="https://…" />
          <Text style={styles.label}>카테고리</Text><View style={styles.row}>{eligible.map((item) => <Button key={item.id} disabled={saving || Boolean(itemEditId)} selected={itemCategory === item.id} onPress={() => setItemCategory(item.id)}>{categoryLabel(item, categories)}</Button>)}</View>
          {itemEditId ? <Text style={styles.hint}>정식 제품의 카테고리는 기존 Pick 관계를 보호하기 위해 고정합니다. 잘못 등록된 제품은 숨기고 올바른 제품으로 새로 등록해주세요.</Text> : null}
          <Text style={styles.label}>브랜드 · 선택 사항</Text><View style={styles.row}><Button disabled={saving} selected={!itemBrand} onPress={() => setItemBrand(null)}>미지정</Button>{data.brands.filter((brand) => brand.isActive).map((brand) => <Button key={brand.id} disabled={saving} selected={itemBrand === brand.id} onPress={() => setItemBrand(brand.id)}>{brand.name}</Button>)}</View>
          {itemEditId ? <><Text style={styles.label}>제품 상태</Text><View style={styles.row}>{(Object.keys(itemStatusNames) as ManagedItemStatus[]).map((status) => <Button key={status} disabled={saving} selected={itemStatus === status} onPress={() => setItemStatus(status)}>{itemStatusNames[status]}</Button>)}</View></> : null}
          <Button selected disabled={saving || !itemReady} onPress={() => void saveItem()}>{saving ? '저장 중…' : requestId ? '승인하고 정식 등록' : itemEditId ? '제품 수정 저장' : '제품 등록'}</Button>
          {(requestId || itemEditId) ? <Button disabled={saving} onPress={clearItem}>편집 닫기</Button> : null}
        </View> : null}
        {tab === 'requests' ? data.pending.length ? data.pending.map(({ item, submitter }) => <View key={item.id} style={styles.card}>
          <PickPhoto uri={item.thumbnailUrl} label={item.name} /><Text style={styles.heading}>{item.name}</Text>
          <Text>{categories.find((category) => category.id === item.categoryId)?.name ?? '카테고리 확인 필요'} · @{submitter?.username ?? '탈퇴한 사용자'}</Text>
          {similarItems(item, data.items).length ? <Text style={styles.label}>기존 제품 후보 · 같은 제품인지 확인 후 연결</Text> : null}
          {similarItems(item, data.items).map((candidate) => <Button key={candidate.id} disabled={saving} onPress={() => void run(() => actions.mergeItem.mutateAsync({ itemId: item.id, targetItemId: candidate.id }), '기존 제품으로 연결했습니다.', clearItem)}>{`${candidate.name}에 연결`}</Button>)}
          <View style={styles.row}><Button disabled={saving} onPress={() => editRequest(item)}>이름·카테고리 확인</Button><Button disabled={saving} onPress={() => void run(() => actions.rejectItem.mutateAsync(item.id), '요청을 보류했습니다.', clearItem)}>등록 보류</Button></View>
        </View>) : <Text style={styles.notice}>처리할 요청이 없습니다.</Text> : <>
          <View style={styles.card}><Text style={styles.heading}>정식 제품 찾기</Text><TextInput accessibilityLabel="정식 제품 검색" editable={!saving} style={styles.input} value={itemListQuery} onChangeText={setItemListQuery} placeholder="제품명 검색" /><Text style={styles.hint}>활성·단종·숨김 제품을 최대 100개 표시합니다.</Text></View>
          {filteredItems.map((item) => {
            const itemCategory = categories.find((category) => category.id === item.categoryId);
            return <View key={item.id} style={styles.card}><Text style={styles.heading}>{item.name}</Text><Text style={styles.hint}>{itemCategory ? categoryLabel(itemCategory, categories) : '카테고리 확인 필요'} · {itemStatusNames[item.status as ManagedItemStatus] ?? item.status}</Text><View style={styles.row}><Button disabled={saving} onPress={() => editFormalItem(item)}>수정</Button><Button onPress={() => router.push({ pathname: '/item/[itemId]', params: { itemId: item.id } })}>제품 상세</Button></View></View>;
          })}
        </>}
        {(tab === 'requests' ? data.pending.length : data.items.length) >= 500 ? <Text style={styles.hint}>한 번에 최대 500개를 불러옵니다. 검색과 상태 관리가 필요한 대규모 운영 단계에서는 서버 페이지네이션으로 확장합니다.</Text> : null}
      </>}
    </> : null}
  </ScrollView></SafeAreaView>;
}
const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#F5F6F8' },
  content: { width: '100%', maxWidth: 850, alignSelf: 'center', padding: 22, paddingBottom: 70, gap: 14 },
  kicker: { color: '#A9482D', fontWeight: '800', fontSize: 12, letterSpacing: 2, marginTop: 14 },
  title: { fontSize: 28, fontWeight: '800', color: '#202124' },
  heading: { fontSize: 17, fontWeight: '700', color: '#202124' },
  label: { marginTop: 10, fontSize: 13, fontWeight: '700', color: '#625A53' },
  card: { backgroundColor: 'white', borderRadius: 18, padding: 20, gap: 12 },
  input: { borderWidth: 1, borderColor: '#DDD5CD', borderRadius: 12, padding: 14, fontSize: 16, color: '#202124' },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  aliasRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#E9E2DB', paddingTop: 10 },
  aliasText: { flex: 1, color: '#202124', fontSize: 14 },
  toggle: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 14, paddingVertical: 6 },
  button: { alignSelf: 'flex-start', borderWidth: 1, borderColor: '#DDD5CD', borderRadius: 12, padding: 12 },
  buttonText: { color: '#625A53', fontWeight: '700' },
  selected: { backgroundColor: '#A9482D', borderColor: '#A9482D' }, selectedText: { color: 'white' },
  disabled: { opacity: 0.45 }, hint: { fontSize: 12, color: '#77706B', lineHeight: 19 },
  notice: { padding: 16, backgroundColor: '#F7E7DD', color: '#625A53', lineHeight: 22, borderRadius: 12 },
  error: { color: '#A9482D', lineHeight: 22 },
});
