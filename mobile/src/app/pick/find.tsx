import { Redirect, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PickPhoto } from '@/components/pick-photo';
import { Button, Chip, Icon, StateCard } from '@/components/ui';
import { GameSearchLink } from '@/components/game-search-link';
import { MusicSearchLink } from '@/components/music-search-link';
import { YoutubeSearchLink } from '@/components/youtube-search-link';
import { AppError } from '@/errors/appError';
import { useAuthSession } from '@/hooks/useAuthSession';
import { useExploreCategories } from '@/hooks/useExploreData';
import { useItemSearch } from '@/hooks/useItemSearch';
import { useImportMovieCatalogItem, useMovieCatalogSearch } from '@/hooks/useMovieCatalog';
import { usePlaceCatalogCapability, usePlaceCatalogSearch, useSelectPlaceCatalogItem } from '@/hooks/usePlaceCatalog';
import { useRegistrationCategories } from '@/hooks/useRegisterPick';
import { registrationRoute } from '@/lib/categories/registrationRoute';
import { HOME_FEED_ROOT_SLUG, homeMenuCategories, homeMenuSuggestions, searchMenuCategories } from '@/lib/home/homeCategoryFilters';
import { PICK_CHANNEL_OPTIONS, PLACE_COVERAGE_NOTICE, parsePickChannel, type PickChannel } from '@/lib/items/pickChannel';
import { categoryWithChannels, homeChannelLabel } from '@/lib/home/homeChannels';
import type { ImportedMovieItem, MovieCatalogEntry } from '@/types/domain/movieCatalog';
import type { ImportedPlaceItem, PlaceCatalogEntry } from '@/types/domain/placeCatalog';
import { isLabCategory } from '@/lib/profile/profilePickGroups';
import { OnePick, OnePickFeatures, OnePickMvp } from '@/constants/onepick';
import { useSwipeBackHandler } from '@/lib/navigation/swipeBack';

type Params = {
  categoryId?: string | string[];
  externalMovieId?: string | string[];
  externalDramaId?: string | string[];
  placeCatalogId?: string | string[];
  /** Restaurant categories only: 'online' opens the 온라인 판매처 flow; anything else is 매장. */
  channel?: string | string[];
  query?: string | string[];
};
type Selection = { externalId: string; replace: boolean } & (
  | { phase: 'loading' | 'paused' }
  | { phase: 'failed'; error: unknown }
  | { phase: 'ready'; item: ImportedMovieItem }
);
type PlaceSelection = { catalogId: string; replace: boolean } & (
  | { phase: 'loading' | 'paused' }
  | { phase: 'failed'; error: unknown }
  | { phase: 'ready'; item: ImportedPlaceItem }
);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
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
function placeErrorMessage(error: unknown) {
  if (error instanceof AppError) {
    if (error.code === 'AUTH_REQUIRED') return '로그인 상태를 다시 확인한 뒤 선택한 장소를 이어가주세요.';
    if (error.code === 'ITEM_NOT_FOUND') return '이 장소는 현재 원픽 장소 목록에서 찾을 수 없어요. 다시 검색해주세요.';
    if (error.code === 'ITEM_NOT_ELIGIBLE') return '지금은 이 장소를 선택할 수 없어요. 다른 지점을 찾아주세요.';
    if (error.code === 'ITEM_ALREADY_PENDING') return '다른 사람이 먼저 등록 요청한 장소예요. 관리자 승인 후 원픽으로 고를 수 있어요.';
    if (error.code === 'RATE_LIMITED') return '등록 요청이 많아요. 잠시 후 다시 시도해주세요.';
    if (error.code === 'CATEGORY_NOT_FOUND' || error.code === 'CATEGORY_NOT_PICKABLE' || error.code === 'ITEM_CATEGORY_MISMATCH') return '맛집 카테고리 정보를 확인하지 못했어요. 카테고리를 다시 불러와주세요.';
  }
  return '장소 정보를 불러오지 못했어요. 선택한 장소로 다시 시도할 수 있어요.';
}

export default function FindPickItemScreen() {
  const auth = useAuthSession();
  const params = useLocalSearchParams<Params>();
  const key = JSON.stringify([auth.user?.id ?? null, params.categoryId ?? null, params.externalMovieId ?? null, params.externalDramaId ?? null, params.placeCatalogId ?? null, params.channel ?? null, params.query ?? null]);
  return <FindPickItemContent key={key} auth={auth} params={params} />;
}

function FindPickItemContent({ auth, params }: { auth: ReturnType<typeof useAuthSession>; params: Params }) {
  const router = useRouter();
  const { user, isLoading: sessionLoading, error: sessionError, retry: retrySession } = auth;
  const authReady = !sessionLoading && !sessionError;
  const [query, setQuery] = useState(() => (scalar(params.query) ?? '').slice(0, 100));
  const [selection, setSelection] = useState<Selection | null>(null);
  const [placeSelection, setPlaceSelection] = useState<PlaceSelection | null>(null);
  const categories = useRegistrationCategories();
  const requestedCategoryId = scalar(params.categoryId);
  // MVP registration starts from a restaurant menu (e.g. 도가니탕), then asks 매장/온라인.
  const menuMode = !requestedCategoryId && Boolean(HOME_FEED_ROOT_SLUG);
  const menuTree = useExploreCategories(menuMode && authReady);
  // Theme lookup for hiding 실험실 results from the unscoped search.
  const themeCatalog = useExploreCategories(authReady && OnePickFeatures.lab);
  const menus = useMemo(() => homeMenuCategories(menuTree.data ?? []), [menuTree.data]);
  const suggestedMenus = useMemo(() => homeMenuSuggestions(menuTree.data ?? []), [menuTree.data]);
  const [menuQuery, setMenuQuery] = useState(() => (scalar(params.query) ?? '').slice(0, 100));
  const menuMatches = searchMenuCategories(menus, menuQuery);
  const selectedCategory = !categories.isError ? categories.data?.find((category) => category.id === requestedCategoryId) : undefined;
  const categoryScopeReady = !requestedCategoryId || Boolean(selectedCategory);
  const placeCapability = usePlaceCatalogCapability(selectedCategory?.id, Boolean(authReady && categoryScopeReady && selectedCategory));
  const categoryCapabilityReady = !selectedCategory || placeCapability.isSuccess;
  const isPlaceCategory = placeCapability.data === true;
  // Restaurant Picks still support all three internal channels, but the initial
  // public MVP pins food registration to the configured offline channel.
  const [channel, setChannel] = useState<PickChannel>(() =>
    OnePickFeatures.foodChannelPicker ? parsePickChannel(scalar(params.channel)) : OnePickMvp.publicPickChannel);
  const isOnlineChannel = isPlaceCategory && channel === 'online';
  const isPlaceSearch = isPlaceCategory && !isOnlineChannel;
  const hasSearchScope = authReady && categoryScopeReady && categoryCapabilityReady;
  const search = useItemSearch(hasSearchScope && !menuMode ? query : '', selectedCategory?.id);
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
  const movieCatalog = useMovieCatalogSearch(query, Boolean(hasSearchScope && isCatalogCategory), mediaType);
  const importMovie = useImportMovieCatalogItem(mediaType);
  const placeCatalog = usePlaceCatalogSearch(query, selectedCategory?.id, Boolean(hasSearchScope && isPlaceSearch));
  const selectPlace = useSelectPlaceCatalogItem();
  const normalizedQuery = query.trim().replace(/\s+/g, ' ');
  const hasQuery = normalizedQuery.length > 0;
  const canSearchMovieCatalog = normalizedQuery.length >= 2 && normalizedQuery.length <= 60;
  const canSearchPlaceCatalog = normalizedQuery.length >= 2 && normalizedQuery.length <= 100;
  const searchedItems = hasSearchScope && !search.isWaiting && !search.isError
    ? (search.data ?? []).filter((item) => selectedCategory
      ? item.categoryId === selectedCategory.id
      // Unscoped search stays on the main theme; 실험실 passes a categoryId, so its searches are unaffected.
      : !isLabCategory(item.categoryId, themeCatalog.data ?? [], OnePickMvp.mainThemeCode, OnePickFeatures.lab)) : [];
  const localItems = isOnlineChannel ? searchedItems.filter((item) => item.externalSource === 'onepick_provider')
    : isPlaceCategory ? searchedItems.filter((item) => item.externalSource === 'onepick_place') : searchedItems;
  const externalMovies = (movieCatalog.data ?? []).filter((movie) => movie.source === source &&
    !localItems.some((item) => item.externalSource === movie.source && item.externalId === movie.externalId));
  const externalPlaces = (placeCatalog.data ?? []).filter((place) => !place.existingItemId || !localItems.some((item) => item.id === place.existingItemId));
  const isSearching = search.isWaiting || search.isFetching
    || (isCatalogCategory && canSearchMovieCatalog && (movieCatalog.isWaiting || movieCatalog.isFetching))
    || (isPlaceSearch && canSearchPlaceCatalog && (placeCatalog.isWaiting || placeCatalog.isFetching));
  const noResults = hasQuery && hasSearchScope
    && (!isCatalogCategory || canSearchMovieCatalog)
    && (!isPlaceSearch || canSearchPlaceCatalog)
    && !isSearching && !search.isError
    && (!isCatalogCategory || !movieCatalog.isError)
    && (!isPlaceSearch || !placeCatalog.isError)
    && localItems.length === 0
    && (!isCatalogCategory || externalMovies.length === 0)
    && (!isPlaceSearch || externalPlaces.length === 0);

  const focused = useRef(false);
  const generation = useRef(0);
  const busy = useRef(false);
  const navigating = useRef(false);
  const attemptedReturn = useRef<string | null>(null);
  const attemptedPlaceReturn = useRef<string | null>(null);
  const latest = useRef({ authReady, userId: user?.id, categoryId: selectedCategory?.id, isCatalogCategory, isPlaceCategory });
  latest.current = { authReady, userId: user?.id, categoryId: selectedCategory?.id, isCatalogCategory, isPlaceCategory };
  useFocusEffect(useCallback(() => {
    focused.current = true;
    navigating.current = false;
    return () => {
      focused.current = false; generation.current++; busy.current = false;
      setSelection((current) => current?.phase === 'loading' ? { ...current, phase: 'paused' } : current);
      setPlaceSelection((current) => current?.phase === 'loading' ? { ...current, phase: 'paused' } : current);
    };
  }, []));
  const movieImporting = selection?.phase === 'loading';
  const placeImporting = placeSelection?.phase === 'loading';
  const importing = movieImporting || placeImporting;
  const canAct = () => focused.current && latest.current.authReady && !busy.current && !navigating.current;
  const chooseItem = (itemId: string, categoryId: string) => {
    if (!canAct()) return;
    if (latest.current.categoryId && latest.current.categoryId !== categoryId) return;
    navigating.current = true;
    // A food menu keeps one Pick per channel; the chosen 매장/온라인 decides which one this replaces.
    router.push({ pathname: '/pick/choose', params: { itemId, categoryId, ...(isPlaceCategory ? { channel } : {}) } });
  };
  const requestItem = () => {
    if (!canAct() || !hasQuery) return;
    if (selectedCategory && (!placeCapability.isSuccess || isPlaceSearch || isCatalogCategory || isMusicCategory || isGameCategory || isYoutubeCategory || isBookCategory || isPokemonCategory)) return;
    navigating.current = true;
    router.push({
      pathname: '/pick/request',
      params: { itemName: query.trim(), ...(selectedCategory ? { categoryId: selectedCategory.id } : {}), ...(isOnlineChannel ? { channel: 'online' } : {}) },
    });
  };
  const openRecipe = () => {
    if (!canAct()) return;
    navigating.current = true;
    router.push({ pathname: '/pick/recipe', params: {
      ...(selectedCategory ? { categoryId: selectedCategory.id } : {}),
    } });
  };
  const requestPlace = () => {
    if (!canAct() || !hasQuery || !selectedCategory || !isPlaceSearch) return;
    navigating.current = true;
    router.push({
      pathname: '/pick/request',
      params: { itemName: query.trim(), categoryId: selectedCategory.id },
    });
  };
  const loginForMovie = (externalId: string) => {
    if (!canAct() || !selectedCategory || !isCatalogCategory) return;
    navigating.current = true;
    router.push({ pathname: '/auth/login', params: { action: isDramaCategory ? 'choose_drama' : 'choose_movie', externalId, categoryId: selectedCategory.id } });
  };
  const loginForPlace = (catalogId: string) => {
    if (!canAct() || !selectedCategory || !isPlaceCategory || !UUID_PATTERN.test(catalogId)) return;
    navigating.current = true;
    router.push({ pathname: '/auth/login', params: { action: 'choose_place', placeCatalogId: catalogId, categoryId: selectedCategory.id } });
  };
  const continueMovie = (item: ImportedMovieItem, replace: boolean) => {
    if (!canAct() || !latest.current.userId || item.categoryId !== latest.current.categoryId) return;
    navigating.current = true;
    const route = { pathname: '/pick/choose' as const, params: { itemId: item.itemId, categoryId: item.categoryId } };
    if (replace) router.replace(route); else router.push(route);
  };
  const continuePlace = (item: ImportedPlaceItem, replace: boolean) => {
    if (!canAct() || !latest.current.userId || item.categoryId !== latest.current.categoryId) return;
    navigating.current = true;
    const route = { pathname: '/pick/choose' as const, params: { itemId: item.itemId, categoryId: item.categoryId, channel: 'offline' } };
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
  const loadPlace = async (catalogId: string, replace = false) => {
    if (!canAct() || !isPlaceCategory || !selectedCategory || !UUID_PATTERN.test(catalogId)) return;
    if (!user) { loginForPlace(catalogId); return; }
    busy.current = true;
    const token = ++generation.current;
    const owner = user.id;
    const categoryId = selectedCategory.id;
    setPlaceSelection({ phase: 'loading', catalogId, replace });
    try {
      const item = await selectPlace.mutateAsync({ categoryId, catalogId });
      if (token !== generation.current || !focused.current || latest.current.userId !== owner) return;
      if (item.categoryId !== categoryId) throw new AppError('ITEM_CATEGORY_MISMATCH');
      busy.current = false;
      setPlaceSelection({ phase: 'ready', catalogId, replace, item });
      continuePlace(item, replace);
    } catch (error) {
      if (token === generation.current && focused.current && latest.current.userId === owner) setPlaceSelection({ phase: 'failed', catalogId, replace, error });
    } finally { if (token === generation.current) busy.current = false; }
  };
  const chooseMovie = (movie: MovieCatalogEntry) => {
    if (!canAct() || !selectedCategory || !isCatalogCategory || movie.source !== source) return;
    if (movie.existingItemId) { chooseItem(movie.existingItemId, selectedCategory.id); return; }
    void loadMovie(movie.externalId);
  };
  const choosePlace = (place: PlaceCatalogEntry) => {
    if (!canAct() || !selectedCategory || !isPlaceCategory) return;
    if (place.existingItemId) { chooseItem(place.existingItemId, selectedCategory.id); return; }
    void loadPlace(place.id);
  };
  // Media-specific login returns cannot accidentally treat a movie ID as a TV ID.
  const hasReturn = params.externalMovieId !== undefined || params.externalDramaId !== undefined;
  const externalId = scalar(isDramaCategory ? params.externalDramaId : params.externalMovieId);
  const wrongReturn = isDramaCategory ? params.externalMovieId !== undefined : params.externalDramaId !== undefined;
  const validReturn = Boolean(isCatalogCategory && !wrongReturn && externalId && /^\d{1,12}$/.test(externalId));
  const hasPlaceReturn = params.placeCatalogId !== undefined;
  const placeCatalogId = scalar(params.placeCatalogId);
  const validPlaceReturn = Boolean(isPlaceCategory && placeCatalogId && UUID_PATTERN.test(placeCatalogId));
  useEffect(() => {
    if (!authReady || !user || !isCatalogCategory || !selectedCategory || !validReturn || !externalId
      || attemptedReturn.current === externalId || !canAct()) return;
    attemptedReturn.current = externalId;
    void loadMovie(externalId, true);
  });
  useEffect(() => {
    if (!authReady || !user || !isPlaceCategory || !selectedCategory || !validPlaceReturn || !placeCatalogId
      || attemptedPlaceReturn.current === placeCatalogId || !canAct()) return;
    attemptedPlaceReturn.current = placeCatalogId;
    void loadPlace(placeCatalogId, true);
  });
  const chooseMenu = (menu: { id: string; slug: string }) => {
    if (!focused.current || navigating.current) return;
    navigating.current = true;
    const route = registrationRoute(menu);
    router.push(route);
  };
  const requestMenu = () => {
    const itemName = menuQuery.trim();
    if (!focused.current || navigating.current || !itemName) return;
    navigating.current = true;
    router.push({ pathname: '/pick/request', params: { itemName } });
  };
  const back = () => {
    if (!focused.current || navigating.current) return;
    generation.current++; busy.current = false; navigating.current = true;
    setSelection((current) => current?.phase === 'loading' ? { ...current, phase: 'paused' } : current);
    setPlaceSelection((current) => current?.phase === 'loading' ? { ...current, phase: 'paused' } : current);
    if (router.canGoBack()) router.back(); else router.replace('/');
  };
  // Web edge swipe = this screen's "돌아가기" (also pauses in-flight lookups).
  useSwipeBackHandler(back);

  // Recipe Picks are YouTube videos registered from a link, never a name search.
  if (selectedCategory?.slug === 'recipe') {
    const route = registrationRoute(selectedCategory);
    return <Redirect href={route} />;
  }

  if (!authReady) return <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
    <View style={styles.gate}>
      <StateCard loading={!sessionError} tone={sessionError ? 'danger' : 'default'}
        title={sessionError ? '로그인 상태를 확인하지 못했어요.' : '로그인 상태를 확인하고 있어요.'}
        action={sessionError ? { label: '다시 확인하기', variant: 'secondary', onPress: retrySession } : undefined} />
      <Button variant="ghost" label="돌아가기" onPress={back} style={styles.centered} />
    </View>
  </SafeAreaView>;

  if (menuMode) return <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
      <Pressable accessibilityRole="button" accessibilityLabel="돌아가기" onPress={back} style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}><Icon name="back" /></Pressable>
      <Text style={styles.title}>나의 원픽 찾기</Text>
      <Text style={styles.subtitle}>{OnePickFeatures.foodChannelPicker
        ? '어떤 메뉴의 원픽인가요? 메뉴를 고르면 매장이나 온라인에서 맛집을 찾을 수 있어요.'
        : '어떤 메뉴의 원픽인가요? 메뉴를 고르면 매장에서 가장 좋아하는 곳을 찾을 수 있어요.'}</Text>
      <TextInput autoFocus accessibilityLabel="메뉴 검색" autoCapitalize="none" maxLength={100} onChangeText={setMenuQuery}
        placeholder="메뉴 검색: 도가니탕, 국밥…" placeholderTextColor={OnePick.textSecondary} returnKeyType="search" style={styles.input} value={menuQuery} />
      {menuTree.isPending ? <View style={styles.inlineState}><ActivityIndicator /><Text style={styles.stateText}>메뉴를 불러오고 있어요.</Text></View> : null}
      {menuTree.isError ? <View style={styles.block}><StateCard compact tone="danger" title="메뉴를 불러오지 못했어요."
        action={{ label: '메뉴 다시 불러오기', disabled: menuTree.isFetching, onPress: () => { if (!menuTree.isFetching) void menuTree.refetch(); } }} /></View> : null}
      {menuTree.data ? <View style={styles.channelSection}>
        <Text style={styles.channelTitle}>{menuQuery.trim() ? '검색한 메뉴' : '자주 찾는 메뉴'}</Text>
        <View style={styles.menuList}>
          {(menuQuery.trim() ? menuMatches : suggestedMenus).map((menu) => <Chip key={menu.id} label={menu.name}
            accessibilityLabel={`${menu.name} 메뉴 선택`} onPress={() => chooseMenu(menu)} />)}
        </View>
      </View> : null}
      {menuTree.data && menuQuery.trim() && menuMatches.length === 0 ? <View style={styles.block}><StateCard title={`'${menuQuery.trim()}' 메뉴를 찾지 못했어요.`}
        text="띄어쓰기를 바꿔 검색하거나, 이 이름으로 등록을 요청할 수 있어요. 확인 후 알맞은 메뉴로 연결해드려요."
        action={{ label: '이 이름으로 등록 요청', variant: 'secondary', onPress: requestMenu }} /></View> : null}
      {OnePickFeatures.foodChannelPicker ? <View style={styles.channelSection}>
        <Text style={styles.channelTitle}>레시피가 원픽인가요?</Text>
        <Text style={styles.stateText}>좋아하는 요리 영상의 YouTube 링크를 붙여넣고 어떤 요리의 레시피인지 고르면 돼요.</Text>
        <Button variant="soft" label="YouTube 링크로 레시피 등록" onPress={openRecipe} style={styles.recipeButton} />
      </View> : null}
    </ScrollView>
  </SafeAreaView>;

  return <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
      <Pressable accessibilityRole="button" accessibilityLabel="돌아가기" onPress={back} style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}><Icon name="back" /></Pressable>
      <Text style={styles.title}>나의 원픽 찾기</Text>
      <Text style={styles.subtitle}>{isOnlineChannel ? `택배·온라인몰로 주문한 ${selectedCategory?.name ?? '맛집'} 판매처를 검색해보세요.` : isPlaceCategory ? `좋아하는 ${selectedCategory?.name ?? '맛집'} 이름을 검색하고 지점을 골라보세요.` : isCatalogCategory ? `좋아하는 ${label} 제목을 검색하고, 나만의 하나를 골라보세요.` : selectedCategory ? '선택한 종류에서 원픽을 검색해보세요.' : requestedCategoryId ? '선택한 검색 범위를 확인한 뒤 검색해요.' : '카테고리 선택 없이 이름만 검색하고 등록해요.'}</Text>
      {isDramaCategory ? <Text style={styles.stateText}>드라마·시트콤을 작품 단위로 선택해요. 시즌·회차는 나누지 않아요. 애니메이션·예능·다큐는 아직 포함하지 않아요.</Text> : null}
      {selectedCategory ? <View style={styles.categoryBadge}><Text style={styles.categoryBadgeText}>{selectedCategory.name} 안에서 찾는 중</Text></View>
        : !requestedCategoryId ? <Text style={styles.stateText}>카테고리는 비워두고 등록만 진행해요.</Text> : null}
      {isPlaceCategory && OnePickFeatures.foodChannelPicker ? <View style={styles.channelSection}>
        <Text style={styles.channelTitle}>어디서 주문했나요?</Text>
        <View style={styles.channelRow}>
          {PICK_CHANNEL_OPTIONS.map((option) => <Chip key={option.channel} label={option.label} selected={channel === option.channel}
            accessibilityLabel={`${option.label}: ${option.description}`}
            onPress={() => {
              if (busy.current || importing || channel === option.channel) return;
              // A recipe is registered from a video link, with this menu preselected as its dish.
              if (option.channel === 'recipe') { openRecipe(); return; }
              setChannel(option.channel); setSelection(null); setPlaceSelection(null);
            }} />)}
        </View>
        <Text style={styles.stateText}>{PICK_CHANNEL_OPTIONS.find((option) => option.channel === channel)?.description}. 배달앱 주문은 매장으로 골라주세요.</Text>
        {isPlaceSearch ? <Text accessibilityRole="text" style={styles.coverageNotice}>{PLACE_COVERAGE_NOTICE} 다른 지역은 차례로 추가할게요.</Text> : null}
      </View> : null}
      {requestedCategoryId && categories.isError ? <View style={styles.block}><StateCard compact tone="danger" title="선택한 카테고리를 확인하지 못했어요." text="전체 검색으로 바꾸지 않고, 기존 검색 범위를 다시 확인해요."
        action={{ label: '카테고리 다시 불러오기', disabled: categories.isFetching, onPress: () => { if (!categories.isFetching) void categories.refetch(); } }} /></View> : null}
      {selectedCategory && placeCapability.isError ? <View style={styles.block}><StateCard compact tone="danger" title="검색 방식을 확인하지 못했어요." text="장소형 카테고리인지 확인될 때까지 일반 등록으로 우회하지 않아요."
        action={{ label: '검색 방식 다시 확인', disabled: placeCapability.isFetching, onPress: () => { if (!placeCapability.isFetching) void placeCapability.refetch(); } }} /></View> : null}
      {hasReturn && !validReturn && !categories.isPending ? <Text accessibilityRole="alert" style={styles.errorText}>작품 선택 링크의 종류와 카테고리를 확인해주세요. 해당 카테고리에서 다시 검색할 수 있어요.</Text> : null}
      {hasPlaceReturn && categoryCapabilityReady && !validPlaceReturn ? <Text accessibilityRole="alert" style={styles.errorText}>장소 선택 링크와 카테고리를 확인해주세요. 해당 카테고리에서 다시 검색할 수 있어요.</Text> : null}
      <TextInput autoFocus={!validReturn && !validPlaceReturn} accessibilityLabel={isOnlineChannel ? '원픽 온라인 판매처 검색' : isPlaceCategory ? '원픽 맛집 검색' : isCatalogCategory ? `원픽 ${label} 검색` : selectedCategory ? '원픽 항목 검색' : '원픽 검색'} autoCapitalize="none"
        maxLength={100} editable={hasSearchScope && !importing} onChangeText={(value) => { if (!busy.current) { setQuery(value); setSelection(null); setPlaceSelection(null); } }}
        placeholder={isOnlineChannel ? '온라인 판매처·메뉴 이름 검색' : isPlaceCategory ? '맛집 이름 검색' : isCatalogCategory ? `${label} 제목 검색` : '이름 검색'} placeholderTextColor={OnePick.textSecondary} returnKeyType="search" style={styles.input} value={query} />
      {isCatalogCategory && normalizedQuery.length > 60 ? <Text accessibilityRole="alert" style={styles.stateText}>{label} DB 검색어는 60자 이내로 입력해주세요. 등록된 원픽 검색은 계속 사용할 수 있어요.</Text> : null}
      {isSearching ? <View style={styles.inlineState}><ActivityIndicator /><Text style={styles.stateText}>{isOnlineChannel ? '등록된 온라인 판매처를 찾고 있어요.' : isPlaceCategory ? '등록된 장소와 원픽을 함께 찾고 있어요.' : isCatalogCategory ? `등록된 ${label}와 TMDB를 함께 찾고 있어요.` : '등록된 원픽을 찾고 있어요.'}</Text></View> : null}
      {search.isError ? <View style={styles.block}><StateCard compact tone="danger" title={isPlaceCategory ? '등록된 맛집 검색을 불러오지 못했어요.' : '검색 결과를 불러오지 못했어요.'} action={{ label: '다시 검색', disabled: search.isFetching, onPress: () => { if (!search.isFetching) void search.refetch(); } }} /></View> : null}
      {isCatalogCategory && canSearchMovieCatalog && movieCatalog.isError ? <View style={styles.block}><StateCard compact tone="danger" title={`외부 ${label} 검색을 불러오지 못했어요.`} text={`등록된 ${label} 검색은 계속 사용할 수 있어요.`}
        action={{ label: 'TMDB 다시 검색', disabled: movieCatalog.isFetching, onPress: () => { if (!movieCatalog.isFetching) void movieCatalog.refetch(); } }} /></View> : null}
      {isPlaceSearch && canSearchPlaceCatalog && placeCatalog.isError ? <View style={styles.block}><StateCard compact tone="danger" title="장소 검색을 불러오지 못했어요." text="등록된 원픽 검색은 계속 사용할 수 있어요."
        action={{ label: '장소 다시 검색', disabled: placeCatalog.isFetching, onPress: () => { if (!placeCatalog.isFetching) void placeCatalog.refetch(); } }} /></View> : null}
      {hasSearchScope && !hasQuery && !validReturn && !validPlaceReturn ? <View style={styles.block}><StateCard title={isOnlineChannel ? '판매처나 메뉴 이름을 입력하면 돼요.' : isPlaceCategory ? '맛집 이름을 입력하면 돼요.' : isCatalogCategory ? `${label} 제목만 입력하면 돼요.` : selectedCategory ? '이름을 입력하면 돼요.' : '이름만 입력하면 돼요.'} text={isOnlineChannel ? '등록된 온라인 판매처에서 고르고, 없으면 판매처 링크와 함께 등록을 요청할 수 있어요.' : isPlaceCategory ? '같은 이름의 가게도 지점과 주소를 확인해 정확한 장소를 선택할 수 있어요.' : '검색 결과가 있으면 바로 선택하고, 없으면 입력한 이름으로 등록 요청을 이어갈 수 있어요.'} /></View> : null}
      {isCatalogCategory && hasQuery && normalizedQuery.length < 2 ? <View style={styles.block}><StateCard compact title="두 글자 이상 입력해주세요." text="한국어 제목과 원제를 함께 검색해요." /></View> : null}
      {isPlaceSearch && hasQuery && normalizedQuery.length < 2 ? <View style={styles.block}><StateCard compact title="두 글자 이상 입력해주세요." text="가게 이름으로 장소를 검색해요." /></View> : null}
      {selection?.phase === 'loading' ? <View style={styles.inlineState}><ActivityIndicator /><Text style={styles.stateText}>선택한 {label} 정보를 불러오고 있어요.</Text></View> : null}
      {selection && selection.phase !== 'loading' ? <View style={styles.block}><StateCard compact accessibilityRole={selection.phase === 'failed' ? 'alert' : undefined} tone={selection.phase === 'failed' ? 'danger' : 'default'}
        text={selection.phase === 'failed' ? movieErrorMessage(selection.error, label) : selection.phase === 'ready' ? `선택한 ${label} 정보를 준비했어요.` : `이전 ${label} 선택을 다시 이어갈 수 있어요.`}
        action={selection.phase === 'ready' ? { label: `선택한 ${label}로 계속`, variant: 'secondary', onPress: () => continueMovie(selection.item, selection.replace) }
          : selection.phase === 'failed' && selection.error instanceof AppError && selection.error.code === 'AUTH_REQUIRED'
            ? { label: `다시 로그인하고 ${label} 선택 계속`, variant: 'secondary', onPress: () => loginForMovie(selection.externalId) }
            : { label: `선택한 ${label} 다시 불러오기`, variant: 'secondary', onPress: () => void loadMovie(selection.externalId, selection.replace) }} /></View> : null}
      {placeSelection?.phase === 'loading' ? <View style={styles.inlineState}><ActivityIndicator /><Text style={styles.stateText}>선택한 장소를 원픽에 연결하고 있어요.</Text></View> : null}
      {placeSelection && placeSelection.phase !== 'loading' ? <View style={styles.block}><StateCard compact accessibilityRole={placeSelection.phase === 'failed' ? 'alert' : undefined} tone={placeSelection.phase === 'failed' ? 'danger' : 'default'}
        text={placeSelection.phase === 'failed' ? placeErrorMessage(placeSelection.error) : placeSelection.phase === 'ready' ? '선택한 장소를 원픽 후보로 준비했어요.' : '이전 장소 선택을 다시 이어갈 수 있어요.'}
        action={placeSelection.phase === 'ready' ? { label: '선택한 장소로 계속', variant: 'secondary', onPress: () => continuePlace(placeSelection.item, placeSelection.replace) }
          : placeSelection.phase === 'failed' && placeSelection.error instanceof AppError && placeSelection.error.code === 'AUTH_REQUIRED'
            ? { label: '다시 로그인하고 장소 선택 계속', variant: 'secondary', onPress: () => loginForPlace(placeSelection.catalogId) }
            : { label: '선택한 장소 다시 불러오기', variant: 'secondary', onPress: () => void loadPlace(placeSelection.catalogId, placeSelection.replace) }} /></View> : null}
      {validReturn && isCatalogCategory && !user && !selection ? <View style={styles.block}><StateCard compact text={`선택한 ${label}를 이어가려면 로그인이 필요해요.`}
        action={{ label: `로그인하고 ${label} 선택 계속`, variant: 'secondary', onPress: () => loginForMovie(externalId!) }} /></View> : null}
      {validPlaceReturn && isPlaceCategory && !user && !placeSelection ? <View style={styles.block}><StateCard compact text="선택한 장소를 이어가려면 로그인이 필요해요."
        action={{ label: '로그인하고 장소 선택 계속', variant: 'secondary', onPress: () => loginForPlace(placeCatalogId!) }} /></View> : null}
      {hasQuery && localItems.map((item) => {
        const category = categories.data?.find((category) => category.id === item.categoryId);
        return <View key={item.id} style={styles.itemCard}>
          <PickPhoto uri={item.thumbnailUrl ?? item.imageUrl ?? item.imageSourceUrl} label={item.name} itemId={item.id} itemStatus={item.status} hasPhoto={Boolean(item.imagePath)} />
          <Pressable accessibilityRole="button" accessibilityLabel={`${item.name} 원픽 선택`} disabled={importing} onPress={() => chooseItem(item.id, item.categoryId)} style={({ pressed }) => [styles.itemCopy, styles.itemActionArea, pressed && styles.pressed]}>
            {selectedCategory ? <Text style={styles.itemCategory}>{isPlaceCategory ? categoryWithChannels(category?.name ?? '맛집', [channel]) : category?.name ?? '등록된 카테고리'}</Text> : null}<Text style={styles.itemName}>{item.name}</Text>
            {isCatalogCategory ? <Text style={styles.movieMeta}>{[item.releaseYear, item.originalName !== item.name ? item.originalName : null].filter(Boolean).join(' · ') || (isDramaCategory ? '첫 방영 정보 없음' : '개봉 정보 없음')}</Text> : null}
            <Text style={styles.itemAction}>{isOnlineChannel ? '이 판매처를 원픽으로 고르기 ›' : isPlaceCategory ? '이 지점을 원픽으로 고르기 ›' : '이걸 원픽으로 고르기 ›'}</Text>
          </Pressable>
        </View>;
      })}
      {!movieCatalog.isWaiting && !movieCatalog.isError && isCatalogCategory && canSearchMovieCatalog && externalMovies.map((movie) => <Pressable key={`${movie.source}:${movie.externalId}`} accessibilityRole="button"
        accessibilityLabel={`${movie.title} ${label} 선택`} accessibilityState={{ disabled: importing }} disabled={importing} onPress={() => chooseMovie(movie)} style={({ pressed }) => [styles.itemCard, pressed && styles.pressed, importing && styles.disabled]}>
        <PickPhoto uri={movie.posterUrl} label={`${movie.title} 포스터`} />
        <View style={styles.itemCopy}><Text style={styles.itemCategory}>{label} · TMDB</Text><Text style={styles.itemName}>{movie.title}</Text>
          <Text style={styles.movieMeta}>{[movie.releaseYear, movie.originalTitle !== movie.title ? movie.originalTitle : null].filter(Boolean).join(' · ') || (isDramaCategory ? '첫 방영 정보 없음' : '개봉 정보 없음')}</Text>
          <Text style={styles.itemAction}>{selection?.externalId === movie.externalId && movieImporting ? `${label} 정보를 불러오고 있어요…` : `이 ${label}를 원픽으로 고르기 ›`}</Text>
        </View>
      </Pressable>)}
      {!placeCatalog.isWaiting && !placeCatalog.isError && isPlaceSearch && canSearchPlaceCatalog && externalPlaces.map((place) => <Pressable key={`${place.placeProvider}:${place.providerPlaceId}`} accessibilityRole="button"
        accessibilityLabel={`${place.name} ${place.branchName ?? ''} 맛집 선택`} accessibilityState={{ disabled: importing }} disabled={importing} onPress={() => choosePlace(place)} style={({ pressed }) => [styles.itemCard, pressed && styles.pressed, importing && styles.disabled]}>
        <View style={styles.placeMarker}><Text style={styles.placeMarkerText}>장소</Text></View>
        <View style={styles.itemCopy}><Text style={styles.itemCategory}>{homeChannelLabel(['offline'])} · {place.region1 ?? '지역 정보 없음'}{place.region2 ? ` ${place.region2}` : ''}</Text><Text style={styles.itemName}>{place.name}{place.branchName ? ` ${place.branchName}` : ''}</Text>
          <Text style={styles.movieMeta}>{place.roadAddress ?? place.address ?? '주소 정보 없음'}</Text>
          <Text style={styles.itemAction}>{placeSelection?.catalogId === place.id && placeImporting ? '장소를 원픽에 연결하고 있어요…' : '이 지점을 원픽으로 고르기 ›'}</Text>
        </View>
      </Pressable>)}
      {noResults && (!selectedCategory || (!isPlaceCategory && !isCatalogCategory && !isMusicCategory && !isGameCategory && !isYoutubeCategory && !isBookCategory && !isPokemonCategory)) ? <View style={styles.block}><StateCard title="찾는 원픽이 없나요?" text="검색한 이름을 그대로 등록 요청할 수 있어요. 카테고리는 비워두고 이름만 먼저 등록해요."
        action={{ label: '이 이름으로 등록하기', variant: 'primary', onPress: requestItem }} /></View> : null}
      {noResults && isPlaceSearch ? <View style={styles.block}><StateCard compact title="아직 등록된 가게가 없어요." text={`가게 이름이나 지점명을 바꿔서 검색해보세요. ${PLACE_COVERAGE_NOTICE} 장소가 확인되지 않은 이름만으로 맛집 원픽을 만들지는 않아요.`}
        action={{ label: '가게 등록 요청하기', variant: 'secondary', onPress: requestPlace }} /></View> : null}
      {noResults && isOnlineChannel ? <View style={styles.block}><StateCard title="등록된 온라인 판매처가 없어요." text="판매처 링크와 함께 등록을 요청하면 확인 후 원픽으로 고를 수 있어요. 배달앱 주문은 매장으로 골라주세요."
        action={{ label: '온라인 판매처 등록 요청', variant: 'primary', onPress: requestItem }} /></View> : null}
      {noResults && isMusicCategory && selectedCategory ? <View style={styles.requestCard}>
        <Text style={styles.stateTitle}>등록된 노래에서 찾지 못했어요.</Text><Text style={styles.stateText}>MusicBrainz에서 곡명과 가수명으로 더 찾아볼 수 있어요.</Text>
        <MusicSearchLink query={normalizedQuery} categoryId={selectedCategory.id} />
      </View> : null}
      {noResults && isGameCategory && selectedCategory ? <View style={styles.requestCard}>
        <Text style={styles.stateTitle}>등록된 게임에서 찾지 못했어요.</Text><Text style={styles.stateText}>IGDB에서 게임 이름으로 더 찾아볼 수 있어요.</Text>
        <GameSearchLink query={normalizedQuery} categoryId={selectedCategory.id} />
      </View> : null}
      {noResults && isYoutubeCategory && selectedCategory ? <View style={styles.requestCard}>
        <Text style={styles.stateTitle}>등록된 채널에서 찾지 못했어요.</Text><Text style={styles.stateText}>YouTube에서 채널명으로 더 찾아볼 수 있어요.</Text>
        <YoutubeSearchLink query={normalizedQuery} categoryId={selectedCategory.id} />
      </View> : null}
      {noResults && isCatalogCategory ? <View style={styles.block}><StateCard compact title={`일치하는 ${label}를 찾지 못했어요.`} text="띄어쓰기나 한국어·원제 제목을 바꿔서 검색해보세요." /></View> : null}
      {isCatalogCategory ? <Text style={styles.attribution}>This product uses the TMDB API but is not endorsed or certified by TMDB.</Text> : null}
    </ScrollView>
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: OnePick.background },
  content: { width: '100%', maxWidth: OnePick.maxWidth, alignSelf: 'center', paddingHorizontal: 20, paddingBottom: 36 },
  backButton: { width: 44, height: 44, justifyContent: 'center', marginTop: 4, marginLeft: -8 },
  title: { color: OnePick.text, fontSize: 26, lineHeight: 34, fontWeight: '800', letterSpacing: -0.6, marginTop: 8 },
  gate: { flex: 1, width: '100%', maxWidth: OnePick.maxWidth, alignSelf: 'center', justifyContent: 'center', gap: 12, paddingHorizontal: 20 },
  centered: { alignSelf: 'center' },
  block: { marginTop: 16 },
  subtitle: { color: OnePick.muted, fontSize: 13, lineHeight: 20, marginTop: 10 },
  categoryBadge: { alignSelf: 'flex-start', backgroundColor: OnePick.accentSoft, borderRadius: 999, paddingHorizontal: 13, paddingVertical: 8, marginTop: 16 },
  channelSection: { marginTop: 16 },
  coverageNotice: { color: OnePick.accent, fontSize: 12, lineHeight: 18, fontWeight: '700', marginTop: 6 },
  channelTitle: { color: OnePick.text, fontSize: 14, fontWeight: '800' },
  channelRow: { flexDirection: 'row', gap: 8, marginTop: 10 },
  recipeButton: { marginTop: 10 },
  menuList: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 },
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
  placeMarker: { width: 72, height: 72, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: OnePick.accentSoft },
  placeMarkerText: { color: OnePick.accent, fontSize: 12, fontWeight: '800' },
  errorText: { color: OnePick.danger, fontSize: 12, lineHeight: 18, marginTop: 12 },
  attribution: { color: OnePick.textSecondary, fontSize: 10, lineHeight: 15, marginTop: 24, marginBottom: 10 },
  pressed: { opacity: 0.7 }, disabled: { opacity: 0.5 },
});
