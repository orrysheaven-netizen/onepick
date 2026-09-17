import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PickPhoto } from '@/components/pick-photo';
import { useAuthSession } from '@/hooks/useAuthSession';
import { useItemSearch } from '@/hooks/useItemSearch';
import { useImportMovieCatalogItem, useMovieCatalogSearch } from '@/hooks/useMovieCatalog';
import { useRegistrationCategories } from '@/hooks/useRegisterPick';
import type { MovieCatalogEntry } from '@/types/domain/movieCatalog';

export default function FindPickItemScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ categoryId?: string; externalMovieId?: string }>();
  const { user } = useAuthSession();
  const [query, setQuery] = useState('');
  const [importingMovieId, setImportingMovieId] = useState<string | null>(null);
  const categories = useRegistrationCategories();
  const search = useItemSearch(query, params.categoryId);
  const selectedCategory = categories.data?.find((category) => category.id === params.categoryId);
  const isMovieCategory = selectedCategory?.slug === 'movie';
  const movieCatalog = useMovieCatalogSearch(query, isMovieCategory);
  const importMovie = useImportMovieCatalogItem();
  const attemptedMovieId = useRef<string | null>(null);
  const hasQuery = query.trim().length > 0;
  const canSearchMovieCatalog = query.trim().length >= 2;
  const externalMovies = (movieCatalog.data ?? []).filter((movie) =>
    !(search.data ?? []).some((item) => item.externalSource === movie.source && item.externalId === movie.externalId));
  const isSearching = search.isWaiting || search.isFetching
    || (isMovieCategory && canSearchMovieCatalog && (movieCatalog.isWaiting || movieCatalog.isFetching));
  const noResults = hasQuery
    && (!isMovieCategory || canSearchMovieCatalog)
    && !isSearching
    && !search.isError
    && (!isMovieCategory || !movieCatalog.isError)
    && search.data?.length === 0
    && (!isMovieCategory || externalMovies.length === 0);

  const chooseItem = (itemId: string, categoryId: string) => {
    router.push({
      pathname: '/pick/choose',
      params: { itemId, categoryId },
    });
  };

  const requestItem = () => {
    router.push({
      pathname: '/pick/request',
      params: {
        itemName: query.trim(),
        ...(params.categoryId ? { categoryId: params.categoryId } : {}),
      },
    });
  };

  const chooseMovie = async (movie: MovieCatalogEntry) => {
    if (!params.categoryId || importMovie.isPending) return;
    if (movie.existingItemId) {
      chooseItem(movie.existingItemId, params.categoryId);
      return;
    }
    if (!user) {
      router.push({
        pathname: '/auth/login',
        params: { action: 'choose_movie', externalId: movie.externalId, categoryId: params.categoryId },
      });
      return;
    }

    setImportingMovieId(movie.externalId);
    try {
      const imported = await importMovie.mutateAsync(movie.externalId);
      chooseItem(imported.itemId, imported.categoryId);
    } catch {
      // Mutation state renders the error.
    } finally {
      setImportingMovieId(null);
    }
  };

  useEffect(() => {
    const externalId = params.externalMovieId;
    if (!user || !params.categoryId || !externalId || !/^\d{1,12}$/.test(externalId)
      || attemptedMovieId.current === externalId || importMovie.isPending) return;

    attemptedMovieId.current = externalId;
    setImportingMovieId(externalId);
    void importMovie.mutateAsync(externalId)
      .then((imported) => {
        router.replace({ pathname: '/pick/choose', params: { itemId: imported.itemId, categoryId: imported.categoryId } });
      })
      .catch(() => {
        attemptedMovieId.current = null;
      })
      .finally(() => setImportingMovieId(null));
  }, [importMovie, params.categoryId, params.externalMovieId, router, user]);

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="돌아가기"
          onPress={() => router.canGoBack() ? router.back() : router.replace('/')}
          style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}>
          <Text style={styles.backText}>‹</Text>
        </Pressable>

        <Text style={styles.kicker}>FIND YOUR ONE PICK</Text>
        <Text style={styles.title}>나의 원픽 찾기</Text>
        <Text style={styles.subtitle}>
          {isMovieCategory ? '좋아하는 영화 제목을 검색하고, 나만의 하나를 골라보세요.' : '좋아하는 제품을 검색하고, 나만의 하나를 골라보세요.'}
        </Text>

        {selectedCategory ? (
          <View style={styles.categoryBadge}>
            <Text style={styles.categoryBadgeText}>{selectedCategory.label} 안에서 찾는 중</Text>
          </View>
        ) : null}

        <TextInput
          autoFocus
          accessibilityLabel={isMovieCategory ? '원픽 영화 검색' : '원픽 제품 검색'}
          autoCapitalize="none"
          onChangeText={setQuery}
          placeholder={isMovieCategory ? '영화 제목 검색' : '제품명 검색'}
          placeholderTextColor="#89909C"
          returnKeyType="search"
          style={styles.input}
          value={query}
        />

        {isSearching ? (
          <View style={styles.inlineState}>
            <ActivityIndicator />
            <Text style={styles.stateText}>{isMovieCategory ? '등록된 영화와 TMDB를 함께 찾고 있어요' : '등록된 제품을 찾고 있어요'}</Text>
          </View>
        ) : null}

        {search.isError ? (
          <View style={styles.stateCard}>
            <Text style={styles.stateTitle}>제품 검색을 불러오지 못했어요</Text>
            <Pressable onPress={() => void search.refetch()} style={styles.secondaryButton}>
              <Text style={styles.secondaryButtonText}>다시 검색</Text>
            </Pressable>
          </View>
        ) : null}

        {isMovieCategory && canSearchMovieCatalog && movieCatalog.isError ? (
          <View style={styles.stateCard}>
            <Text style={styles.stateTitle}>외부 영화 검색을 불러오지 못했어요</Text>
            <Text style={styles.stateText}>등록된 영화 검색은 계속 사용할 수 있어요.</Text>
            <Pressable onPress={() => void movieCatalog.refetch()} style={styles.secondaryButton}>
              <Text style={styles.secondaryButtonText}>TMDB 다시 검색</Text>
            </Pressable>
          </View>
        ) : null}

        {!hasQuery ? (
          <View style={styles.stateCard}>
            <Text style={styles.stateTitle}>{isMovieCategory ? '영화 제목만 입력하면 됩니다' : '제품명만 입력하면 됩니다'}</Text>
            <Text style={styles.stateText}>검색 결과를 선택하면 원픽을 남길 수 있어요.</Text>
          </View>
        ) : null}

        {isMovieCategory && hasQuery && !canSearchMovieCatalog ? (
          <View style={styles.stateCard}>
            <Text style={styles.stateTitle}>두 글자 이상 입력해주세요</Text>
            <Text style={styles.stateText}>한국어 제목과 원제를 함께 검색합니다.</Text>
          </View>
        ) : null}

        {params.externalMovieId && importingMovieId ? (
          <View style={styles.inlineState}>
            <ActivityIndicator />
            <Text style={styles.stateText}>선택한 영화 정보를 저장하고 있어요</Text>
          </View>
        ) : null}

        {!search.isWaiting && hasQuery && search.data?.map((item) => {
          const category = categories.data?.find((category) => category.id === item.categoryId);
          return (
            <Pressable
              key={item.id}
              accessibilityRole="button"
              onPress={() => chooseItem(item.id, item.categoryId)}
              style={({ pressed }) => [styles.itemCard, pressed && styles.pressed]}>
              <PickPhoto uri={item.thumbnailUrl} label={item.name} />
              <View style={styles.itemCopy}>
                <Text style={styles.itemCategory}>{category?.label ?? '등록된 카테고리'}</Text>
                <Text style={styles.itemName}>{item.name}</Text>
                <Text style={styles.itemAction}>이 제품을 원픽으로 선택 ›</Text>
              </View>
            </Pressable>
          );
        })}

        {!movieCatalog.isWaiting && isMovieCategory && canSearchMovieCatalog && externalMovies.map((movie) => (
          <Pressable
            key={`${movie.source}:${movie.externalId}`}
            accessibilityRole="button"
            accessibilityLabel={`${movie.title} 영화 선택`}
            accessibilityState={{ disabled: importMovie.isPending }}
            disabled={importMovie.isPending}
            onPress={() => void chooseMovie(movie)}
            style={({ pressed }) => [styles.itemCard, pressed && styles.pressed, importMovie.isPending && styles.disabled]}>
            <PickPhoto uri={movie.posterUrl} label={`${movie.title} 포스터`} />
            <View style={styles.itemCopy}>
              <Text style={styles.itemCategory}>콘텐츠 › 영화 · TMDB</Text>
              <Text style={styles.itemName}>{movie.title}</Text>
              <Text style={styles.movieMeta}>
                {[movie.releaseYear, movie.originalTitle !== movie.title ? movie.originalTitle : null].filter(Boolean).join(' · ') || '개봉 정보 없음'}
              </Text>
              <Text style={styles.itemAction}>
                {importingMovieId === movie.externalId ? '영화 정보를 저장하고 있어요…' : '이 영화를 원픽으로 선택 ›'}
              </Text>
            </View>
          </Pressable>
        ))}

        {importMovie.isError ? (
          <Text accessibilityRole="alert" style={styles.errorText}>영화 정보를 저장하지 못했어요. 잠시 후 다시 선택해주세요.</Text>
        ) : null}

        {noResults && !isMovieCategory ? (
          <View style={styles.requestCard}>
            <Text style={styles.stateTitle}>찾는 제품이 없나요?</Text>
            <Text style={styles.stateText}>검색한 제품명을 그대로 가져가 등록 요청을 보낼 수 있어요.</Text>
            <Pressable onPress={requestItem} style={styles.primaryButton}>
              <Text style={styles.primaryButtonText}>제품 등록 요청하기</Text>
            </Pressable>
          </View>
        ) : null}

        {noResults && isMovieCategory ? (
          <View style={styles.requestCard}>
            <Text style={styles.stateTitle}>일치하는 영화를 찾지 못했어요</Text>
            <Text style={styles.stateText}>띄어쓰기나 한국어·원제 제목을 바꿔서 검색해보세요.</Text>
          </View>
        ) : null}

        {isMovieCategory ? (
          <Text style={styles.attribution}>This product uses the TMDB API but is not endorsed or certified by TMDB.</Text>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#F5F6F8' },
  content: { width: '100%', maxWidth: 480, alignSelf: 'center', paddingHorizontal: 20, paddingBottom: 36 },
  backButton: { width: 44, height: 44, justifyContent: 'center', marginTop: 4, marginLeft: -8 },
  backText: { color: '#202124', fontSize: 36, lineHeight: 40, fontWeight: '300' },
  kicker: { color: '#4945ED', fontSize: 12, fontWeight: '900', letterSpacing: 2.1, marginTop: 12 },
  title: { color: '#202124', fontSize: 26, lineHeight: 34, fontWeight: '900', letterSpacing: -0.8, marginTop: 8 },
  subtitle: { color: '#747985', fontSize: 13, lineHeight: 20, marginTop: 10 },
  categoryBadge: { alignSelf: 'flex-start', backgroundColor: '#EFEEFF', borderRadius: 999, paddingHorizontal: 13, paddingVertical: 8, marginTop: 16 },
  categoryBadgeText: { color: '#4945ED', fontSize: 12, fontWeight: '800' },
  input: { minHeight: 54, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#E3E5EA', borderRadius: 17, paddingHorizontal: 16, color: '#202124', fontSize: 16, marginTop: 22 },
  inlineState: { flexDirection: 'row', alignItems: 'center', gap: 9, paddingVertical: 18 },
  stateCard: { borderWidth: 1, borderColor: '#E3E5EA', backgroundColor: '#FFFFFF', borderRadius: 18, padding: 20, marginTop: 16 },
  requestCard: { borderWidth: 1, borderColor: '#E3E5EA', backgroundColor: '#FFFFFF', borderRadius: 20, padding: 22, marginTop: 18 },
  stateTitle: { color: '#202124', fontSize: 15, fontWeight: '800' },
  stateText: { color: '#747985', fontSize: 12, lineHeight: 18, marginTop: 7 },
  itemCard: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: '#E3E5EA', backgroundColor: '#FFFFFF', borderRadius: 20, padding: 12, marginTop: 11 },
  itemCopy: { flex: 1, paddingLeft: 14 },
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
  pressed: { opacity: 0.7 },
  disabled: { opacity: 0.5 },
});
