import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PickPhoto } from '@/components/pick-photo';
import { AppError } from '@/errors/appError';
import { useAuthSession } from '@/hooks/useAuthSession';
import { useItemSearch } from '@/hooks/useItemSearch';
import { useImportMusicCatalogItem, useMusicCatalogSearch } from '@/hooks/useMusicCatalog';
import { useRegistrationCategories } from '@/hooks/useRegisterPick';
import type { ImportedMusicItem, MusicCatalogEntry } from '@/types/domain/musicCatalog';
import { OnePick } from '@/constants/onepick';
import { Icon } from '@/components/ui';

type Params = {
  categoryId?: string | string[];
  externalMusicId?: string | string[];
  title?: string | string[];
  artist?: string | string[];
};
type Selection = { externalId: string; replace: boolean } & (
  | { phase: 'loading' | 'paused' }
  | { phase: 'failed'; error: unknown }
  | { phase: 'ready'; item: ImportedMusicItem }
);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const scalar = (value: string | string[] | undefined) => typeof value === 'string' ? value : undefined;
const normalize = (value: string) => value.trim().replace(/\s+/g, ' ');

function musicErrorMessage(error: unknown) {
  if (error instanceof AppError) {
    if (error.code === 'AUTH_REQUIRED') return '로그인 상태를 다시 확인한 뒤 선택한 노래를 이어가주세요.';
    if (error.code === 'RATE_LIMITED') return '음악 DB 요청이 많아요. 잠시 기다린 뒤 다시 시도해주세요.';
    if (error.code === 'ITEM_NOT_FOUND' || error.code === 'ITEM_NOT_ELIGIBLE') return '지금은 이 노래를 선택할 수 없어요. 다른 노래를 찾아주세요.';
    if (error.code === 'CATEGORY_NOT_FOUND' || error.code === 'ITEM_CATEGORY_MISMATCH') return '음악 카테고리 정보를 확인하지 못했어요.';
  }
  return '노래 정보를 불러오지 못했어요. 같은 노래로 다시 시도할 수 있어요.';
}

export default function MusicPickScreen() {
  const auth = useAuthSession();
  const params = useLocalSearchParams<Params>();
  const key = JSON.stringify([auth.user?.id ?? null, params.categoryId ?? null, params.externalMusicId ?? null, params.title ?? null, params.artist ?? null]);
  return <MusicPickContent key={key} auth={auth} params={params} />;
}

function MusicPickContent({ auth, params }: { auth: ReturnType<typeof useAuthSession>; params: Params }) {
  const router = useRouter();
  const { user, isLoading: sessionLoading, error: sessionError, retry: retrySession } = auth;
  const authReady = !sessionLoading && !sessionError;
  const [title, setTitle] = useState(() => (scalar(params.title) ?? '').slice(0, 100));
  const [artist, setArtist] = useState(() => (scalar(params.artist) ?? '').slice(0, 100));
  const [selection, setSelection] = useState<Selection | null>(null);
  const categories = useRegistrationCategories();
  const category = !categories.isError ? categories.data?.find((entry) =>
    entry.slug === 'music' && (!scalar(params.categoryId) || entry.id === scalar(params.categoryId))) : undefined;
  const cleanTitle = normalize(title);
  const cleanArtist = normalize(artist);
  const localQueryText = [cleanTitle, cleanArtist].filter(Boolean).join(' ');
  const local = useItemSearch(authReady && category ? localQueryText : '', category?.id);
  const catalog = useMusicCatalogSearch(title, artist, Boolean(authReady && category));
  const importMusic = useImportMusicCatalogItem();
  const localItems = authReady && category && !local.isWaiting && !local.isError
    ? (local.data ?? []).filter((item) => item.categoryId === category.id
      && (!cleanArtist || normalize(item.creatorName ?? item.name).toLocaleLowerCase('ko-KR')
        .includes(cleanArtist.toLocaleLowerCase('ko-KR')))) : [];
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
  const loginForMusic = (externalMusicId: string) => {
    if (!canAct() || !category || !UUID_PATTERN.test(externalMusicId)) return;
    navigating.current = true;
    router.push({ pathname: '/auth/login', params: { action: 'choose_music', externalMusicId, categoryId: category.id } });
  };
  const continueMusic = (item: ImportedMusicItem, replace: boolean) => {
    if (!canAct() || !latest.current.userId || item.categoryId !== latest.current.categoryId) return;
    chooseItem(item.itemId, item.categoryId, replace);
  };
  const loadMusic = async (externalId: string, replace = false) => {
    if (!canAct() || !category || !UUID_PATTERN.test(externalId)) return;
    if (!user) { loginForMusic(externalId); return; }
    busy.current = true;
    const token = ++generation.current;
    const owner = user.id;
    const categoryId = category.id;
    setSelection({ phase: 'loading', externalId, replace });
    try {
      const item = await importMusic.mutateAsync(externalId);
      if (token !== generation.current || !focused.current || latest.current.userId !== owner) return;
      if (item.categoryId !== categoryId) throw new AppError('ITEM_CATEGORY_MISMATCH');
      busy.current = false;
      setSelection({ phase: 'ready', externalId, replace, item });
      continueMusic(item, replace);
    } catch (error) {
      if (token === generation.current && focused.current && latest.current.userId === owner) {
        setSelection({ phase: 'failed', externalId, replace, error });
      }
    } finally {
      if (token === generation.current) busy.current = false;
    }
  };
  const chooseMusic = (entry: MusicCatalogEntry) => {
    if (!canAct() || !category) return;
    if (entry.existingItemId) { chooseItem(entry.existingItemId, category.id); return; }
    void loadMusic(entry.externalId);
  };

  const externalId = scalar(params.externalMusicId);
  const validReturn = Boolean(externalId && UUID_PATTERN.test(externalId));
  useEffect(() => {
    if (!authReady || !user || !category || !validReturn || !externalId
      || attemptedReturn.current === externalId || !canAct()) return;
    attemptedReturn.current = externalId;
    void loadMusic(externalId, true);
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
      <Text style={styles.title}>나의 노래 원픽 찾기</Text>
      <Text style={styles.subtitle}>곡명과 가수명으로 찾고, 가장 좋아하는 녹음 버전 하나를 골라보세요.</Text>
      <Text style={styles.notice}>같은 곡의 여러 앨범 수록은 하나의 녹음으로 묶고, 라이브·리믹스·다른 가수의 녹음은 별도로 구분해요.</Text>

      {!category && !categories.isPending ? <View style={styles.stateCard}>
        <Text style={styles.stateTitle}>음악 카테고리를 사용할 수 없어요.</Text>
        <Text style={styles.stateText}>카테고리가 공개·선택 가능 상태인지 확인해주세요.</Text>
      </View> : null}
      {categories.isPending ? <ActivityIndicator style={styles.loading} /> : null}
      {params.externalMusicId !== undefined && !validReturn ? <Text accessibilityRole="alert" style={styles.errorText}>음악 선택 링크를 확인해주세요. 다시 검색할 수 있어요.</Text> : null}

      <Text style={styles.label}>곡명</Text>
      <TextInput autoFocus accessibilityLabel="원픽 노래 제목 검색" autoCapitalize="none" autoCorrect={false}
        editable={Boolean(category) && !importing} maxLength={100} value={title}
        onChangeText={(value) => { if (!busy.current) { setTitle(value); setSelection(null); } }}
        placeholder="예: 밤편지" placeholderTextColor={OnePick.textSecondary} returnKeyType="search" style={styles.input} />
      <Text style={styles.label}>가수명 · 선택</Text>
      <TextInput accessibilityLabel="원픽 가수 검색" autoCapitalize="none" autoCorrect={false}
        editable={Boolean(category) && !importing} maxLength={100} value={artist}
        onChangeText={(value) => { if (!busy.current) { setArtist(value); setSelection(null); } }}
        placeholder="예: 아이유" placeholderTextColor={OnePick.textSecondary} returnKeyType="search" style={styles.input} />
      {cleanTitle.length === 1 && cleanArtist.length < 2 ? <Text style={styles.stateText}>한 글자 곡명은 가수명을 함께 입력해주세요.</Text> : null}

      {isSearching ? <View style={styles.inlineState}><ActivityIndicator /><Text style={styles.stateText}>등록된 노래와 MusicBrainz를 함께 찾고 있어요.</Text></View> : null}
      {local.isError ? <View style={styles.stateCard}><Text style={styles.stateTitle}>등록된 노래 검색을 불러오지 못했어요.</Text>
        <Pressable disabled={local.isFetching} onPress={() => void local.refetch()} style={styles.secondaryButton}><Text style={styles.secondaryButtonText}>다시 검색</Text></Pressable></View> : null}
      {catalog.valid && catalog.isError ? <View style={styles.stateCard}>
        <Text style={styles.stateTitle}>외부 음악 DB를 불러오지 못했어요.</Text>
        <Text style={styles.stateText}>이미 원픽에 등록된 노래 검색은 계속 사용할 수 있어요.</Text>
        <Pressable disabled={catalog.isFetching} onPress={() => void catalog.refetch()} style={styles.secondaryButton}><Text style={styles.secondaryButtonText}>MusicBrainz 다시 검색</Text></Pressable>
      </View> : null}

      {selection?.phase === 'loading' ? <View style={styles.inlineState}><ActivityIndicator /><Text style={styles.stateText}>선택한 노래 정보를 준비하고 있어요.</Text></View> : null}
      {selection && selection.phase !== 'loading' ? <View style={styles.stateCard}>
        <Text accessibilityRole={selection.phase === 'failed' ? 'alert' : undefined} style={styles.stateText}>
          {selection.phase === 'failed' ? musicErrorMessage(selection.error) : selection.phase === 'ready' ? '선택한 노래 정보를 준비했어요.' : '이전 노래 선택을 다시 이어갈 수 있어요.'}
        </Text>
        {selection.phase === 'ready'
          ? <Pressable onPress={() => continueMusic(selection.item, selection.replace)} style={styles.secondaryButton}><Text style={styles.secondaryButtonText}>선택한 노래로 계속</Text></Pressable>
          : selection.phase === 'failed' && selection.error instanceof AppError && selection.error.code === 'AUTH_REQUIRED'
            ? <Pressable onPress={() => loginForMusic(selection.externalId)} style={styles.secondaryButton}><Text style={styles.secondaryButtonText}>다시 로그인하고 노래 선택 계속</Text></Pressable>
            : <Pressable onPress={() => void loadMusic(selection.externalId, selection.replace)} style={styles.secondaryButton}><Text style={styles.secondaryButtonText}>선택한 노래 다시 불러오기</Text></Pressable>}
      </View> : null}
      {validReturn && !user && !selection ? <View style={styles.stateCard}>
        <Text style={styles.stateText}>선택한 노래를 이어가려면 로그인이 필요해요.</Text>
        <Pressable onPress={() => loginForMusic(externalId!)} style={styles.secondaryButton}><Text style={styles.secondaryButtonText}>로그인하고 노래 선택 계속</Text></Pressable>
      </View> : null}

      {cleanTitle && localItems.map((item) => <View key={item.id} style={styles.itemCard}>
        <PickPhoto uri={item.thumbnailUrl ?? item.imageUrl ?? item.imageSourceUrl} label={item.name}
          itemId={item.id} itemStatus={item.status} hasPhoto={Boolean(item.imagePath)} />
        <Pressable accessibilityRole="button" accessibilityLabel={`${item.name} 원픽 선택`} disabled={importing}
          onPress={() => chooseItem(item.id, item.categoryId)} style={({ pressed }) => [styles.itemCopy, pressed && styles.pressed]}>
          <Text style={styles.itemCategory}>음악 · 등록됨</Text>
          <Text style={styles.itemName}>{item.originalName ?? item.name}</Text>
          {item.creatorName ? <Text style={styles.meta}>{item.creatorName}</Text> : null}
          {item.collectionName ? <Text style={styles.meta}>{item.collectionName}{item.releaseYear ? ` · ${item.releaseYear}` : ''}</Text> : item.releaseYear ? <Text style={styles.meta}>{item.releaseYear}</Text> : null}
          <Text style={styles.itemAction}>이 노래를 원픽으로 고르기 ›</Text>
        </Pressable>
      </View>)}

      {!catalog.isWaiting && !catalog.isError && catalog.valid && external.map((entry) => <Pressable
        key={entry.externalId} accessibilityRole="button" accessibilityLabel={`${entry.title} ${entry.artistName} 노래 선택`}
        accessibilityState={{ disabled: importing }} disabled={importing} onPress={() => chooseMusic(entry)}
        style={({ pressed }) => [styles.itemCard, pressed && styles.pressed, importing && styles.disabled]}>
        <PickPhoto uri={entry.coverArtUrl} label={`${entry.title} 커버`} />
        <View style={styles.itemCopy}>
          <Text style={styles.itemCategory}>음악 · MusicBrainz</Text>
          <Text style={styles.itemName}>{entry.title}</Text>
          <Text style={styles.artist}>{entry.artistName}</Text>
          <Text style={styles.meta}>{[entry.releaseTitle, entry.releaseYear, entry.disambiguation].filter(Boolean).join(' · ') || '음반 정보 없음'}</Text>
          <Text style={styles.itemAction}>{selection?.externalId === entry.externalId && importing ? '노래 정보를 준비하고 있어요…' : '이 노래를 원픽으로 고르기 ›'}</Text>
        </View>
      </Pressable>)}

      {noResults ? <View style={styles.stateCard}><Text style={styles.stateTitle}>일치하는 노래를 찾지 못했어요.</Text>
        <Text style={styles.stateText}>곡명 철자나 가수명을 바꿔서 검색해보세요.</Text></View> : null}

      <Text style={styles.attribution}>음악 메타데이터: MusicBrainz · 표지가 있는 경우 Cover Art Archive를 사용해요.</Text>
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
  artist: { color: OnePick.muted, fontSize: 13, fontWeight: '700', marginTop: 4 },
  meta: { color: OnePick.muted, fontSize: 12, lineHeight: 18, marginTop: 4 },
  itemAction: { color: OnePick.muted, fontSize: 12, marginTop: 7 },
  secondaryButton: { alignSelf: 'flex-start', minHeight: 42, borderRadius: 13, backgroundColor: OnePick.text, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 15, marginTop: 13 },
  secondaryButtonText: { color: OnePick.onAccent, fontSize: 12, fontWeight: '800' },
  centerState: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 28 },
  attribution: { color: OnePick.textSecondary, fontSize: 10, lineHeight: 15, marginTop: 24, marginBottom: 10 },
  pressed: { opacity: 0.7 },
  disabled: { opacity: 0.5 },
});
