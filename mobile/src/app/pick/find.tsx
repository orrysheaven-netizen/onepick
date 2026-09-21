import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PickPhoto } from '@/components/pick-photo';
import { Button, StateCard } from '@/components/ui';
import { GameSearchLink } from '@/components/game-search-link';
import { MusicSearchLink } from '@/components/music-search-link';
import { YoutubeSearchLink } from '@/components/youtube-search-link';
import { AppError } from '@/errors/appError';
import { useAuthSession } from '@/hooks/useAuthSession';
import { useItemSearch } from '@/hooks/useItemSearch';
import { useImportMovieCatalogItem, useMovieCatalogSearch } from '@/hooks/useMovieCatalog';
import { useRegistrationCategories } from '@/hooks/useRegisterPick';
import type { ImportedMovieItem, MovieCatalogEntry } from '@/types/domain/movieCatalog';
import { OnePick } from '@/constants/onepick';

type Params = { categoryId?: string | string[]; category?: string | string[]; externalMovieId?: string | string[]; externalDramaId?: string | string[]; query?: string | string[]; onboarding?: string | string[] };
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
  const key = JSON.stringify([auth.user?.id ?? null, params.categoryId ?? null, params.category ?? null, params.externalMovieId ?? null, params.externalDramaId ?? null, params.query ?? null, params.onboarding ?? null]);
  return <FindPickItemContent key={key} auth={auth} params={params} />;
}

function FindPickItemContent({ auth, params }: { auth: ReturnType<typeof useAuthSession>; params: Params }) {
  const router = useRouter();
  const { user, isLoading: sessionLoading, error: sessionError, retry: retrySession } = auth;
  const authReady = !sessionLoading && !sessionError;
  const [query, setQuery] = useState(() => (scalar(params.query) ?? '').slice(0, 100));
  const [selection, setSelection] = useState<Selection | null>(null);
  const categories = useRegistrationCategories();
  const requestedCategoryId = scalar(params.categoryId);
  // An invite link carries the slug instead: a UUID is not something anyone can
  // write into a message, and the slug survives being pasted around.
  const requestedCategorySlug = scalar(params.category)?.trim().toLowerCase();
  const hasRequestedCategory = Boolean(requestedCategoryId || requestedCategorySlug);
  const selectedCategory = !categories.isError
    ? categories.data?.find((category) => requestedCategoryId
      ? category.id === requestedCategoryId
      : Boolean(requestedCategorySlug) && category.slug === requestedCategorySlug)
    : undefined;
  const categoryScopeReady = !hasRequestedCategory || Boolean(selectedCategory);
  const unknownCategory = hasRequestedCategory && !selectedCategory
    && !categories.isPending && !categories.isError;
  const search = useItemSearch(authReady && categoryScopeReady ? query : '', selectedCategory?.id);
  const isMovieCategory = selectedCategory?.slug === 'movie';
  const isDramaCategory = selectedCategory?.slug === 'drama';
  const isMusicCategory = selectedCategory?.slug === 'music';
  const isGameCategory = selectedCategory?.slug === 'game';
  const isYoutubeCategory = selectedCategory?.slug === 'youtube';
  const isBookCategory = selectedCategory?.slug === 'book';
  const isPokemonCategory = selectedCategory?.slug === 'pokemon';
  const isCatalogCategory = isMovieCategory || isDramaCategory;
  const label = isDramaCategory ? '드라마' : '영화';
  const mediaType = isDramaCategory ? 'tv' : 'movie';
  const source = isDramaCategory ? 'tmdb_tv' : 'tmdb';
  const movieCatalog = useMovieCatalogSearch(query, Boolean(authReady && isCatalogCategory), mediaType);
  const importMovie = useImportMovieCatalogItem(mediaType);
  const normalizedQuery = query.trim().replace(/\s+/g, ' ');
  const hasQuery = normalizedQuery.length > 0;
  const canSearchMovieCatalog = normalizedQuery.length >= 2 && normalizedQuery.length <= 60;
  const localItems = authReady && categoryScopeReady && !search.isWaiting && !search.isError
    ? (search.data ?? []).filter((item) => !selectedCategory || item.categoryId === selectedCategory.id) : [];
  const externalMovies = (movieCatalog.data ?? []).filter((movie) => movie.source === source &&
    !localItems.some((item) => item.externalSource === movie.source && item.externalId === movie.externalId));
  const isSearching = search.isWaiting || search.isFetching
    || (isCatalogCategory && canSearchMovieCatalog && (movieCatalog.isWaiting || movieCatalog.isFetching));
  const hasSearchScope = authReady && categoryScopeReady;
  const noResults = hasQuery && hasSearchScope && (!isCatalogCategory || canSearchMovieCatalog)
    && !isSearching && !search.isError && (!isCatalogCategory || !movieCatalog.isError)
    && localItems.length === 0 && (!isCatalogCategory || externalMovies.length === 0);

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
  const importing = selection?.phase === 'loading';
  const canAct = () => focused.current && latest.current.authReady && !busy.current && !navigating.current;
  const chooseItem = (itemId: string, categoryId: string) => {
    if (!canAct()) return;
    if (latest.current.categoryId && latest.current.categoryId !== categoryId) return;
    navigating.current = true;
    router.push({ pathname: '/pick/choose', params: { itemId, categoryId, ...(scalar(params.onboarding) === '1' ? { onboarding: '1' } : {}) } });
  };
  const requestItem = () => {
    if (!canAct() || !hasQuery) return;
    if (selectedCategory && (isCatalogCategory || isMusicCategory || isGameCategory || isYoutubeCategory || isBookCategory || isPokemonCategory)) return;
    navigating.current = true;
    router.push({
      pathname: '/pick/request',
      params: { itemName: query.trim(), ...(selectedCategory ? { categoryId: selectedCategory.id } : {}) },
    });
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
    <View style={styles.gate}>
      <StateCard loading={!sessionError} tone={sessionError ? 'danger' : 'default'}
        title={sessionError ? '로그인 상태를 확인하지 못했어요' : '로그인 상태를 확인하고 있어요'}
        action={sessionError ? { label: '다시 확인하기', variant: 'secondary', onPress: retrySession } : undefined} />
      <Button variant="ghost" label="돌아가기" onPress={back} style={styles.centered} />
    </View>
  </SafeAreaView>;

  return <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
      <Pressable accessibilityRole="button" accessibilityLabel="돌아가기" onPress={back} style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}><Text style={styles.backText}>‹</Text></Pressable>
      <Text style={styles.title}>나의 원픽 찾기</Text>
      <Text style={styles.subtitle}>{isCatalogCategory ? `좋아하는 ${label} 제목을 검색하고, 나만의 하나를 골라보세요.` : selectedCategory ? '선택한 종류에서 원픽을 검색해보세요.' : hasRequestedCategory ? '선택한 검색 범위를 확인한 뒤 상품을 찾습니다.' : '카테고리 선택 없이 상품명만 검색하고 등록합니다.'}</Text>
      {isDramaCategory ? <Text style={styles.stateText}>드라마·시트콤을 작품 단위로 선택해요. 시즌·회차는 나누지 않아요. 애니메이션·예능·다큐는 아직 포함하지 않아요.</Text> : null}
      {selectedCategory ? <View style={styles.categoryBadge}><Text style={styles.categoryBadgeText}>{selectedCategory.label} 안에서 찾는 중</Text></View>
        : !hasRequestedCategory ? <Text style={styles.stateText}>카테고리는 비워두고 상품 등록만 진행합니다.</Text> : null}
      {hasRequestedCategory && categories.isError ? <View style={styles.block}><StateCard compact tone="danger" title="선택한 카테고리를 확인하지 못했어요" text="전체 상품 검색으로 바꾸지 않고, 기존 검색 범위를 다시 확인합니다."
        action={{ label: '카테고리 다시 불러오기', disabled: categories.isFetching, onPress: () => { if (!categories.isFetching) void categories.refetch(); } }} /></View> : null}
      {unknownCategory ? <View style={styles.block}><StateCard compact title="링크의 카테고리를 찾지 못했어요"
        text="카테고리 이름이 바뀌었거나 아직 열리지 않았을 수 있어요. 돌아가서 다른 카테고리를 골라 보세요." /></View> : null}
      {hasReturn && !validReturn && !categories.isPending ? <Text accessibilityRole="alert" style={styles.errorText}>작품 선택 링크의 종류와 카테고리를 확인해주세요. 해당 카테고리에서 다시 검색할 수 있어요.</Text> : null}
      <TextInput autoFocus={!validReturn} accessibilityLabel={isCatalogCategory ? `원픽 ${label} 검색` : selectedCategory ? '원픽 항목 검색' : '원픽 상품 검색'} autoCapitalize="none"
        maxLength={100} editable={hasSearchScope && !importing} onChangeText={(value) => { if (!busy.current) { setQuery(value); setSelection(null); } }}
        placeholder={isCatalogCategory ? `${label} 제목 검색` : selectedCategory ? '이름 검색' : '상품명 검색'} placeholderTextColor={OnePick.hint} returnKeyType="search" style={styles.input} value={query} />
      {isCatalogCategory && normalizedQuery.length > 60 ? <Text accessibilityRole="alert" style={styles.stateText}>{label} DB 검색어는 60자 이내로 입력해주세요. 등록된 상품 검색은 계속 사용할 수 있어요.</Text> : null}
      {isSearching ? <View style={styles.inlineState}><ActivityIndicator /><Text style={styles.stateText}>{isCatalogCategory ? `등록된 ${label}와 TMDB를 함께 찾고 있어요` : '등록된 제품을 찾고 있어요'}</Text></View> : null}
      {search.isError ? <View style={styles.block}><StateCard compact tone="danger" title="제품 검색을 불러오지 못했어요" action={{ label: '다시 검색', disabled: search.isFetching, onPress: () => { if (!search.isFetching) void search.refetch(); } }} /></View> : null}
      {isCatalogCategory && canSearchMovieCatalog && movieCatalog.isError ? <View style={styles.block}><StateCard compact tone="danger" title={`외부 ${label} 검색을 불러오지 못했어요`} text={`등록된 ${label} 검색은 계속 사용할 수 있어요.`}
        action={{ label: 'TMDB 다시 검색', disabled: movieCatalog.isFetching, onPress: () => { if (!movieCatalog.isFetching) void movieCatalog.refetch(); } }} /></View> : null}
      {hasSearchScope && !hasQuery && !validReturn ? <View style={styles.block}><StateCard title={isCatalogCategory ? `${label} 제목만 입력하면 됩니다` : selectedCategory ? '이름을 입력하면 됩니다' : '상품명만 입력하면 됩니다'} text="검색 결과가 있으면 바로 선택하고, 상품이 없으면 입력한 상품명으로 등록 요청을 이어갈 수 있어요." /></View> : null}
      {isCatalogCategory && hasQuery && normalizedQuery.length < 2 ? <View style={styles.block}><StateCard compact title="두 글자 이상 입력해주세요" text="한국어 제목과 원제를 함께 검색합니다." /></View> : null}
      {selection?.phase === 'loading' ? <View style={styles.inlineState}><ActivityIndicator /><Text style={styles.stateText}>선택한 {label} 정보를 불러오고 있어요</Text></View> : null}
      {selection && selection.phase !== 'loading' ? <View style={styles.block}><StateCard compact accessibilityRole={selection.phase === 'failed' ? 'alert' : undefined} tone={selection.phase === 'failed' ? 'danger' : 'default'}
        text={selection.phase === 'failed' ? movieErrorMessage(selection.error, label) : selection.phase === 'ready' ? `선택한 ${label} 정보가 준비됐어요.` : `이전 ${label} 선택을 다시 이어갈 수 있어요.`}
        action={selection.phase === 'ready' ? { label: `선택한 ${label}로 계속`, variant: 'secondary', onPress: () => continueMovie(selection.item, selection.replace) }
          : selection.phase === 'failed' && selection.error instanceof AppError && selection.error.code === 'AUTH_REQUIRED'
            ? { label: `다시 로그인하고 ${label} 선택 계속`, variant: 'secondary', onPress: () => loginForMovie(selection.externalId) }
            : { label: `선택한 ${label} 다시 불러오기`, variant: 'secondary', onPress: () => void loadMovie(selection.externalId, selection.replace) }} /></View> : null}
      {validReturn && isCatalogCategory && !user && !selection ? <View style={styles.block}><StateCard compact text={`선택한 ${label}를 이어가려면 로그인이 필요해요.`}
        action={{ label: `로그인하고 ${label} 선택 계속`, variant: 'secondary', onPress: () => loginForMovie(externalId!) }} /></View> : null}
      {hasQuery && localItems.map((item) => {
        const category = categories.data?.find((category) => category.id === item.categoryId);
        return <View key={item.id} style={styles.itemCard}>
          <PickPhoto uri={item.thumbnailUrl ?? item.imageUrl ?? item.imageSourceUrl} label={item.name} itemId={item.id} itemStatus={item.status} hasPhoto={Boolean(item.imagePath)} />
          <Pressable accessibilityRole="button" accessibilityLabel={`${item.name} 원픽 선택`} disabled={importing} onPress={() => chooseItem(item.id, item.categoryId)} style={({ pressed }) => [styles.itemCopy, styles.itemActionArea, pressed && styles.pressed]}>
            {selectedCategory ? <Text style={styles.itemCategory}>{category?.label ?? '등록된 카테고리'}</Text> : null}<Text style={styles.itemName}>{item.name}</Text>
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
      {noResults && (!selectedCategory || (!isCatalogCategory && !isMusicCategory && !isGameCategory && !isYoutubeCategory && !isBookCategory && !isPokemonCategory)) ? <View style={styles.block}><StateCard title="찾는 상품이 없나요?" text="검색한 상품명을 그대로 등록 요청할 수 있어요. 카테고리는 비워두고 상품명만 먼저 등록합니다."
        action={{ label: '이 상품명으로 등록하기', variant: 'primary', onPress: requestItem }} /></View> : null}
      {noResults && isMusicCategory && selectedCategory ? <View style={styles.requestCard}>
        <Text style={styles.stateTitle}>등록된 노래에서 찾지 못했어요</Text><Text style={styles.stateText}>MusicBrainz에서 곡명과 가수명으로 더 찾아볼 수 있어요.</Text>
        <MusicSearchLink query={normalizedQuery} categoryId={selectedCategory.id} />
      </View> : null}
      {noResults && isGameCategory && selectedCategory ? <View style={styles.requestCard}>
        <Text style={styles.stateTitle}>등록된 게임에서 찾지 못했어요</Text><Text style={styles.stateText}>IGDB에서 게임 이름으로 더 찾아볼 수 있어요.</Text>
        <GameSearchLink query={normalizedQuery} categoryId={selectedCategory.id} />
      </View> : null}
      {noResults && isYoutubeCategory && selectedCategory ? <View style={styles.requestCard}>
        <Text style={styles.stateTitle}>등록된 채널에서 찾지 못했어요</Text><Text style={styles.stateText}>YouTube에서 채널명으로 더 찾아볼 수 있어요.</Text>
        <YoutubeSearchLink query={normalizedQuery} categoryId={selectedCategory.id} />
      </View> : null}
      {noResults && isCatalogCategory ? <View style={styles.block}><StateCard compact title={`일치하는 ${label}를 찾지 못했어요`} text="띄어쓰기나 한국어·원제 제목을 바꿔서 검색해보세요." /></View> : null}
      {isCatalogCategory ? <Text style={styles.attribution}>This product uses the TMDB API but is not endorsed or certified by TMDB.</Text> : null}
    </ScrollView>
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: OnePick.background },
  content: { width: '100%', maxWidth: OnePick.maxWidth, alignSelf: 'center', paddingHorizontal: 20, paddingBottom: 36 },
  backButton: { width: 44, height: 44, justifyContent: 'center', marginTop: 4, marginLeft: -8 },
  backText: { color: OnePick.text, fontSize: 36, lineHeight: 38, fontWeight: '300' },
  title: { color: OnePick.text, fontSize: 26, lineHeight: 34, fontWeight: '800', letterSpacing: -0.6, marginTop: 8 },
  gate: { flex: 1, width: '100%', maxWidth: OnePick.maxWidth, alignSelf: 'center', justifyContent: 'center', gap: 12, paddingHorizontal: 20 },
  centered: { alignSelf: 'center' },
  block: { marginTop: 16 },
  subtitle: { color: OnePick.muted, fontSize: 13, lineHeight: 20, marginTop: 10 },
  categoryBadge: { alignSelf: 'flex-start', backgroundColor: OnePick.accentSoft, borderRadius: 999, paddingHorizontal: 13, paddingVertical: 8, marginTop: 16 },
  categoryBadgeText: { color: OnePick.accent, fontSize: 12, fontWeight: '800' },
  categorySection: { borderWidth: 1, borderColor: OnePick.border, backgroundColor: OnePick.surface, borderRadius: 18, padding: 18, marginTop: 18 },
  categoryTitle: { color: OnePick.text, fontSize: 14, fontWeight: '800' },
  categoryList: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },
  categoryChip: { minHeight: 42, justifyContent: 'center', borderRadius: 999, backgroundColor: OnePick.accentSoft, paddingHorizontal: 14, paddingVertical: 9 },
  categoryChipText: { color: OnePick.accent, fontSize: 12, fontWeight: '800' },
  categoryLoading: { marginTop: 14 },
  input: { minHeight: 52, backgroundColor: OnePick.surface, borderWidth: 1, borderColor: OnePick.border, borderRadius: 12, paddingHorizontal: 16, color: OnePick.text, fontSize: 16, marginTop: 20 },
  inlineState: { flexDirection: 'row', alignItems: 'center', gap: 9, paddingVertical: 18 },
  requestCard: { borderWidth: 1, borderColor: OnePick.border, backgroundColor: OnePick.surface, borderRadius: 20, padding: 22, marginTop: 18 },
  stateTitle: { color: OnePick.text, fontSize: 15, fontWeight: '800' },
  stateText: { color: OnePick.muted, fontSize: 12, lineHeight: 18, marginTop: 7 },
  itemCard: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: OnePick.border, backgroundColor: OnePick.surface, borderRadius: 20, padding: 12, marginTop: 11 },
  itemCopy: { flex: 1, paddingLeft: 14 },
  itemActionArea: { minHeight: 86, justifyContent: 'center' },
  itemCategory: { color: OnePick.accent, fontSize: 12, fontWeight: '800', letterSpacing: 0.8 },
  itemName: { color: OnePick.text, fontSize: 16, fontWeight: '800', marginTop: 5 },
  itemAction: { color: OnePick.muted, fontSize: 12, marginTop: 7 },
  movieMeta: { color: OnePick.muted, fontSize: 12, lineHeight: 18, marginTop: 5 },
  errorText: { color: OnePick.danger, fontSize: 12, lineHeight: 18, marginTop: 12 },
  attribution: { color: OnePick.hint, fontSize: 10, lineHeight: 15, marginTop: 24, marginBottom: 10 },
  pressed: { opacity: 0.7 }, disabled: { opacity: 0.5 },
});
