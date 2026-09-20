import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PickPhoto } from '@/components/pick-photo';
import { GameSearchLink } from '@/components/game-search-link';
import { MusicSearchLink } from '@/components/music-search-link';
import { AppError } from '@/errors/appError';
import { useAuthSession } from '@/hooks/useAuthSession';
import { useExploreCategories } from '@/hooks/useExploreData';
import { useItemSearch } from '@/hooks/useItemSearch';
import { useImportMovieCatalogItem, useMovieCatalogSearch } from '@/hooks/useMovieCatalog';
import { useRegistrationCategories } from '@/hooks/useRegisterPick';
import { categoryLabel, selectionCategoryGroups } from '@/lib/categories/categoryTree';
import type { ImportedMovieItem, MovieCatalogEntry } from '@/types/domain/movieCatalog';

type Params = { categoryId?: string | string[]; externalMovieId?: string | string[]; externalDramaId?: string | string[]; query?: string | string[]; onboarding?: string | string[] };
type Selection = { externalId: string; replace: boolean } & (
  | { phase: 'loading' | 'paused' }
  | { phase: 'failed'; error: unknown }
  | { phase: 'ready'; item: ImportedMovieItem }
);
const scalar = (value: string | string[] | undefined) => typeof value === 'string' ? value : undefined;

function movieErrorMessage(error: unknown, label: string) {
  if (error instanceof AppError) {
    if (error.code === 'AUTH_REQUIRED') return `로그인 상태를 다시 확인한 뒤 선택한 ${label}를 이어가주세요.`;
    if (error.code === 'RATE_LIMITED') return `${label} 요청이 많아요. 잠시 기다린 뒤 다시 시도해주세요.`;
    if (error.code === 'ITEM_NOT_FOUND' || error.code === 'ITEM_NOT_ELIGIBLE') return `지금은 이 ${label}를 선택할 수 없어요. 다른 ${label}를 찾아주세요.`;
    if (error.code === 'CATEGORY_NOT_FOUND' || error.code === 'ITEM_CATEGORY_MISMATCH') return `${label} 카테고리 정보를 확인하지 못했어요. 카테고리를 다시 불러와주세요.`;
  }
  return `${label} 정보를 불러오지 못했어요. 선택한 ${label}로 다시 시도할 수 있어요.`;
}

export default function FindPickItemScreen() {
  const auth = useAuthSession();
  const params = useLocalSearchParams<Params>();
  const key = JSON.stringify([auth.user?.id ?? null, params.categoryId ?? null, params.externalMovieId ?? null, params.externalDramaId ?? null, params.query ?? null, params.onboarding ?? null]);
  return <FindPickItemContent key={key} auth={auth} params={params} />;
}

function FindPickItemContent({ auth, params }: { auth: ReturnType<typeof useAuthSession>; params: Params }) {
  const router = useRouter();
  const { user, isLoading: sessionLoading, error: sessionError, retry: retrySession } = auth;
  const authReady = !sessionLoading && !sessionError;
  const [query, setQuery] = useState(() => (scalar(params.query) ?? '').slice(0, 100));
  const [selection, setSelection] = useState<Selection | null>(null);
  const [parentCategoryId, setParentCategoryId] = useState<string | null>(null);
  const categories = useRegistrationCategories();
  const categoryCatalog = useExploreCategories(Boolean(categories.data));
  const selectableCategories = categories.data ?? [];
  const categoryGroups = useMemo(
    () => selectionCategoryGroups(categoryCatalog.data ?? [], selectableCategories),
    [categoryCatalog.data, selectableCategories],
  );
  const selectedParentGroup = categoryGroups.find((group) => group.category.id === parentCategoryId) ?? null;
  const selectedCategory = !categories.isError ? selectableCategories.find((category) => category.id === scalar(params.categoryId)) : undefined;
  const selectedCategoryLabel = selectedCategory
    ? (categoryCatalog.data?.length ? categoryLabel(selectedCategory, categoryCatalog.data) : selectedCategory.label ?? selectedCategory.name)
    : null;
  const search = useItemSearch(authReady && selectedCategory ? query : '', selectedCategory?.id);
  const isMovieCategory = selectedCategory?.slug === 'movie';
  const isDramaCategory = selectedCategory?.slug === 'drama';
  const isMusicCategory = selectedCategory?.slug === 'music';
  const isGameCategory = selectedCategory?.slug === 'game';
  const isYouTubeCategory = selectedCategory?.slug === 'youtube';
  const isCatalogCategory = isMovieCategory || isDramaCategory;
  const label = isDramaCategory ? '드라마' : '영화';
  const mediaType = isDramaCategory ? 'tv' : 'movie';
  const source = isDramaCategory ? 'tmdb_tv' : 'tmdb';
  const movieCatalog = useMovieCatalogSearch(query, Boolean(authReady && isCatalogCategory), mediaType);
  const importMovie = useImportMovieCatalogItem(mediaType);
  const normalizedQuery = query.trim().replace(/\s+/g, ' ');
  const hasQuery = normalizedQuery.length > 0;
  const canSearchMovieCatalog = normalizedQuery.length >= 2 && normalizedQuery.length <= 60;
  const localItems = authReady && selectedCategory && !search.isWaiting && !search.isError
    ? (search.data ?? []).filter((item) => item.categoryId === selectedCategory.id) : [];
  const externalMovies = (movieCatalog.data ?? []).filter((movie) => movie.source === source &&
    !localItems.some((item) => item.externalSource === movie.source && item.externalId === movie.externalId));
  const isSearching = search.isWaiting || search.isFetching
    || (isCatalogCategory && canSearchMovieCatalog && (movieCatalog.isWaiting || movieCatalog.isFetching));
  const noResults = hasQuery && Boolean(selectedCategory) && (!isCatalogCategory || canSearchMovieCatalog)
    && !isSearching && !search.isError && (!isCatalogCategory || !movieCatalog.isError)
    && search.data?.length === 0 && (!isCatalogCategory || externalMovies.length === 0);

  const focused = useRef(false);
  const generation = useRef(0);
  const busy = useRef(false);
  const navigating = useRef(false);
  const attemptedReturn = useRef<string | null>(null);
  const latest = useRef({ authReady, userId: user?.id, categoryId: selectedCategory?.id, isCatalogCategory });
  latest.current = { authReady, userId: user?.id, categoryId: selectedCategory?.id, isCatalogCategory };
  useFocusEffect(useCallback(() => {
    focused.current = true;
    navigating.current = false;
    return () => {
      focused.current = false; generation.current++; busy.current = false;
      setSelection((current) => current?.phase === 'loading' ? { ...current, phase: 'paused' } : current);
    };
  }, []));

  useEffect(() => {
    if (!authReady || !selectedCategory || !isYouTubeCategory || navigating.current) return;
    navigating.current = true;
    router.replace({
      pathname: '/pick/youtube',
      params: {
        categoryId: selectedCategory.id,
        ...(query.trim() ? { query: query.trim() } : {}),
        ...(scalar(params.onboarding) === '1' ? { onboarding: '1' } : {}),
      },
    });
  }, [authReady, isYouTubeCategory, params.onboarding, query, router, selectedCategory]);

  const importing = selection?.phase === 'loading';
  const canAct = () => focused.current && latest.current.authReady && !busy.current && !navigating.current;
  const chooseItem = (itemId: string, categoryId: string) => {
    if (!canAct() || latest.current.categoryId !== categoryId) return;
    navigating.current = true;
    router.push({ pathname: '/pick/choose', params: { itemId, categoryId, ...(scalar(params.onboarding) === '1' ? { onboarding: '1' } : {}) } });
  };
  const selectCategory = (categoryId: string) => {
    if (!canAct()) return;
    navigating.current = true;
    router.replace({ pathname: '/pick/find', params: { categoryId, ...(query.trim() ? { query: query.trim() } : {}) } });
  };
  const requestItem = () => {
    if (!canAct() || !selectedCategory || !hasQuery || isCatalogCategory || isMusicCategory || isGameCategory) return;
    navigating.current = true;
    router.push({ pathname: '/pick/request', params: { itemName: query.trim(), categoryId: selectedCategory.id } });
  };
  const loginForMovie = (externalId: string) => {
    if (!canAct() || !selectedCategory || !isCatalogCategory) return;
    navigating.current = true;
    router.push({ pathname: '/auth/login', params: { action: isDramaCategory ? 'choose_drama' : 'choose_movie', externalId, categoryId: selectedCategory.id } });
  };
  const continueMovie = (item: ImportedMovieItem, replace: boolean) => {
    if (!canAct() || !latest.current.userId || item.categoryId !== latest.current.categoryId) return;
    navigating.current = true;
    const route = { pathname: '/pick/choose' as const, params: { itemId: item.itemId, categoryId: item.categoryId, ...(scalar(params.onboarding) === '1' ? { onboarding: '1' } : {}) } };
    if (replace) router.replace(route); else router.push(route);
  };
  const loadMovie = async (externalId: string, replace = false) => {
    if (!canAct() || !isCatalogCategory || !selectedCategory || !/^\d{1,12}$/.test(externalId)) return;
    if (!user) { loginForMovie(externalId); return; }
    busy.current = true;
    const token = ++generation.current;
    const owner = user.id;
    const categoryId = selectedCategory.id;
    setSelection({ phase: 'loading', externalId, replace });
    try {
      const item = await importMovie.mutateAsync(externalId);
      if (token !== generation.current || !focused.current || latest.current.userId !== owner) return;
      if (item.categoryId !== categoryId) throw new AppError('ITEM_CATEGORY_MISMATCH');
      busy.current = false;
      setSelection({ phase: 'ready', externalId, replace, item });
      continueMovie(item, replace);
    } catch (error) {
      if (token === generation.current && focused.current && latest.current.userId === owner) setSelection({ phase: 'failed', externalId, replace, error });
    } finally { if (token === generation.current) busy.current = false; }
  };
  const chooseMovie = (movie: MovieCatalogEntry) => {
    if (!canAct() || !selectedCategory || !isCatalogCategory || movie.source !== source) return;
    if (movie.existingItemId) { chooseItem(movie.existingItemId, selectedCategory.id); return; }
    void loadMovie(movie.externalId);
  };
  // Media-specific login returns cannot accidentally treat a movie ID as a TV ID.
  const hasReturn = params.externalMovieId !== undefined || params.externalDramaId !== undefined;
  const externalId = scalar(isDramaCategory ? params.externalDramaId : params.externalMovieId);
  const wrongReturn = isDramaCategory ? params.externalMovieId !== undefined : params.externalDramaId !== undefined;
  const validReturn = Boolean(isCatalogCategory && !wrongReturn && externalId && /^\d{1,12}$/.test(externalId));
  useEffect(() => {
    if (parentCategoryId && !categoryGroups.some((group) => group.category.id === parentCategoryId)) {
      setParentCategoryId(null);
    }
  }, [categoryGroups, parentCategoryId]);

  useEffect(() => {
    if (!authReady || !user || !isCatalogCategory || !selectedCategory || !validReturn || !externalId
      || attemptedReturn.current === externalId || !canAct()) return;
    attemptedReturn.current = externalId;
    void loadMovie(externalId, true);
  });
  const back = () => {
    if (!focused.current || navigating.current) return;
    generation.current++; busy.current = false; navigating.current = true;
    setSelection((current) => current?.phase === 'loading' ? { ...current, phase: 'paused' } : current);
    if (router.canGoBack()) router.back(); else router.replace('/');
  };

  if (!authReady) return <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
    <View style={styles.stateCard}>
      <Text style={styles.stateTitle}>{sessionError ? '로그인 상태를 확인하지 못했어요' : '로그인 상태를 확인하고 있어요'}</Text>
      {sessionError ? <Pressable accessibilityRole="button" onPress={retrySession} style={styles.secondaryButton}><Text style={styles.secondaryButtonText}>다시 확인하기</Text></Pressable> : <ActivityIndicator />}
      <Pressable accessibilityRole="button" onPress={back} style={styles.backButton}><Text>돌아가기</Text></Pressable>
    </View>
  </SafeAreaView>;

  return <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
      <Pressable accessibilityRole="button" accessibilityLabel="돌아가기" onPress={back} style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}><Text style={styles.backText}>‹</Text></Pressable>
      <Text style={styles.kicker}>FIND YOUR ONE PICK</Text><Text style={styles.title}>나의 원픽 찾기</Text>
      <Text style={styles.subtitle}>{isCatalogCategory ? `좋아하는 ${label} 제목을 검색하고, 나만의 하나를 골라보세요.` : '좋아하는 제품을 검색하고, 나만의 하나를 골라보세요.'}</Text>
      {isDramaCategory ? <Text style={styles.stateText}>드라마·시트콤을 작품 단위로 선택해요. 시즌·회차는 나누지 않아요. 애니메이션·예능·다큐는 아직 포함하지 않아요.</Text> : null}
      {selectedCategory ? <View style={styles.categoryBadge}><Text style={styles.categoryBadgeText}>{selectedCategoryLabel} 안에서 찾는 중</Text></View> : <View style={styles.categorySection}>
        <Text style={styles.categoryTitle}>먼저 카테고리를 선택해주세요</Text>
        <Text style={styles.categoryStep}>상위 카테고리</Text>
        {!categories.isError ? <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.parentCategoryRow}>
          {categoryGroups.map((group) => {
            const selected = parentCategoryId === group.category.id;
            return <Pressable key={group.category.id} accessibilityRole="button"
              accessibilityLabel={`${group.category.name} 상위 카테고리 선택`}
              accessibilityState={{ selected }}
              onPress={() => group.directlySelectable ? selectCategory(group.category.id) : setParentCategoryId(group.category.id)}
              style={({ pressed }) => [styles.parentCategoryChip, selected && styles.parentCategoryChipActive, pressed && styles.pressed]}>
              <Text style={[styles.parentCategoryText, selected && styles.parentCategoryTextActive]}>{group.category.name}</Text>
            </Pressable>;
          })}
        </ScrollView> : null}
        {selectedParentGroup && !selectedParentGroup.directlySelectable ? <View style={styles.childCategoryPanel}>
          <View style={styles.childCategoryHeader}>
            <Text style={styles.categoryStep}>{selectedParentGroup.category.name} 카테고리</Text>
            <Text style={styles.childCategoryCount}>{selectedParentGroup.children.length}개</Text>
          </View>
          <View style={styles.categoryList}>{selectedParentGroup.children.map((category) => <Pressable key={category.id} accessibilityRole="button"
            accessibilityLabel={`${selectedParentGroup.category.name} › ${category.name} 카테고리 선택`}
            onPress={() => selectCategory(category.id)}
            style={({ pressed }) => [styles.categoryChip, pressed && styles.pressed]}>
            <Text style={styles.categoryChipText}>{category.name}</Text>
          </Pressable>)}</View>
        </View> : null}
        {categories.isPending ? <ActivityIndicator style={styles.categoryLoading} /> : null}
        {categories.isError ? <Pressable accessibilityRole="button" disabled={categories.isFetching} onPress={() => { if (!categories.isFetching) void categories.refetch(); }} style={styles.secondaryButton}><Text style={styles.secondaryButtonText}>카테고리 다시 불러오기</Text></Pressable> : null}
      </View>}
      {hasReturn && !validReturn && !categories.isPending ? <Text accessibilityRole="alert" style={styles.errorText}>작품 선택 링크의 종류와 카테고리를 확인해주세요. 해당 카테고리에서 다시 검색할 수 있어요.</Text> : null}
      <TextInput autoFocus={Boolean(selectedCategory) && !validReturn} accessibilityLabel={isCatalogCategory ? `원픽 ${label} 검색` : '원픽 제품 검색'} autoCapitalize="none"
        maxLength={100} editable={Boolean(selectedCategory) && !importing} onChangeText={(value) => { if (!busy.current) { setQuery(value); setSelection(null); } }}
        placeholder={!selectedCategory ? '카테고리를 먼저 선택해주세요' : isCatalogCategory ? `${label} 제목 검색` : '제품명 검색'} placeholderTextColor="#89909C" returnKeyType="search" style={styles.input} value={query} />
      {isCatalogCategory && normalizedQuery.length > 60 ? <Text accessibilityRole="alert" style={styles.stateText}>{label} DB 검색어는 60자 이내로 입력해주세요. 등록된 상품 검색은 계속 사용할 수 있어요.</Text> : null}
      {isSearching ? <View style={styles.inlineState}><ActivityIndicator /><Text style={styles.stateText}>{isCatalogCategory ? `등록된 ${label}와 TMDB를 함께 찾고 있어요` : '등록된 제품을 찾고 있어요'}</Text></View> : null}
      {search.isError ? <View style={styles.stateCard}><Text style={styles.stateTitle}>제품 검색을 불러오지 못했어요</Text><Pressable disabled={search.isFetching} onPress={() => { if (!search.isFetching) void search.refetch(); }} style={styles.secondaryButton}><Text style={styles.secondaryButtonText}>다시 검색</Text></Pressable></View> : null}
      {isCatalogCategory && canSearchMovieCatalog && movieCatalog.isError ? <View style={styles.stateCard}>
        <Text style={styles.stateTitle}>외부 {label} 검색을 불러오지 못했어요</Text><Text style={styles.stateText}>등록된 {label} 검색은 계속 사용할 수 있어요.</Text>
        <Pressable disabled={movieCatalog.isFetching} onPress={() => { if (!movieCatalog.isFetching) void movieCatalog.refetch(); }} style={styles.secondaryButton}><Text style={styles.secondaryButtonText}>TMDB 다시 검색</Text></Pressable>
      </View> : null}
      {selectedCategory && !hasQuery && !validReturn ? <View style={styles.stateCard}><Text style={styles.stateTitle}>{isCatalogCategory ? `${label} 제목만 입력하면 됩니다` : '제품명만 입력하면 됩니다'}</Text><Text style={styles.stateText}>검색 결과를 선택하면 원픽을 남길 수 있어요.</Text></View> : null}
      {isCatalogCategory && hasQuery && normalizedQuery.length < 2 ? <View style={styles.stateCard}><Text style={styles.stateTitle}>두 글자 이상 입력해주세요</Text><Text style={styles.stateText}>한국어 제목과 원제를 함께 검색합니다.</Text></View> : null}
      {selection?.phase === 'loading' ? <View style={styles.inlineState}><ActivityIndicator /><Text style={styles.stateText}>선택한 {label} 정보를 불러오고 있어요</Text></View> : null}
      {selection && selection.phase !== 'loading' ? <View style={styles.stateCard}>
        <Text accessibilityRole={selection.phase === 'failed' ? 'alert' : undefined} style={styles.stateText}>{selection.phase === 'failed' ? movieErrorMessage(selection.error, label) : selection.phase === 'ready' ? `선택한 ${label} 정보가 준비됐어요.` : `이전 ${label} 선택을 다시 이어갈 수 있어요.`}</Text>
        {selection.phase === 'ready' ? <Pressable accessibilityRole="button" onPress={() => continueMovie(selection.item, selection.replace)} style={styles.secondaryButton}><Text style={styles.secondaryButtonText}>선택한 {label}로 계속</Text></Pressable>
          : selection.phase === 'failed' && selection.error instanceof AppError && selection.error.code === 'AUTH_REQUIRED'
            ? <Pressable accessibilityRole="button" onPress={() => loginForMovie(selection.externalId)} style={styles.secondaryButton}><Text style={styles.secondaryButtonText}>다시 로그인하고 {label} 선택 계속</Text></Pressable>
            : <Pressable accessibilityRole="button" onPress={() => void loadMovie(selection.externalId, selection.replace)} style={styles.secondaryButton}><Text style={styles.secondaryButtonText}>선택한 {label} 다시 불러오기</Text></Pressable>}
      </View> : null}
      {validReturn && isCatalogCategory && !user && !selection ? <View style={styles.stateCard}><Text style={styles.stateText}>선택한 {label}를 이어가려면 로그인이 필요해요.</Text><Pressable accessibilityRole="button" onPress={() => loginForMovie(externalId!)} style={styles.secondaryButton}><Text style={styles.secondaryButtonText}>로그인하고 {label} 선택 계속</Text></Pressable></View> : null}
      {hasQuery && localItems.map((item) => {
        const category = categories.data?.find((category) => category.id === item.categoryId);
        return <View key={item.id} style={styles.itemCard}>
          <PickPhoto uri={item.thumbnailUrl ?? item.imageUrl ?? item.imageSourceUrl} label={item.name} itemId={item.id} itemStatus={item.status} hasPhoto={Boolean(item.imagePath)} />
          <Pressable accessibilityRole="button" accessibilityLabel={`${item.name} 원픽 선택`} disabled={importing} onPress={() => chooseItem(item.id, item.categoryId)} style={({ pressed }) => [styles.itemCopy, styles.itemActionArea, pressed && styles.pressed]}>
            <Text style={styles.itemCategory}>{category ? (categoryCatalog.data?.length ? categoryLabel(category, categoryCatalog.data) : category.label ?? category.name) : '등록된 카테고리'}</Text><Text style={styles.itemName}>{item.name}</Text>
            {isCatalogCategory ? <Text style={styles.movieMeta}>{[item.releaseYear, item.originalName !== item.name ? item.originalName : null].filter(Boolean).join(' · ') || (isDramaCategory ? '첫 방영 정보 없음' : '개봉 정보 없음')}</Text> : null}
            <Text style={styles.itemAction}>이 제품을 원픽으로 선택 ›</Text>
          </Pressable>
        </View>;
      })}
      {!movieCatalog.isWaiting && !movieCatalog.isError && isCatalogCategory && canSearchMovieCatalog && externalMovies.map((movie) => <Pressable key={`${movie.source}:${movie.externalId}`} accessibilityRole="button"
        accessibilityLabel={`${movie.title} ${label} 선택`} accessibilityState={{ disabled: importing }} disabled={importing} onPress={() => chooseMovie(movie)} style={({ pressed }) => [styles.itemCard, pressed && styles.pressed, importing && styles.disabled]}>
        <PickPhoto uri={movie.posterUrl} label={`${movie.title} 포스터`} />
        <View style={styles.itemCopy}><Text style={styles.itemCategory}>콘텐츠 › {label} · TMDB</Text><Text style={styles.itemName}>{movie.title}</Text>
          <Text style={styles.movieMeta}>{[movie.releaseYear, movie.originalTitle !== movie.title ? movie.originalTitle : null].filter(Boolean).join(' · ') || (isDramaCategory ? '첫 방영 정보 없음' : '개봉 정보 없음')}</Text>
          <Text style={styles.itemAction}>{selection?.externalId === movie.externalId && importing ? `${label} 정보를 불러오고 있어요…` : `이 ${label}를 원픽으로 선택 ›`}</Text>
        </View>
      </Pressable>)}
      {noResults && !isCatalogCategory && !isMusicCategory && !isGameCategory ? <View style={styles.requestCard}><Text style={styles.stateTitle}>찾는 제품이 없나요?</Text><Text style={styles.stateText}>검색한 제품명을 그대로 가져가 등록 요청을 보낼 수 있어요.</Text><Pressable onPress={requestItem} style={styles.primaryButton}><Text style={styles.primaryButtonText}>제품 등록 요청하기</Text></Pressable></View> : null}
      {noResults && isMusicCategory && selectedCategory ? <View style={styles.requestCard}>
        <Text style={styles.stateTitle}>등록된 노래에서 찾지 못했어요</Text><Text style={styles.stateText}>MusicBrainz에서 곡명과 가수명으로 더 찾아볼 수 있어요.</Text>
        <MusicSearchLink query={normalizedQuery} categoryId={selectedCategory.id} />
      </View> : null}
      {noResults && isGameCategory && selectedCategory ? <View style={styles.requestCard}>
        <Text style={styles.stateTitle}>등록된 게임에서 찾지 못했어요</Text><Text style={styles.stateText}>IGDB에서 게임 이름으로 더 찾아볼 수 있어요.</Text>
        <GameSearchLink query={normalizedQuery} categoryId={selectedCategory.id} />
      </View> : null}
      {noResults && isCatalogCategory ? <View style={styles.requestCard}><Text style={styles.stateTitle}>일치하는 {label}를 찾지 못했어요</Text><Text style={styles.stateText}>띄어쓰기나 한국어·원제 제목을 바꿔서 검색해보세요.</Text></View> : null}
      {isCatalogCategory ? <Text style={styles.attribution}>This product uses the TMDB API but is not endorsed or certified by TMDB.</Text> : null}
    </ScrollView>
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#F5F6F8' },
  content: { width: '100%', maxWidth: 480, alignSelf: 'center', paddingHorizontal: 20, paddingBottom: 36 },
  backButton: { width: 44, height: 44, justifyContent: 'center', marginTop: 4, marginLeft: -8 },
  backText: { color: '#202124', fontSize: 36, lineHeight: 38, fontWeight: '300' },
  kicker: { color: '#4945ED', fontSize: 12, fontWeight: '900', letterSpacing: 2.1, marginTop: 12 },
  title: { color: '#202124', fontSize: 26, lineHeight: 34, fontWeight: '900', letterSpacing: -0.8, marginTop: 8 },
  subtitle: { color: '#747985', fontSize: 13, lineHeight: 20, marginTop: 10 },
  categoryBadge: { alignSelf: 'flex-start', backgroundColor: '#EFEEFF', borderRadius: 999, paddingHorizontal: 13, paddingVertical: 8, marginTop: 16 },
  categoryBadgeText: { color: '#4945ED', fontSize: 12, fontWeight: '800' },
  categorySection: { borderWidth: 1, borderColor: '#E3E5EA', backgroundColor: '#FFFFFF', borderRadius: 18, padding: 18, marginTop: 18 },
  categoryTitle: { color: '#202124', fontSize: 14, fontWeight: '900' },
  categoryStep: { color: '#747985', fontSize: 11, fontWeight: '800', marginTop: 12 },
  parentCategoryRow: { gap: 8, paddingVertical: 8, paddingRight: 4 },
  parentCategoryChip: { minHeight: 36, justifyContent: 'center', borderWidth: 1, borderColor: '#E3E5EA', borderRadius: 999, backgroundColor: '#FFFFFF', paddingHorizontal: 13 },
  parentCategoryChipActive: { borderColor: '#4945ED', backgroundColor: '#EFEEFF' },
  parentCategoryText: { color: '#747985', fontSize: 12, fontWeight: '700' },
  parentCategoryTextActive: { color: '#4945ED', fontWeight: '900' },
  childCategoryPanel: { marginTop: 4, paddingTop: 8, borderTopWidth: 1, borderTopColor: '#ECEEF3' },
  childCategoryHeader: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 },
  childCategoryCount: { color: '#89909C', fontSize: 10, fontWeight: '700' },
  categoryList: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 },
  categoryChip: { minHeight: 42, justifyContent: 'center', borderRadius: 999, backgroundColor: '#EFEEFF', paddingHorizontal: 14, paddingVertical: 9 },
  categoryChipText: { color: '#4945ED', fontSize: 12, fontWeight: '800' },
  categoryLoading: { marginTop: 14 },
  input: { minHeight: 54, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#E3E5EA', borderRadius: 17, paddingHorizontal: 16, color: '#202124', fontSize: 16, marginTop: 22 },
  inlineState: { flexDirection: 'row', alignItems: 'center', gap: 9, paddingVertical: 18 },
  stateCard: { borderWidth: 1, borderColor: '#E3E5EA', backgroundColor: '#FFFFFF', borderRadius: 18, padding: 20, marginTop: 16 },
  requestCard: { borderWidth: 1, borderColor: '#E3E5EA', backgroundColor: '#FFFFFF', borderRadius: 20, padding: 22, marginTop: 18 },
  stateTitle: { color: '#202124', fontSize: 15, fontWeight: '800' },
  stateText: { color: '#747985', fontSize: 12, lineHeight: 18, marginTop: 7 },
  itemCard: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: '#E3E5EA', backgroundColor: '#FFFFFF', borderRadius: 20, padding: 12, marginTop: 11 },
  itemCopy: { flex: 1, paddingLeft: 14 },
  itemActionArea: { minHeight: 86, justifyContent: 'center' },
  itemCategory: { color: '#4945ED', fontSize: 12, fontWeight: '800', letterSpacing: 0.8 },
  itemName: { color: '#202124', fontSize: 16, fontWeight: '800', marginTop: 5 },
  itemAction: { color: '#747985', fontSize: 12, marginTop: 7 },
  movieMeta: { color: '#747985', fontSize: 12, lineHeight: 18, marginTop: 5 },
  errorText: { color: '#A9482D', fontSize: 12, lineHeight: 18, marginTop: 12 },
  attribution: { color: '#89909C', fontSize: 10, lineHeight: 15, marginTop: 24, marginBottom: 10 },
  primaryButton: { minHeight: 50, borderRadius: 15, backgroundColor: '#4945ED', alignItems: 'center', justifyContent: 'center', marginTop: 16 },
  primaryButtonText: { color: '#FFFFFF', fontSize: 14, fontWeight: '900' },
  secondaryButton: { alignSelf: 'flex-start', minHeight: 42, borderRadius: 13, backgroundColor: '#202124', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 15, marginTop: 13 },
  secondaryButtonText: { color: '#FFFFFF', fontSize: 12, fontWeight: '800' },
  pressed: { opacity: 0.7 }, disabled: { opacity: 0.5 },
});
