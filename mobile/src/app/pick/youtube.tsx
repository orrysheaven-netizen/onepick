import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ExternalLink } from '@/components/external-link';
import { PickPhoto } from '@/components/pick-photo';
import { AppError } from '@/errors/appError';
import { useAuthSession } from '@/hooks/useAuthSession';
import { useItemSearch } from '@/hooks/useItemSearch';
import { useRegistrationCategories } from '@/hooks/useRegisterPick';
import { useImportYouTubeChannel, useYouTubeCatalogSearch } from '@/hooks/useYouTubeCatalog';
import { acceptYouTubePolicyConsent, getYouTubePolicyConsent } from '@/lib/youtube/consent';
import type { ImportedYouTubeChannelItem, YouTubeChannelEntry } from '@/types/domain/youtubeCatalog';
import { OnePick } from '@/constants/onepick';
import { Icon } from '@/components/ui';

type Params = {
  categoryId?: string | string[];
  externalYouTubeId?: string | string[];
  query?: string | string[];
};

type Selection = { externalId: string; replace: boolean } & (
  | { phase: 'loading' | 'paused' }
  | { phase: 'failed'; error: unknown }
  | { phase: 'ready'; item: ImportedYouTubeChannelItem }
);

const CHANNEL_ID_PATTERN = /^UC[A-Za-z0-9_-]{22}$/;
const scalar = (value: string | string[] | undefined) => typeof value === 'string' ? value : undefined;
const normalize = (value: string) => value.trim().replace(/\s+/g, ' ');

function youtubeErrorMessage(error: unknown) {
  if (error instanceof AppError) {
    if (error.code === 'CATALOG_NOT_CONFIGURED') return 'YouTube API 연결 정보가 아직 준비되지 않았어요.';
    if (error.code === 'AUTH_REQUIRED') return '로그인 상태를 다시 확인한 뒤 선택한 채널을 이어가주세요.';
    if (error.code === 'RATE_LIMITED') return '오늘 사용할 수 있는 YouTube 검색 한도에 도달했거나 요청이 많아요. 잠시 후 다시 시도해주세요.';
    if (error.code === 'ITEM_NOT_FOUND' || error.code === 'ITEM_NOT_ELIGIBLE') return '지금은 이 채널을 선택할 수 없어요. 다시 검색해주세요.';
    if (error.code === 'CATEGORY_NOT_FOUND' || error.code === 'ITEM_CATEGORY_MISMATCH') return '유튜브 카테고리 정보를 확인하지 못했어요.';
  }
  return 'YouTube 채널 정보를 불러오지 못했어요. 다시 시도해주세요.';
}

export default function YouTubePickScreen() {
  const auth = useAuthSession();
  const params = useLocalSearchParams<Params>();
  const key = JSON.stringify([auth.user?.id ?? null, params.categoryId ?? null, params.externalYouTubeId ?? null, params.query ?? null]);
  return <YouTubePickContent key={key} auth={auth} params={params} />;
}

function YouTubePickContent({ auth, params }: { auth: ReturnType<typeof useAuthSession>; params: Params }) {
  const router = useRouter();
  const { user, isLoading: sessionLoading, error: sessionError, retry: retrySession } = auth;
  const authReady = !sessionLoading && !sessionError;
  const [searchText, setSearchText] = useState(() => (scalar(params.query) ?? '').slice(0, 1000));
  const [consent, setConsent] = useState<boolean | null>(null);
  const [consentSaving, setConsentSaving] = useState(false);
  const [selection, setSelection] = useState<Selection | null>(null);
  const categories = useRegistrationCategories();
  const category = !categories.isError ? categories.data?.find((entry) =>
    entry.slug === 'youtube' && (!scalar(params.categoryId) || entry.id === scalar(params.categoryId))) : undefined;

  useEffect(() => {
    let active = true;
    void getYouTubePolicyConsent().then((value) => { if (active) setConsent(value); })
      .catch(() => { if (active) setConsent(false); });
    return () => { active = false; };
  }, []);

  const cleanQuery = normalize(searchText);
  const searchEnabled = Boolean(consent && authReady && category);
  const local = useItemSearch(searchEnabled ? cleanQuery : '', category?.id);
  const catalog = useYouTubeCatalogSearch(searchText, searchEnabled);
  const importChannel = useImportYouTubeChannel();
  const localItems = searchEnabled && category && !local.isWaiting && !local.isError
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
  const latest = useRef({ authReady, userId: user?.id, categoryId: category?.id, consent });
  latest.current = { authReady, userId: user?.id, categoryId: category?.id, consent };

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
  const canAct = () => focused.current && latest.current.authReady && latest.current.consent === true
    && !busy.current && !navigating.current;

  const acceptConsent = async () => {
    if (consentSaving) return;
    setConsentSaving(true);
    try {
      await acceptYouTubePolicyConsent();
      setConsent(true);
    } finally {
      setConsentSaving(false);
    }
  };

  const chooseItem = (itemId: string, categoryId: string, replace = false) => {
    if (!canAct() || latest.current.categoryId !== categoryId) return;
    navigating.current = true;
    const route = {
      pathname: '/pick/choose' as const,
      params: { itemId, categoryId },
    };
    if (replace) router.replace(route); else router.push(route);
  };

  const loginForYouTube = (externalYouTubeId: string) => {
    if (!canAct() || !category || !CHANNEL_ID_PATTERN.test(externalYouTubeId)) return;
    navigating.current = true;
    router.push({ pathname: '/auth/login', params: { action: 'choose_youtube', externalYouTubeId, categoryId: category.id } });
  };

  const continueChannel = (item: ImportedYouTubeChannelItem, replace: boolean) => {
    if (!canAct() || !latest.current.userId || item.categoryId !== latest.current.categoryId) return;
    chooseItem(item.itemId, item.categoryId, replace);
  };

  const loadChannel = async (externalId: string, replace = false) => {
    if (!canAct() || !category || !CHANNEL_ID_PATTERN.test(externalId)) return;
    if (!user) { loginForYouTube(externalId); return; }
    busy.current = true;
    const token = ++generation.current;
    const owner = user.id;
    const categoryId = category.id;
    setSelection({ phase: 'loading', externalId, replace });
    try {
      const item = await importChannel.mutateAsync(externalId);
      if (token !== generation.current || !focused.current || latest.current.userId !== owner) return;
      if (item.categoryId !== categoryId) throw new AppError('ITEM_CATEGORY_MISMATCH');
      busy.current = false;
      setSelection({ phase: 'ready', externalId, replace, item });
      continueChannel(item, replace);
    } catch (error) {
      if (token === generation.current && focused.current && latest.current.userId === owner) {
        setSelection({ phase: 'failed', externalId, replace, error });
      }
    } finally {
      if (token === generation.current) busy.current = false;
    }
  };

  const chooseChannel = (entry: YouTubeChannelEntry) => {
    if (!canAct() || !category) return;
    if (entry.existingItemId) { chooseItem(entry.existingItemId, category.id); return; }
    void loadChannel(entry.externalId);
  };

  const externalId = scalar(params.externalYouTubeId);
  const validReturn = Boolean(externalId && CHANNEL_ID_PATTERN.test(externalId));
  useEffect(() => {
    if (!consent || !authReady || !user || !category || !validReturn || !externalId
      || attemptedReturn.current === externalId || !canAct()) return;
    attemptedReturn.current = externalId;
    void loadChannel(externalId, true);
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
      <Text style={styles.title}>나의 유튜브 채널 원픽</Text>
      <Text style={styles.subtitle}>가장 좋아하는 YouTube 채널 하나를 골라보세요.</Text>
      <Text style={styles.notice}>OnePick은 채널 제목·채널 ID·썸네일만 사용하며 구독자 수, 조회수, 영상 수 같은 통계는 가져오지 않아요. 저장된 YouTube API 데이터는 30일 정책보다 짧은 주기로 재검증하거나 제거하도록 설계했어요.</Text>

      {consent === null ? <ActivityIndicator style={styles.loading} /> : !consent ? <View style={styles.policyCard}>
        <Text style={styles.stateTitle}>YouTube 검색 전 확인이 필요해요.</Text>
        <Text style={styles.stateText}>YouTube 채널 검색은 YouTube Data API Services를 사용해요. 아래 안내와 약관을 확인한 뒤 동의해야 검색할 수 있어요.</Text>
        <Pressable onPress={() => router.push('/legal/privacy')} style={styles.policyLink}><Text style={styles.policyLinkText}>OnePick 개인정보 및 YouTube API 안내 ›</Text></Pressable>
        <Pressable onPress={() => router.push('/legal/terms')} style={styles.policyLink}><Text style={styles.policyLinkText}>OnePick YouTube API 이용조건 ›</Text></Pressable>
        <ExternalLink href="https://www.youtube.com/t/terms" style={styles.externalLink}>YouTube 이용약관</ExternalLink>
        <ExternalLink href="https://policies.google.com/privacy" style={styles.externalLink}>Google 개인정보처리방침</ExternalLink>
        <Pressable disabled={consentSaving} onPress={() => void acceptConsent()} style={[styles.consentButton, consentSaving && styles.disabled]}>
          {consentSaving ? <ActivityIndicator color={OnePick.onAccent} /> : <Text style={styles.consentButtonText}>개인정보 안내와 YouTube API 이용조건을 확인했고 동의해요.</Text>}
        </Pressable>
      </View> : null}

      {!category && !categories.isPending ? <View style={styles.stateCard}>
        <Text style={styles.stateTitle}>유튜브 카테고리를 사용할 수 없어요.</Text>
        <Text style={styles.stateText}>카테고리가 공개·선택 가능 상태인지 확인해주세요.</Text>
      </View> : null}
      {categories.isPending ? <ActivityIndicator style={styles.loading} /> : null}
      {params.externalYouTubeId !== undefined && !validReturn ? <Text accessibilityRole="alert" style={styles.errorText}>YouTube 채널 선택 링크를 확인해주세요. 다시 검색할 수 있어요.</Text> : null}

      {consent ? <>
        <Text style={styles.label}>채널명 · @handle · YouTube 링크</Text>
        <TextInput autoFocus={Platform.OS !== 'web'} accessibilityLabel="원픽 YouTube 채널 검색" autoCapitalize="none" autoCorrect={false}
          editable={Boolean(category) && !importing} maxLength={1000} value={searchText}
          onChangeText={(value) => { if (!busy.current) { setSearchText(value); setSelection(null); } }}
          placeholder="예: 최재천의 아마존 또는 YouTube 링크" placeholderTextColor={OnePick.textSecondary} returnKeyType="search" style={styles.input} />
        <Text style={styles.hint}>채널 링크뿐 아니라 영상·Shorts 링크를 붙여넣어도 해당 업로더 채널을 찾아줘요. @handle이나 링크 검색은 일반 이름 검색보다 적은 YouTube 검색 할당량을 사용해요.</Text>
        {cleanQuery.length === 1 ? <Text style={styles.stateText}>두 글자 이상 입력해주세요.</Text> : null}

        {isSearching ? <View style={styles.inlineState}><ActivityIndicator /><Text style={styles.stateText}>등록된 채널과 YouTube를 함께 찾고 있어요.</Text></View> : null}
        {local.isError ? <View style={styles.stateCard}><Text style={styles.stateTitle}>등록된 채널 검색을 불러오지 못했어요.</Text>
          <Pressable disabled={local.isFetching} onPress={() => void local.refetch()} style={styles.secondaryButton}><Text style={styles.secondaryButtonText}>다시 검색</Text></Pressable></View> : null}
        {catalog.valid && catalog.isError ? <View style={styles.stateCard}>
          <Text style={styles.stateTitle}>외부 YouTube DB를 불러오지 못했어요.</Text>
          <Text style={styles.stateText}>{youtubeErrorMessage(catalog.error)}</Text>
          <Pressable disabled={catalog.isFetching} onPress={() => void catalog.refetch()} style={styles.secondaryButton}><Text style={styles.secondaryButtonText}>YouTube 다시 검색</Text></Pressable>
        </View> : null}

        {selection?.phase === 'loading' ? <View style={styles.inlineState}><ActivityIndicator /><Text style={styles.stateText}>선택한 채널 정보를 확인하고 있어요.</Text></View> : null}
        {selection && selection.phase !== 'loading' ? <View style={styles.stateCard}>
          <Text accessibilityRole={selection.phase === 'failed' ? 'alert' : undefined} style={styles.stateText}>
            {selection.phase === 'failed' ? youtubeErrorMessage(selection.error) : selection.phase === 'ready' ? '선택한 채널 정보를 준비했어요.' : '이전 채널 선택을 다시 이어갈 수 있어요.'}
          </Text>
          {selection.phase === 'ready'
            ? <Pressable onPress={() => continueChannel(selection.item, selection.replace)} style={styles.secondaryButton}><Text style={styles.secondaryButtonText}>선택한 채널로 계속</Text></Pressable>
            : selection.phase === 'failed' && selection.error instanceof AppError && selection.error.code === 'AUTH_REQUIRED'
              ? <Pressable onPress={() => loginForYouTube(selection.externalId)} style={styles.secondaryButton}><Text style={styles.secondaryButtonText}>다시 로그인하고 채널 선택 계속</Text></Pressable>
              : <Pressable onPress={() => void loadChannel(selection.externalId, selection.replace)} style={styles.secondaryButton}><Text style={styles.secondaryButtonText}>선택한 채널 다시 불러오기</Text></Pressable>}
        </View> : null}

        {validReturn && !user && !selection ? <View style={styles.stateCard}>
          <Text style={styles.stateText}>선택한 채널을 이어가려면 로그인이 필요해요.</Text>
          <Pressable onPress={() => loginForYouTube(externalId!)} style={styles.secondaryButton}><Text style={styles.secondaryButtonText}>로그인하고 채널 선택 계속</Text></Pressable>
        </View> : null}

        {cleanQuery && localItems.map((item) => <View key={item.id} style={styles.itemCard}>
          <PickPhoto uri={item.thumbnailUrl ?? item.imageUrl ?? item.imageSourceUrl} label={item.name}
            itemId={item.id} itemStatus={item.status} hasPhoto={Boolean(item.imagePath)} />
          <Pressable accessibilityRole="button" accessibilityLabel={`${item.name} 원픽 선택`} disabled={importing}
            onPress={() => chooseItem(item.id, item.categoryId)} style={({ pressed }) => [styles.itemCopy, pressed && styles.pressed]}>
            <Text style={styles.itemCategory}>유튜브 · 등록됨</Text>
            <Text style={styles.itemName}>{item.originalName ?? item.name}</Text>
            <Text style={styles.itemAction}>이 채널을 원픽으로 고르기 ›</Text>
          </Pressable>
        </View>)}

        {!catalog.isWaiting && !catalog.isError && catalog.valid && external.map((entry) => <Pressable
          key={entry.externalId} accessibilityRole="button" accessibilityLabel={`${entry.title} YouTube 채널 선택`}
          accessibilityState={{ disabled: importing }} disabled={importing} onPress={() => chooseChannel(entry)}
          style={({ pressed }) => [styles.itemCard, pressed && styles.pressed, importing && styles.disabled]}>
          <PickPhoto uri={entry.thumbnailUrl} label={`${entry.title} 채널 이미지`} />
          <View style={styles.itemCopy}>
            <Text style={styles.itemCategory}>유튜브 · YouTube</Text>
            <Text style={styles.itemName}>{entry.title}</Text>
            <Text style={styles.itemAction}>{selection?.externalId === entry.externalId && importing ? '채널 정보를 확인하고 있어요…' : '이 채널을 원픽으로 고르기 ›'}</Text>
          </View>
        </Pressable>)}

        {noResults ? <View style={styles.stateCard}><Text style={styles.stateTitle}>일치하는 채널을 찾지 못했어요.</Text>
          <Text style={styles.stateText}>채널명을 다시 입력하거나, 해당 채널의 YouTube 영상/채널 링크를 붙여넣어보세요.</Text></View> : null}
      </> : null}

      <Text style={styles.attribution}>YouTube Data API Services를 사용해요. YouTube는 OnePick을 후원하거나 승인하지 않아요.</Text>
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
  policyCard: { borderWidth: 1, borderColor: OnePick.accentSoft, backgroundColor: OnePick.accentSoft, borderRadius: 18, padding: 18, marginTop: 18 },
  policyLink: { minHeight: 40, justifyContent: 'center', marginTop: 7 },
  policyLinkText: { color: OnePick.accent, fontSize: 12, fontWeight: '800' },
  externalLink: { color: OnePick.accent, fontSize: 12, fontWeight: '700', marginTop: 10 },
  consentButton: { minHeight: 48, backgroundColor: OnePick.text, alignItems: 'center', justifyContent: 'center', borderRadius: 14, paddingHorizontal: 14, marginTop: 18 },
  consentButtonText: { color: OnePick.onAccent, fontSize: 12, lineHeight: 17, fontWeight: '800', textAlign: 'center' },
  label: { color: OnePick.text, fontSize: 13, fontWeight: '800', marginTop: 18, marginBottom: 7 },
  input: { minHeight: 52, backgroundColor: OnePick.surface, borderWidth: 1, borderColor: OnePick.border, borderRadius: 16, paddingHorizontal: 15, color: OnePick.text, fontSize: 15 },
  hint: { color: OnePick.textSecondary, fontSize: 11, lineHeight: 17, marginTop: 7 },
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
  itemAction: { color: OnePick.muted, fontSize: 12, marginTop: 7 },
  secondaryButton: { alignSelf: 'flex-start', minHeight: 42, borderRadius: 13, backgroundColor: OnePick.text, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 15, marginTop: 13 },
  secondaryButtonText: { color: OnePick.onAccent, fontSize: 12, fontWeight: '800' },
  centerState: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 28 },
  attribution: { color: OnePick.textSecondary, fontSize: 10, lineHeight: 15, marginTop: 24, marginBottom: 10 },
  pressed: { opacity: 0.7 },
  disabled: { opacity: 0.5 },
});
