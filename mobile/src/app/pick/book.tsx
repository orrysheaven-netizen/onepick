import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PickPhoto } from '@/components/pick-photo';
import { AppError } from '@/errors/appError';
import { useAuthSession } from '@/hooks/useAuthSession';
import { useBookCatalogSearch, useImportBookCatalogItem } from '@/hooks/useBookCatalog';
import { useItemSearch } from '@/hooks/useItemSearch';
import { useRegistrationCategories } from '@/hooks/useRegisterPick';
import type { BookCatalogEntry, ImportedBookItem } from '@/types/domain/bookCatalog';

type Params = {
  categoryId?: string | string[];
  externalBookId?: string | string[];
  title?: string | string[];
  author?: string | string[];
};

type Selection = { externalId: string; replace: boolean } & (
  | { phase: 'loading' | 'paused' }
  | { phase: 'failed'; error: unknown }
  | { phase: 'ready'; item: ImportedBookItem }
);

const scalar = (value: string | string[] | undefined) => typeof value === 'string' ? value : undefined;
const normalize = (value: string) => value.trim().replace(/\s+/g, ' ');
const validIsbn13 = (value: string) => /^(?:978|979)\d{10}$/.test(value);

function bookErrorMessage(error: unknown) {
  if (error instanceof AppError) {
    if (error.code === 'CATALOG_NOT_CONFIGURED') return '책 DB 인증키가 아직 연결되지 않았어요. 기존 OnePick 책 검색은 계속 사용할 수 있어요.';
    if (error.code === 'AUTH_REQUIRED') return '로그인 상태를 다시 확인한 뒤 선택한 책을 이어가주세요.';
    if (error.code === 'ITEM_NOT_FOUND' || error.code === 'ITEM_NOT_ELIGIBLE') return '지금은 이 책을 선택할 수 없어요. 다른 판본을 찾아주세요.';
    if (error.code === 'CATEGORY_NOT_FOUND' || error.code === 'ITEM_CATEGORY_MISMATCH') return '책 카테고리 정보를 확인하지 못했어요.';
  }
  return '책 정보를 불러오지 못했어요. 같은 책으로 다시 시도할 수 있어요.';
}

export default function BookPickScreen() {
  const auth = useAuthSession();
  const params = useLocalSearchParams<Params>();
  const key = JSON.stringify([auth.user?.id ?? null, params.categoryId ?? null, params.externalBookId ?? null, params.title ?? null, params.author ?? null]);
  return <BookPickContent key={key} auth={auth} params={params} />;
}

function BookPickContent({ auth, params }: { auth: ReturnType<typeof useAuthSession>; params: Params }) {
  const router = useRouter();
  const { user, isLoading: sessionLoading, error: sessionError, retry: retrySession } = auth;
  const authReady = !sessionLoading && !sessionError;
  const [title, setTitle] = useState(() => (scalar(params.title) ?? '').slice(0, 100));
  const [author, setAuthor] = useState(() => (scalar(params.author) ?? '').slice(0, 100));
  const [selection, setSelection] = useState<Selection | null>(null);
  const categories = useRegistrationCategories();
  const category = !categories.isError ? categories.data?.find((entry) =>
    entry.slug === 'book' && (!scalar(params.categoryId) || entry.id === scalar(params.categoryId))) : undefined;

  const cleanTitle = normalize(title);
  const cleanAuthor = normalize(author);
  const localQueryText = [cleanTitle, cleanAuthor].filter(Boolean).join(' ');
  const local = useItemSearch(authReady && category ? localQueryText : '', category?.id);
  const catalog = useBookCatalogSearch(title, author, Boolean(authReady && category));
  const importBook = useImportBookCatalogItem();
  const localItems = authReady && category && !local.isWaiting && !local.isError
    ? (local.data ?? []).filter((item) => item.categoryId === category.id
      && (!cleanAuthor || normalize(item.creatorName ?? item.name).toLocaleLowerCase('ko-KR')
        .includes(cleanAuthor.toLocaleLowerCase('ko-KR')))) : [];
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

  const loginForBook = (externalBookId: string) => {
    if (!canAct() || !category || !validIsbn13(externalBookId)) return;
    navigating.current = true;
    router.push({ pathname: '/auth/login', params: { action: 'choose_book', externalBookId, categoryId: category.id } });
  };

  const continueBook = (item: ImportedBookItem, replace: boolean) => {
    if (!canAct() || !latest.current.userId || item.categoryId !== latest.current.categoryId) return;
    chooseItem(item.itemId, item.categoryId, replace);
  };

  const loadBook = async (externalId: string, replace = false) => {
    if (!canAct() || !category || !validIsbn13(externalId)) return;
    if (!user) { loginForBook(externalId); return; }
    busy.current = true;
    const token = ++generation.current;
    const owner = user.id;
    const categoryId = category.id;
    setSelection({ phase: 'loading', externalId, replace });
    try {
      const item = await importBook.mutateAsync(externalId);
      if (token !== generation.current || !focused.current || latest.current.userId !== owner) return;
      if (item.categoryId !== categoryId) throw new AppError('ITEM_CATEGORY_MISMATCH');
      busy.current = false;
      setSelection({ phase: 'ready', externalId, replace, item });
      continueBook(item, replace);
    } catch (error) {
      if (token === generation.current && focused.current && latest.current.userId === owner) {
        setSelection({ phase: 'failed', externalId, replace, error });
      }
    } finally {
      if (token === generation.current) busy.current = false;
    }
  };

  const chooseBook = (entry: BookCatalogEntry) => {
    if (!canAct() || !category) return;
    if (entry.existingItemId) { chooseItem(entry.existingItemId, category.id); return; }
    void loadBook(entry.externalId);
  };

  const externalId = scalar(params.externalBookId)?.replace(/[-\s]/g, '');
  const validReturn = Boolean(externalId && validIsbn13(externalId));
  useEffect(() => {
    if (!authReady || !user || !category || !validReturn || !externalId
      || attemptedReturn.current === externalId || !canAct()) return;
    attemptedReturn.current = externalId;
    void loadBook(externalId, true);
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
      <Text style={styles.stateTitle}>{sessionError ? '로그인 상태를 확인하지 못했어요' : '로그인 상태를 확인하고 있어요'}</Text>
      {sessionError ? <Pressable onPress={retrySession} style={styles.secondaryButton}><Text style={styles.secondaryButtonText}>다시 확인하기</Text></Pressable> : <ActivityIndicator />}
    </View>
  </SafeAreaView>;

  return <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
      <Pressable accessibilityRole="button" accessibilityLabel="돌아가기" onPress={back} style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}><Text style={styles.backText}>‹</Text></Pressable>
      <Text style={styles.kicker}>YOUR BOOK ONE PICK</Text>
      <Text style={styles.title}>나의 책 원픽 찾기</Text>
      <Text style={styles.subtitle}>책 제목과 저자명으로 찾고, 내가 좋아하는 판본 한 권을 골라보세요.</Text>
      <Text style={styles.notice}>ISBN이 다른 개정판·번역판·전자책은 별도 판본으로 구분해요. 표지는 권리 확인 전까지 자동으로 가져오지 않습니다.</Text>

      {!category && !categories.isPending ? <View style={styles.stateCard}>
        <Text style={styles.stateTitle}>책 카테고리를 사용할 수 없어요</Text>
        <Text style={styles.stateText}>카테고리가 공개·선택 가능 상태인지 확인해주세요.</Text>
      </View> : null}
      {categories.isPending ? <ActivityIndicator style={styles.loading} /> : null}
      {params.externalBookId !== undefined && !validReturn ? <Text accessibilityRole="alert" style={styles.errorText}>책 선택 링크를 확인해주세요. 다시 검색할 수 있어요.</Text> : null}

      <Text style={styles.label}>책 제목</Text>
      <TextInput autoFocus accessibilityLabel="원픽 책 제목 검색" autoCapitalize="none" autoCorrect={false}
        editable={Boolean(category) && !importing} maxLength={100} value={title}
        onChangeText={(value) => { if (!busy.current) { setTitle(value); setSelection(null); } }}
        placeholder="예: 소년이 온다" placeholderTextColor="#89909C" returnKeyType="search" style={styles.input} />
      <Text style={styles.label}>저자명 · 선택</Text>
      <TextInput accessibilityLabel="원픽 책 저자 검색" autoCapitalize="none" autoCorrect={false}
        editable={Boolean(category) && !importing} maxLength={100} value={author}
        onChangeText={(value) => { if (!busy.current) { setAuthor(value); setSelection(null); } }}
        placeholder="예: 한강" placeholderTextColor="#89909C" returnKeyType="search" style={styles.input} />
      {cleanTitle.length === 1 && cleanAuthor.length < 2 ? <Text style={styles.stateText}>한 글자 제목은 저자명을 함께 입력해주세요.</Text> : null}

      {isSearching ? <View style={styles.inlineState}><ActivityIndicator /><Text style={styles.stateText}>등록된 책과 국립중앙도서관 서지정보를 함께 찾고 있어요</Text></View> : null}
      {local.isError ? <View style={styles.stateCard}><Text style={styles.stateTitle}>등록된 책 검색을 불러오지 못했어요</Text>
        <Pressable disabled={local.isFetching} onPress={() => void local.refetch()} style={styles.secondaryButton}><Text style={styles.secondaryButtonText}>다시 검색</Text></Pressable></View> : null}
      {catalog.valid && catalog.isError ? <View style={styles.stateCard}>
        <Text style={styles.stateTitle}>외부 책 DB를 불러오지 못했어요</Text>
        <Text style={styles.stateText}>{bookErrorMessage(catalog.error)}</Text>
        <Pressable disabled={catalog.isFetching} onPress={() => void catalog.refetch()} style={styles.secondaryButton}><Text style={styles.secondaryButtonText}>책 DB 다시 검색</Text></Pressable>
      </View> : null}

      {selection?.phase === 'loading' ? <View style={styles.inlineState}><ActivityIndicator /><Text style={styles.stateText}>선택한 책 정보를 준비하고 있어요</Text></View> : null}
      {selection && selection.phase !== 'loading' ? <View style={styles.stateCard}>
        <Text accessibilityRole={selection.phase === 'failed' ? 'alert' : undefined} style={styles.stateText}>
          {selection.phase === 'failed' ? bookErrorMessage(selection.error) : selection.phase === 'ready' ? '선택한 책 정보가 준비됐어요.' : '이전 책 선택을 다시 이어갈 수 있어요.'}
        </Text>
        {selection.phase === 'ready'
          ? <Pressable onPress={() => continueBook(selection.item, selection.replace)} style={styles.secondaryButton}><Text style={styles.secondaryButtonText}>선택한 책으로 계속</Text></Pressable>
          : selection.phase === 'failed' && selection.error instanceof AppError && selection.error.code === 'AUTH_REQUIRED'
            ? <Pressable onPress={() => loginForBook(selection.externalId)} style={styles.secondaryButton}><Text style={styles.secondaryButtonText}>다시 로그인하고 책 선택 계속</Text></Pressable>
            : <Pressable onPress={() => void loadBook(selection.externalId, selection.replace)} style={styles.secondaryButton}><Text style={styles.secondaryButtonText}>선택한 책 다시 불러오기</Text></Pressable>}
      </View> : null}

      {validReturn && !user && !selection ? <View style={styles.stateCard}>
        <Text style={styles.stateText}>선택한 책을 이어가려면 로그인이 필요해요.</Text>
        <Pressable onPress={() => loginForBook(externalId!)} style={styles.secondaryButton}><Text style={styles.secondaryButtonText}>로그인하고 책 선택 계속</Text></Pressable>
      </View> : null}

      {cleanTitle && localItems.map((item) => <View key={item.id} style={styles.itemCard}>
        <PickPhoto uri={item.thumbnailUrl ?? item.imageUrl ?? item.imageSourceUrl} label={item.name}
          itemId={item.id} itemStatus={item.status} hasPhoto={Boolean(item.imagePath)} />
        <Pressable accessibilityRole="button" accessibilityLabel={`${item.name} 원픽 선택`} disabled={importing}
          onPress={() => chooseItem(item.id, item.categoryId)} style={({ pressed }) => [styles.itemCopy, pressed && styles.pressed]}>
          <Text style={styles.itemCategory}>콘텐츠 › 책 · 등록됨</Text>
          <Text style={styles.itemName}>{item.originalName ?? item.name}</Text>
          {item.creatorName ? <Text style={styles.author}>{item.creatorName}</Text> : null}
          {item.collectionName ? <Text style={styles.meta}>{item.collectionName}{item.releaseYear ? ` · ${item.releaseYear}` : ''}</Text> : item.releaseYear ? <Text style={styles.meta}>{item.releaseYear}</Text> : null}
          <Text style={styles.itemAction}>이 책을 원픽으로 선택 ›</Text>
        </Pressable>
      </View>)}

      {!catalog.isWaiting && !catalog.isError && catalog.valid && external.map((entry) => <Pressable
        key={entry.externalId} accessibilityRole="button" accessibilityLabel={`${entry.title} ${entry.authorName ?? ''} 책 선택`}
        accessibilityState={{ disabled: importing }} disabled={importing} onPress={() => chooseBook(entry)}
        style={({ pressed }) => [styles.itemCard, pressed && styles.pressed, importing && styles.disabled]}>
        <PickPhoto uri={null} label={`${entry.title} 표지 미등록`} />
        <View style={styles.itemCopy}>
          <Text style={styles.itemCategory}>콘텐츠 › 책 · 국립중앙도서관</Text>
          <Text style={styles.itemName}>{entry.title}</Text>
          <Text style={styles.author}>{entry.authorName ?? '저자 정보 없음'}</Text>
          <Text style={styles.meta}>{[entry.publisherName, entry.publishYear, entry.editionStatement, entry.isEbook === true ? '전자책' : entry.isEbook === false ? '인쇄책' : entry.formatName].filter(Boolean).join(' · ') || '판본 정보 없음'}</Text>
          <Text style={styles.isbn}>ISBN {entry.externalId}</Text>
          <Text style={styles.itemAction}>{selection?.externalId === entry.externalId && importing ? '책 정보를 준비하고 있어요…' : '이 책을 원픽으로 선택 ›'}</Text>
        </View>
      </Pressable>)}

      {noResults ? <View style={styles.stateCard}><Text style={styles.stateTitle}>일치하는 책을 찾지 못했어요</Text>
        <Text style={styles.stateText}>제목 철자나 저자명을 바꿔서 검색해보세요.</Text></View> : null}

      <Text style={styles.attribution}>서지정보: 국립중앙도서관 ISBN 서지정보 Open API · 표지는 권리 확인 전까지 OnePick에서 자동 사용하지 않습니다.</Text>
    </ScrollView>
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#F5F6F8' },
  content: { width: '100%', maxWidth: 520, alignSelf: 'center', paddingHorizontal: 20, paddingBottom: 40 },
  backButton: { width: 44, height: 44, justifyContent: 'center', marginTop: 4, marginLeft: -8 },
  backText: { color: '#202124', fontSize: 36, lineHeight: 40, fontWeight: '300' },
  kicker: { color: '#4945ED', fontSize: 12, fontWeight: '900', letterSpacing: 2, marginTop: 12 },
  title: { color: '#202124', fontSize: 27, lineHeight: 35, fontWeight: '900', letterSpacing: -0.8, marginTop: 8 },
  subtitle: { color: '#747985', fontSize: 13, lineHeight: 20, marginTop: 10 },
  notice: { color: '#5F6470', fontSize: 12, lineHeight: 18, backgroundColor: '#FFFFFF', borderRadius: 14, padding: 14, marginTop: 14 },
  label: { color: '#202124', fontSize: 13, fontWeight: '800', marginTop: 18, marginBottom: 7 },
  input: { minHeight: 52, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#E3E5EA', borderRadius: 16, paddingHorizontal: 15, color: '#202124', fontSize: 15 },
  loading: { marginTop: 18 },
  inlineState: { flexDirection: 'row', alignItems: 'center', gap: 9, paddingVertical: 18 },
  stateCard: { borderWidth: 1, borderColor: '#E3E5EA', backgroundColor: '#FFFFFF', borderRadius: 18, padding: 18, marginTop: 16 },
  stateTitle: { color: '#202124', fontSize: 15, fontWeight: '800' },
  stateText: { color: '#747985', fontSize: 12, lineHeight: 18, marginTop: 7 },
  errorText: { color: '#A9482D', fontSize: 12, lineHeight: 18, marginTop: 12 },
  itemCard: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: '#E3E5EA', backgroundColor: '#FFFFFF', borderRadius: 20, padding: 12, marginTop: 11 },
  itemCopy: { flex: 1, paddingLeft: 14, minHeight: 86, justifyContent: 'center' },
  itemCategory: { color: '#4945ED', fontSize: 11, fontWeight: '800', letterSpacing: 0.6 },
  itemName: { color: '#202124', fontSize: 16, fontWeight: '800', marginTop: 5 },
  author: { color: '#444A55', fontSize: 13, fontWeight: '700', marginTop: 4 },
  meta: { color: '#747985', fontSize: 12, lineHeight: 18, marginTop: 4 },
  isbn: { color: '#89909C', fontSize: 10, marginTop: 4 },
  itemAction: { color: '#747985', fontSize: 12, marginTop: 7 },
  secondaryButton: { alignSelf: 'flex-start', minHeight: 42, borderRadius: 13, backgroundColor: '#202124', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 15, marginTop: 13 },
  secondaryButtonText: { color: '#FFFFFF', fontSize: 12, fontWeight: '800' },
  centerState: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 28 },
  attribution: { color: '#89909C', fontSize: 10, lineHeight: 15, marginTop: 24, marginBottom: 10 },
  pressed: { opacity: 0.7 },
  disabled: { opacity: 0.5 },
});
