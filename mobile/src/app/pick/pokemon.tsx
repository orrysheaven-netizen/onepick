import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PickPhoto } from '@/components/pick-photo';
import { AppError } from '@/errors/appError';
import { useAuthSession } from '@/hooks/useAuthSession';
import { useItemSearch } from '@/hooks/useItemSearch';
import { useImportPokemonCatalogItem, usePokemonCatalogSearch } from '@/hooks/usePokemonCatalog';
import { useRegistrationCategories } from '@/hooks/useRegisterPick';
import type { ImportedPokemonItem, PokemonCatalogEntry } from '@/types/domain/pokemonCatalog';
import { OnePick } from '@/constants/onepick';
import { Icon } from '@/components/ui';

type Params = {
  categoryId?: string | string[];
  externalPokemonId?: string | string[];
  query?: string | string[];
};

type Selection = { externalId: string; replace: boolean } & (
  | { phase: 'loading' | 'paused' }
  | { phase: 'failed'; error: unknown }
  | { phase: 'ready'; item: ImportedPokemonItem }
);

const EXTERNAL_ID_PATTERN = /^\d{1,6}$/;
const scalar = (value: string | string[] | undefined) => typeof value === 'string' ? value : undefined;
const normalize = (value: string) => value.trim().replace(/\s+/g, ' ');
const dex = (value: number | string) => `#${String(value).padStart(4, '0')}`;

function pokemonErrorMessage(error: unknown) {
  if (error instanceof AppError) {
    if (error.code === 'AUTH_REQUIRED') return '로그인 상태를 다시 확인한 뒤 선택한 포켓몬을 이어가주세요.';
    if (error.code === 'RATE_LIMITED') return 'PokéAPI 요청이 많아요. 잠시 후 다시 시도해주세요.';
    if (error.code === 'ITEM_NOT_FOUND' || error.code === 'ITEM_NOT_ELIGIBLE') return '지금은 이 포켓몬을 선택할 수 없어요. 다시 검색해주세요.';
    if (error.code === 'CATEGORY_NOT_FOUND' || error.code === 'ITEM_CATEGORY_MISMATCH') return '포켓몬 카테고리 정보를 확인하지 못했어요.';
  }
  return 'PokéAPI에서 포켓몬 정보를 불러오지 못했어요. 다시 시도해주세요.';
}

export default function PokemonPickScreen() {
  const auth = useAuthSession();
  const params = useLocalSearchParams<Params>();
  const key = JSON.stringify([auth.user?.id ?? null, params.categoryId ?? null, params.externalPokemonId ?? null, params.query ?? null]);
  return <PokemonPickContent key={key} auth={auth} params={params} />;
}

function PokemonPickContent({ auth, params }: { auth: ReturnType<typeof useAuthSession>; params: Params }) {
  const router = useRouter();
  const { user, isLoading: sessionLoading, error: sessionError, retry: retrySession } = auth;
  const authReady = !sessionLoading && !sessionError;
  const [searchText, setSearchText] = useState(() => (scalar(params.query) ?? '').slice(0, 100));
  const [selection, setSelection] = useState<Selection | null>(null);
  const categories = useRegistrationCategories();
  const category = !categories.isError ? categories.data?.find((entry) =>
    entry.slug === 'pokemon' && (!scalar(params.categoryId) || entry.id === scalar(params.categoryId))) : undefined;

  const cleanQuery = normalize(searchText);
  const local = useItemSearch(authReady && category ? cleanQuery : '', category?.id);
  const catalog = usePokemonCatalogSearch(searchText, Boolean(authReady && category));
  const importPokemon = useImportPokemonCatalogItem();
  const localItems = category && !local.isWaiting && !local.isError
    ? (local.data ?? []).filter((item) => item.categoryId === category.id)
    : [];
  const external = (catalog.data ?? []).filter((entry) =>
    !localItems.some((item) => item.externalSource === entry.source && item.externalId === entry.externalId));
  const isSearching = local.isWaiting || local.isFetching || (catalog.valid && (catalog.isWaiting || catalog.isFetching));
  const noResults = catalog.valid && !isSearching && !local.isError && !catalog.isError
    && localItems.length === 0 && external.length === 0;

  const focused = useRef(false);
  const generation = useRef(0);
  const busy = useRef(false);
  const navigating = useRef(false);
  const attemptedReturn = useRef<string | null>(null);
  const latest = useRef({ authReady, userId: user?.id, categoryId: category?.id });
  latest.current = { authReady, userId: user?.id, categoryId: category?.id };

  useFocusEffect(useCallback(() => {
    focused.current = true;
    navigating.current = false;
    return () => {
      focused.current = false;
      generation.current++;
      busy.current = false;
      setSelection((current) => current?.phase === 'loading' ? { ...current, phase: 'paused' } : current);
    };
  }, []));

  const importing = selection?.phase === 'loading';
  const canAct = () => focused.current && latest.current.authReady && !busy.current && !navigating.current;

  const chooseItem = (itemId: string, categoryId: string, replace = false) => {
    if (!canAct() || latest.current.categoryId !== categoryId) return;
    navigating.current = true;
    const route = { pathname: '/pick/choose' as const, params: { itemId, categoryId } };
    if (replace) router.replace(route); else router.push(route);
  };

  const loginForPokemon = (externalPokemonId: string) => {
    if (!canAct() || !category || !EXTERNAL_ID_PATTERN.test(externalPokemonId)) return;
    navigating.current = true;
    router.push({ pathname: '/auth/login', params: { action: 'choose_pokemon', externalPokemonId, categoryId: category.id } });
  };

  const continuePokemon = (item: ImportedPokemonItem, replace: boolean) => {
    if (!canAct() || !latest.current.userId || item.categoryId !== latest.current.categoryId) return;
    chooseItem(item.itemId, item.categoryId, replace);
  };

  const loadPokemon = async (externalId: string, replace = false) => {
    if (!canAct() || !category || !EXTERNAL_ID_PATTERN.test(externalId)) return;
    if (!user) { loginForPokemon(externalId); return; }
    busy.current = true;
    const token = ++generation.current;
    const owner = user.id;
    const categoryId = category.id;
    setSelection({ phase: 'loading', externalId, replace });
    try {
      const item = await importPokemon.mutateAsync(externalId);
      if (token !== generation.current || !focused.current || latest.current.userId !== owner) return;
      if (item.categoryId !== categoryId) throw new AppError('ITEM_CATEGORY_MISMATCH');
      busy.current = false;
      setSelection({ phase: 'ready', externalId, replace, item });
      continuePokemon(item, replace);
    } catch (error) {
      if (token === generation.current && focused.current && latest.current.userId === owner) {
        setSelection({ phase: 'failed', externalId, replace, error });
      }
    } finally {
      if (token === generation.current) busy.current = false;
    }
  };

  const choosePokemon = (entry: PokemonCatalogEntry) => {
    if (!canAct() || !category) return;
    if (entry.existingItemId) { chooseItem(entry.existingItemId, category.id); return; }
    void loadPokemon(entry.externalId);
  };

  const externalId = scalar(params.externalPokemonId);
  const validReturn = Boolean(externalId && EXTERNAL_ID_PATTERN.test(externalId));
  useEffect(() => {
    if (!authReady || !user || !category || !validReturn || !externalId
      || attemptedReturn.current === externalId || !canAct()) return;
    attemptedReturn.current = externalId;
    void loadPokemon(externalId, true);
  });

  const back = () => {
    if (!focused.current || navigating.current) return;
    generation.current++;
    busy.current = false;
    navigating.current = true;
    setSelection((current) => current?.phase === 'loading' ? { ...current, phase: 'paused' } : current);
    if (router.canGoBack()) router.back(); else router.replace('/');
  };

  if (!authReady) return <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
    <View style={styles.centerState}>
      <Text style={styles.stateTitle}>{sessionError ? '로그인 상태를 확인하지 못했어요.' : '로그인 상태를 확인하고 있어요.'}</Text>
      {sessionError ? <Pressable onPress={retrySession} style={styles.secondaryButton}><Text style={styles.secondaryButtonText}>다시 확인하기</Text></Pressable> : <ActivityIndicator />}
    </View>
  </SafeAreaView>;

  return <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
      <Pressable accessibilityRole="button" accessibilityLabel="돌아가기" onPress={back} style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}><Icon name="back" /></Pressable>
      <Text style={styles.title}>나의 포켓몬 원픽</Text>
      <Text style={styles.subtitle}>한국어·영문 이름이나 전국도감 번호로 가장 좋아하는 포켓몬 하나를 골라보세요.</Text>
      <Text style={styles.notice}>PokéAPI의 종(species) ID를 기준으로 선택해요. MVP 기능 검증을 위해 PokéAPI 이미지를 원격으로 표시하며, 이미지 파일을 OnePick Storage에 복사하지 않아요.</Text>

      {!category && !categories.isPending ? <View style={styles.stateCard}>
        <Text style={styles.stateTitle}>포켓몬 카테고리를 사용할 수 없어요.</Text>
        <Text style={styles.stateText}>포켓몬 카테고리가 공개·선택 가능 상태인지 확인해주세요.</Text>
      </View> : null}
      {categories.isPending ? <ActivityIndicator style={styles.loading} /> : null}
      {params.externalPokemonId !== undefined && !validReturn ? <Text accessibilityRole="alert" style={styles.errorText}>포켓몬 선택 링크를 확인해주세요. 다시 검색할 수 있어요.</Text> : null}

      <Text style={styles.label}>포켓몬 이름 또는 도감 번호</Text>
      <TextInput autoFocus accessibilityLabel="원픽 포켓몬 검색" autoCapitalize="none" autoCorrect={false}
        editable={Boolean(category) && !importing} maxLength={100} value={searchText}
        onChangeText={(value) => { if (!busy.current) { setSearchText(value); setSelection(null); } }}
        placeholder="예: 피카츄, Pikachu, #25" placeholderTextColor={OnePick.textSecondary} returnKeyType="search" style={styles.input} />

      {isSearching ? <View style={styles.inlineState}><ActivityIndicator /><Text style={styles.stateText}>등록된 포켓몬과 PokéAPI 색인을 함께 찾고 있어요.</Text></View> : null}
      {local.isError ? <View style={styles.stateCard}><Text style={styles.stateTitle}>등록된 포켓몬 검색을 불러오지 못했어요.</Text>
        <Pressable disabled={local.isFetching} onPress={() => void local.refetch()} style={styles.secondaryButton}><Text style={styles.secondaryButtonText}>다시 검색</Text></Pressable></View> : null}
      {catalog.valid && catalog.isError ? <View style={styles.stateCard}>
        <Text style={styles.stateTitle}>PokéAPI를 불러오지 못했어요.</Text>
        <Text style={styles.stateText}>{pokemonErrorMessage(catalog.error)}</Text>
        <Pressable disabled={catalog.isFetching} onPress={() => void catalog.refetch()} style={styles.secondaryButton}><Text style={styles.secondaryButtonText}>PokéAPI 다시 검색</Text></Pressable>
      </View> : null}

      {selection?.phase === 'loading' ? <View style={styles.inlineState}><ActivityIndicator /><Text style={styles.stateText}>선택한 포켓몬 정보를 확인하고 있어요.</Text></View> : null}
      {selection && selection.phase !== 'loading' ? <View style={styles.stateCard}>
        <Text accessibilityRole={selection.phase === 'failed' ? 'alert' : undefined} style={styles.stateText}>
          {selection.phase === 'failed' ? pokemonErrorMessage(selection.error) : selection.phase === 'ready' ? '선택한 포켓몬 정보를 준비했어요.' : '이전 포켓몬 선택을 다시 이어갈 수 있어요.'}
        </Text>
        {selection.phase === 'ready'
          ? <Pressable onPress={() => continuePokemon(selection.item, selection.replace)} style={styles.secondaryButton}><Text style={styles.secondaryButtonText}>선택한 포켓몬으로 계속</Text></Pressable>
          : selection.phase === 'failed' && selection.error instanceof AppError && selection.error.code === 'AUTH_REQUIRED'
            ? <Pressable onPress={() => loginForPokemon(selection.externalId)} style={styles.secondaryButton}><Text style={styles.secondaryButtonText}>다시 로그인하고 선택 계속</Text></Pressable>
            : <Pressable onPress={() => void loadPokemon(selection.externalId, selection.replace)} style={styles.secondaryButton}><Text style={styles.secondaryButtonText}>선택한 포켓몬 다시 불러오기</Text></Pressable>}
      </View> : null}

      {validReturn && !user && !selection ? <View style={styles.stateCard}>
        <Text style={styles.stateText}>선택한 포켓몬을 이어가려면 로그인이 필요해요.</Text>
        <Pressable onPress={() => loginForPokemon(externalId!)} style={styles.secondaryButton}><Text style={styles.secondaryButtonText}>로그인하고 선택 계속</Text></Pressable>
      </View> : null}

      {cleanQuery && localItems.map((item) => <View key={item.id} style={styles.itemCard}>
        <PickPhoto uri={item.thumbnailUrl ?? item.imageUrl ?? item.imageSourceUrl} label={item.name}
          itemId={item.id} itemStatus={item.status} hasPhoto={Boolean(item.imagePath)} />
        <Pressable accessibilityRole="button" accessibilityLabel={`${item.name} 원픽 선택`} disabled={importing}
          onPress={() => chooseItem(item.id, item.categoryId)} style={({ pressed }) => [styles.itemCopy, pressed && styles.pressed]}>
          <Text style={styles.itemCategory}>포켓몬 · 등록됨</Text>
          <Text style={styles.itemName}>{item.name}</Text>
          <Text style={styles.meta}>{item.externalId ? dex(item.externalId) : ''}{item.originalName && item.originalName !== item.name ? ` · ${item.originalName}` : ''}</Text>
          <Text style={styles.itemAction}>이 포켓몬을 원픽으로 고르기 ›</Text>
        </Pressable>
      </View>)}

      {!catalog.isWaiting && !catalog.isError && catalog.valid && external.map((entry) => <Pressable
        key={entry.externalId} accessibilityRole="button" accessibilityLabel={`${entry.name} 포켓몬 선택`}
        accessibilityState={{ disabled: importing }} disabled={importing} onPress={() => choosePokemon(entry)}
        style={({ pressed }) => [styles.itemCard, pressed && styles.pressed, importing && styles.disabled]}>
        <PickPhoto uri={entry.imageUrl} label={`${entry.name} 포켓몬 이미지`} />
        <View style={styles.itemCopy}>
          <Text style={styles.itemCategory}>포켓몬 · PokéAPI</Text>
          <Text style={styles.itemName}>{entry.name}</Text>
          <Text style={styles.meta}>{dex(entry.dexNumber)}{entry.englishName !== entry.name ? ` · ${entry.englishName}` : ''}</Text>
          <Text style={styles.itemAction}>{selection?.externalId === entry.externalId && importing ? '포켓몬 정보를 확인하고 있어요…' : '이 포켓몬을 원픽으로 고르기 ›'}</Text>
        </View>
      </Pressable>)}

      {noResults ? <View style={styles.stateCard}><Text style={styles.stateTitle}>일치하는 포켓몬을 찾지 못했어요.</Text>
        <Text style={styles.stateText}>한국어·영문 이름이나 도감 번호를 바꿔서 검색해보세요. 그래도 없으면 나중에 다시 찾거나 다른 카테고리를 먼저 골라도 돼요.</Text></View> : null}

      <Text style={styles.attribution}>포켓몬 이름·종 데이터 및 원격 이미지: PokéAPI. Pokémon 관련 이미지·캐릭터·상표 권리는 상업화 전에 다시 검토해요. 사용자 업로드 사진이 있으면 OnePick 사진을 우선 표시해요.</Text>
    </ScrollView>
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: OnePick.background },
  content: { width: '100%', maxWidth: 520, alignSelf: 'center', paddingHorizontal: 20, paddingBottom: 40 },
  backButton: { width: 44, height: 44, justifyContent: 'center', marginTop: 4, marginLeft: -8 },
  title: { color: OnePick.text, fontSize: 27, lineHeight: 35, fontWeight: '900', letterSpacing: -0.8, marginTop: 8 },
  subtitle: { color: OnePick.muted, fontSize: 13, lineHeight: 20, marginTop: 10 },
  notice: { color: OnePick.muted, fontSize: 12, lineHeight: 18, backgroundColor: OnePick.surface, borderRadius: 14, padding: 14, marginTop: 14 },
  label: { color: OnePick.text, fontSize: 13, fontWeight: '800', marginTop: 18, marginBottom: 7 },
  input: { minHeight: 52, backgroundColor: OnePick.surface, borderWidth: 1, borderColor: OnePick.border, borderRadius: 16, paddingHorizontal: 15, color: OnePick.text, fontSize: 15 },
  loading: { marginTop: 18 },
  inlineState: { flexDirection: 'row', alignItems: 'center', gap: 9, paddingVertical: 18 },
  stateCard: { borderWidth: 1, borderColor: OnePick.border, backgroundColor: OnePick.surface, borderRadius: 18, padding: 18, marginTop: 16 },
  stateTitle: { color: OnePick.text, fontSize: 15, fontWeight: '800' },
  stateText: { color: OnePick.muted, fontSize: 12, lineHeight: 18, marginTop: 7 },
  errorText: { color: OnePick.danger, fontSize: 12, lineHeight: 18, marginTop: 12 },
  itemCard: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: OnePick.border, backgroundColor: OnePick.surface, borderRadius: 20, padding: 12, marginTop: 11 },
  itemCopy: { flex: 1, paddingLeft: 14, minHeight: 86, justifyContent: 'center' },
  itemCategory: { color: OnePick.accent, fontSize: 11, fontWeight: '800', letterSpacing: 0.6 },
  itemName: { color: OnePick.text, fontSize: 16, fontWeight: '800', marginTop: 5 },
  meta: { color: OnePick.muted, fontSize: 12, lineHeight: 18, marginTop: 4 },
  itemAction: { color: OnePick.muted, fontSize: 12, marginTop: 7 },
  secondaryButton: { alignSelf: 'flex-start', minHeight: 42, borderRadius: 13, backgroundColor: OnePick.text, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 15, marginTop: 13 },
  secondaryButtonText: { color: OnePick.onAccent, fontSize: 12, fontWeight: '800' },
  centerState: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 28 },
  attribution: { color: OnePick.textSecondary, fontSize: 10, lineHeight: 15, marginTop: 24, marginBottom: 10 },
  pressed: { opacity: 0.7 },
  disabled: { opacity: 0.5 },
});
