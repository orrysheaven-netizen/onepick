import { Redirect, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ExternalLink } from '@/components/external-link';
import { PickPhoto } from '@/components/pick-photo';
import { Button, Chip, Icon, StateCard } from '@/components/ui';
import { AppError } from '@/errors/appError';
import { useAuthSession } from '@/hooks/useAuthSession';
import { useExploreCategories } from '@/hooks/useExploreData';
import { useImportYouTubeVideo, useRequestYouTubeVideo, useYouTubeVideoLookup } from '@/hooks/useYouTubeCatalog';
import { homeMenuCategories, searchMenuCategories } from '@/lib/home/homeCategoryFilters';
import { acceptYouTubePolicyConsent, getYouTubePolicyConsent } from '@/lib/youtube/consent';
import { YOUTUBE_VIDEO_ID_PATTERN, parseYouTubeVideoUrl, youtubeVideoUrl } from '@/lib/youtube/videoLink';
import type { YouTubeVideoEntry } from '@/types/domain/youtubeCatalog';
import { OnePick, OnePickFeatures } from '@/constants/onepick';

type Params = {
  categoryId?: string | string[];
  externalVideoId?: string | string[];
  url?: string | string[];
};

const scalar = (value: string | string[] | undefined) => typeof value === 'string' ? value : undefined;
const DISH_NAME_MAX = 60;

function recipeErrorMessage(error: unknown) {
  if (error instanceof AppError) {
    if (error.code === 'VIDEO_URL_INVALID') return 'YouTube 영상 링크를 확인해주세요. 채널·재생목록 링크는 등록할 수 없어요.';
    if (error.code === 'CATALOG_NOT_CONFIGURED') return 'YouTube API 연결 정보가 아직 준비되지 않았어요.';
    if (error.code === 'AUTH_REQUIRED') return '로그인 상태를 다시 확인한 뒤 레시피 등록을 이어가주세요.';
    if (error.code === 'RATE_LIMITED') return 'YouTube 확인 요청이 많아요. 잠시 후 다시 시도해주세요.';
    if (error.code === 'ITEM_NOT_FOUND') return '영상을 찾지 못했어요. 비공개이거나 삭제된 영상인지 확인해주세요.';
    if (error.code === 'ITEM_NOT_ELIGIBLE') return '지금은 이 영상을 레시피 원픽으로 등록할 수 없어요.';
    if (error.code === 'ITEM_ALREADY_PENDING') return '다른 사람이 먼저 등록 요청한 영상이에요. 관리자 승인 후 레시피 원픽으로 고를 수 있어요.';
    if (error.code === 'CATEGORY_NOT_PICKABLE') return '이 요리에는 레시피를 등록할 수 없어요. 다른 요리를 골라주세요.';
    if (error.code === 'CATEGORY_LABEL_INVALID') return '요리 이름을 1~60자로 적어주세요.';
    if (error.code === 'CATEGORY_NOT_FOUND') return '요리 정보를 확인하지 못했어요. 잠시 후 다시 시도해주세요.';
  }
  return 'YouTube 영상 정보를 불러오지 못했어요. 다시 시도해주세요.';
}

export default function RecipePickScreen() {
  const auth = useAuthSession();
  const params = useLocalSearchParams<Params>();
  if (!OnePickFeatures.foodChannelPicker) {
    const categoryId = scalar(params.categoryId);
    return <Redirect href={{ pathname: '/pick/find', params: {
      ...(categoryId ? { categoryId } : {}),
    } }} />;
  }
  const key = JSON.stringify([auth.user?.id ?? null, params.categoryId ?? null, params.externalVideoId ?? null, params.url ?? null]);
  return <RecipePickContent key={key} auth={auth} params={params} />;
}

/**
 * A recipe is the third channel of a dish (미역국 · 오프라인 맛집 / 온라인 맛집 / 레시피).
 * Paste a video link, confirm which dish it cooks (suggested from the title), and the
 * video becomes that dish's recipe Pick. A dish not in the catalog goes to review
 * with its name; approval only publishes the item and the member chooses it later.
 */
function RecipePickContent({ auth, params }: { auth: ReturnType<typeof useAuthSession>; params: Params }) {
  const router = useRouter();
  const { user, isLoading: sessionLoading, error: sessionError, retry: retrySession } = auth;
  const authReady = !sessionLoading && !sessionError;
  const returnVideoId = scalar(params.externalVideoId);
  const validReturn = Boolean(returnVideoId && YOUTUBE_VIDEO_ID_PATTERN.test(returnVideoId));
  const [link, setLink] = useState(() => validReturn ? youtubeVideoUrl(returnVideoId!) : (scalar(params.url) ?? '').slice(0, 2048));
  const [consent, setConsent] = useState<boolean | null>(null);
  const [consentSaving, setConsentSaving] = useState(false);
  const [actionError, setActionError] = useState<unknown>(null);
  const [chosenDishId, setChosenDishId] = useState<string | null>(null);
  const [dishQuery, setDishQuery] = useState('');
  const [requestMode, setRequestMode] = useState(false);
  const [dishName, setDishName] = useState('');
  const [requested, setRequested] = useState<string | null>(null);

  const menuTree = useExploreCategories(authReady);
  const dishes = useMemo(() => homeMenuCategories(menuTree.data ?? []).filter((dish) => dish.slug !== 'recipe'), [menuTree.data]);
  const dishById = useMemo(() => new Map(dishes.map((dish) => [dish.id, dish])), [dishes]);

  useEffect(() => {
    let active = true;
    void getYouTubePolicyConsent().then((value) => { if (active) setConsent(value); })
      .catch(() => { if (active) setConsent(false); });
    return () => { active = false; };
  }, []);

  const trimmedLink = link.trim();
  const videoId = parseYouTubeVideoUrl(trimmedLink);
  const lookupEnabled = Boolean(consent && authReady && user && videoId);
  const lookup = useYouTubeVideoLookup(videoId, lookupEnabled);
  const importVideo = useImportYouTubeVideo();
  const requestVideo = useRequestYouTubeVideo();
  const lookupData = lookup.data?.video.externalId === videoId ? lookup.data : undefined;
  const video = lookupData?.video;
  const suggestions = (lookupData?.suggestions ?? []).filter((suggestion) => dishById.has(suggestion.categoryId));
  const busy = importVideo.isPending || requestVideo.isPending;
  // isPending only flips after a re-render; a synchronous flag stops a same-frame double tap.
  const submitting = useRef(false);

  // The dish comes from the member's choice, else the menu they came from, else the
  // title's best match. Nothing is saved until they press the button that names it.
  const presetDishId = scalar(params.categoryId);
  const selectedDish = dishById.get(chosenDishId ?? '')
    ?? dishById.get(presetDishId ?? '')
    ?? dishById.get(suggestions[0]?.categoryId ?? '');
  const existingDish = video?.existingCategoryId ? dishById.get(video.existingCategoryId) : undefined;
  const dishMatches = dishQuery.trim() ? searchMenuCategories(dishes, dishQuery, 8) : [];

  const focused = useRef(false);
  const navigating = useRef(false);
  const latest = useRef({ userId: user?.id, videoId });
  latest.current = { userId: user?.id, videoId };

  useFocusEffect(useCallback(() => {
    focused.current = true;
    navigating.current = false;
    return () => { focused.current = false; };
  }, []));

  const canAct = () => focused.current && !navigating.current;

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

  const chooseItem = (itemId: string, categoryId: string) => {
    if (!canAct()) return;
    navigating.current = true;
    router.push({
      pathname: '/pick/choose',
      params: { itemId, categoryId, channel: 'recipe' },
    });
  };

  const login = () => {
    if (!canAct() || !videoId) return;
    navigating.current = true;
    router.push({ pathname: '/auth/login', params: {
      action: 'choose_recipe', externalVideoId: videoId, ...(presetDishId ? { categoryId: presetDishId } : {}),
    } });
  };

  const pickDish = (categoryId: string) => {
    if (busy) return;
    setChosenDishId(categoryId);
    setRequestMode(false);
    setDishQuery('');
    setActionError(null);
  };

  const register = async (entry: YouTubeVideoEntry) => {
    if (!canAct() || busy || !user) return;
    if (entry.existingItemId && entry.existingCategoryId) { chooseItem(entry.existingItemId, entry.existingCategoryId); return; }
    if (!selectedDish) return;
    if (submitting.current) return;
    submitting.current = true;
    const owner = user.id;
    setActionError(null);
    try {
      const item = await importVideo.mutateAsync({ externalId: entry.externalId, categoryId: selectedDish.id });
      if (!focused.current || latest.current.userId !== owner || latest.current.videoId !== entry.externalId) return;
      chooseItem(item.itemId, item.categoryId);
    } catch (error) {
      if (focused.current && latest.current.userId === owner) setActionError(error);
    } finally {
      submitting.current = false;
    }
  };

  const request = async (entry: YouTubeVideoEntry) => {
    if (!canAct() || busy || !user) return;
    if (submitting.current) return;
    submitting.current = true;
    const owner = user.id;
    setActionError(null);
    try {
      await requestVideo.mutateAsync({ externalId: entry.externalId, dishName });
      if (!focused.current || latest.current.userId !== owner || latest.current.videoId !== entry.externalId) return;
      setRequested(dishName.trim());
    } catch (error) {
      if (focused.current && latest.current.userId === owner) setActionError(error);
    } finally {
      submitting.current = false;
    }
  };

  const back = () => {
    if (!focused.current || navigating.current) return;
    navigating.current = true;
    if (router.canGoBack()) router.back(); else router.replace('/');
  };

  if (!authReady) return <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
    <View style={styles.gate}>
      <StateCard loading={!sessionError} tone={sessionError ? 'danger' : 'default'}
        title={sessionError ? '로그인 상태를 확인하지 못했어요.' : '로그인 상태를 확인하고 있어요.'}
        action={sessionError ? { label: '다시 확인하기', variant: 'secondary', onPress: retrySession } : undefined} />
      <Button variant="ghost" label="돌아가기" onPress={back} style={styles.centered} />
    </View>
  </SafeAreaView>;

  const trimmedDishName = dishName.trim();
  const canRequest = trimmedDishName.length >= 1 && trimmedDishName.length <= DISH_NAME_MAX;

  return <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
      <Pressable accessibilityRole="button" accessibilityLabel="돌아가기" onPress={back} style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}><Icon name="back" /></Pressable>
      <Text style={styles.title}>나의 레시피 원픽</Text>
      <Text style={styles.subtitle}>가장 좋아하는 레시피 영상의 YouTube 링크를 붙여넣고, 어떤 요리의 레시피인지 골라주세요. 요리마다 오프라인·온라인·레시피 원픽을 하나씩 둘 수 있어요.</Text>
      <Text style={styles.notice}>OnePick은 영상 제목·채널명·썸네일만 사용하며 조회수, 좋아요 수 같은 통계는 가져오지 않아요. 저장된 YouTube API 데이터는 30일 정책보다 짧은 주기로 재검증하거나 제거해요.</Text>

      {consent === null ? <ActivityIndicator style={styles.loading} /> : !consent ? <View style={styles.policyCard}>
        <Text style={styles.stateTitle}>YouTube 영상 확인 전 동의가 필요해요.</Text>
        <Text style={styles.stateText}>레시피 영상 정보는 YouTube Data API Services로 확인해요. 아래 안내와 약관을 확인한 뒤 동의해야 등록할 수 있어요.</Text>
        <Pressable onPress={() => router.push('/legal/privacy')} style={styles.policyLink}><Text style={styles.policyLinkText}>OnePick 개인정보 및 YouTube API 안내 ›</Text></Pressable>
        <Pressable onPress={() => router.push('/legal/terms')} style={styles.policyLink}><Text style={styles.policyLinkText}>OnePick YouTube API 이용조건 ›</Text></Pressable>
        <ExternalLink href="https://www.youtube.com/t/terms" style={styles.externalLink}>YouTube 이용약관</ExternalLink>
        <ExternalLink href="https://policies.google.com/privacy" style={styles.externalLink}>Google 개인정보처리방침</ExternalLink>
        <Button fullWidth label="개인정보 안내와 YouTube API 이용조건을 확인했고 동의해요." loading={consentSaving}
          disabled={consentSaving} onPress={() => void acceptConsent()} style={styles.consentButton} />
      </View> : null}

      {params.externalVideoId !== undefined && !validReturn ? <Text accessibilityRole="alert" style={styles.errorText}>레시피 영상 선택 링크를 확인해주세요. 링크를 다시 붙여넣을 수 있어요.</Text> : null}

      {consent && !requested ? <>
        <Text style={styles.label}>YouTube 영상 링크</Text>
        <TextInput autoFocus={Platform.OS !== 'web' && !validReturn} accessibilityLabel="레시피 YouTube 영상 링크" autoCapitalize="none" autoCorrect={false}
          editable={!busy} maxLength={2048} value={link} keyboardType="url"
          onChangeText={(value) => { if (!busy) { setLink(value); setActionError(null); setChosenDishId(null); setRequestMode(false); } }}
          placeholder="https://youtu.be/…" placeholderTextColor={OnePick.textSecondary} returnKeyType="done" style={styles.input} />
        <Text style={styles.hint}>YouTube 앱의 공유 › 링크 복사로 받은 영상·Shorts 링크를 붙여넣으세요. 채널·재생목록 링크는 등록할 수 없어요.</Text>

        {trimmedLink && !videoId ? <Text accessibilityRole="alert" style={styles.errorText}>{recipeErrorMessage(new AppError('VIDEO_URL_INVALID'))}</Text> : null}

        {videoId && !user ? <View style={styles.block}><StateCard compact text="레시피 영상을 확인하고 등록하려면 로그인이 필요해요."
          action={{ label: '로그인하고 레시피 등록 계속', variant: 'secondary', onPress: login }} /></View> : null}

        {lookupEnabled && lookup.isFetching && !video ? <View style={styles.inlineState}><ActivityIndicator /><Text style={styles.stateText}>YouTube에서 영상 정보를 확인하고 있어요.</Text></View> : null}
        {lookupEnabled && lookup.isError && !lookup.isFetching ? <View style={styles.block}><StateCard compact tone="danger" accessibilityRole="alert"
          text={recipeErrorMessage(lookup.error)}
          action={lookup.error instanceof AppError && lookup.error.code === 'AUTH_REQUIRED'
            ? { label: '다시 로그인하고 레시피 등록 계속', variant: 'secondary', onPress: login }
            : { label: '영상 다시 확인하기', variant: 'secondary', onPress: () => void lookup.refetch() }} /></View> : null}

        {video ? <View style={styles.videoCard}>
          <View style={styles.videoRow}>
            <PickPhoto uri={video.thumbnailUrl} label={`${video.title} 썸네일`} />
            <View style={styles.videoCopy}>
              <Text style={styles.itemCategory}>레시피 · YouTube{existingDish ? ` · ${existingDish.name}` : ''}</Text>
              <Text style={styles.itemName} numberOfLines={3}>{video.title}</Text>
              {video.channelTitle ? <Text style={styles.itemMeta} numberOfLines={1}>{video.channelTitle}</Text> : null}
            </View>
          </View>
          <ExternalLink href={video.videoUrl} style={styles.externalLink}>YouTube에서 영상 보기 ›</ExternalLink>

          {video.existingItemId && video.existingCategoryId ? <>
            <Text style={styles.dishText}>{existingDish ? `이미 ${existingDish.name} 레시피로 등록된 영상이에요.` : '이미 등록된 레시피 영상이에요.'}</Text>
            <Button fullWidth size="lg" label="이 레시피를 원픽으로 고르기" disabled={busy}
              accessibilityLabel={`${video.title} 레시피를 원픽으로 고르기`} onPress={() => void register(video)} style={styles.submit} />
          </> : <>
            <Text style={styles.label}>어떤 요리의 레시피인가요?</Text>
            {suggestions.length ? <Text style={styles.hint}>영상 제목에서 찾은 요리예요. 맞지 않으면 아래에서 검색해 바꿀 수 있어요.</Text> : null}
            <View style={styles.dishList}>
              {suggestions.map((suggestion) => <Chip key={suggestion.categoryId} label={suggestion.name}
                selected={!requestMode && selectedDish?.id === suggestion.categoryId}
                accessibilityLabel={`${suggestion.name} 레시피로 고르기`} onPress={() => pickDish(suggestion.categoryId)} />)}
              {selectedDish && !suggestions.some((suggestion) => suggestion.categoryId === selectedDish.id)
                ? <Chip label={selectedDish.name} selected={!requestMode} accessibilityLabel={`${selectedDish.name} 레시피로 고르기`} onPress={() => pickDish(selectedDish.id)} />
                : null}
            </View>
            <TextInput accessibilityLabel="요리 검색" autoCapitalize="none" maxLength={100} editable={!busy} value={dishQuery}
              onChangeText={setDishQuery} placeholder="다른 요리 검색: 미역국, 파김치…" placeholderTextColor={OnePick.textSecondary} style={[styles.input, styles.dishSearch]} />
            {dishMatches.length ? <View style={styles.dishList}>
              {dishMatches.map((dish) => <Chip key={dish.id} label={dish.name} selected={!requestMode && selectedDish?.id === dish.id}
                accessibilityLabel={`${dish.name} 레시피로 고르기`} onPress={() => pickDish(dish.id)} />)}
            </View> : null}
            {dishQuery.trim() && !dishMatches.length ? <Text style={styles.hint}>&apos;{dishQuery.trim()}&apos; 요리를 찾지 못했어요.</Text> : null}

            {!requestMode ? <>
              <Button fullWidth size="lg" label={selectedDish ? `${selectedDish.name} 레시피로 원픽 등록` : '요리를 먼저 골라주세요.'}
                loading={importVideo.isPending} disabled={busy || !selectedDish}
                accessibilityLabel={selectedDish ? `${video.title}을 ${selectedDish.name} 레시피로 원픽 등록` : '요리를 먼저 골라주세요'}
                onPress={() => void register(video)} style={styles.submit} />
              <Pressable accessibilityRole="button" onPress={() => { if (!busy) { setRequestMode(true); setDishName(dishQuery.trim()); setActionError(null); } }}
                style={({ pressed }) => [styles.requestLink, pressed && styles.pressed]}>
                <Text style={styles.policyLinkText}>찾는 요리가 목록에 없어요 ›</Text>
              </Pressable>
            </> : <View style={styles.requestCard}>
              <Text style={styles.stateTitle}>새 요리로 등록 요청</Text>
              <Text style={styles.stateText}>요리 이름을 남기면 관리자가 확인해요. 승인돼도 레시피 원픽으로 자동 등록되거나 승인 알림이 오지 않아요. 확인 후 직접 원픽으로 선택할 수 있어요.</Text>
              <Text style={styles.label}>요리 이름</Text>
              <TextInput accessibilityLabel="요리 이름" maxLength={DISH_NAME_MAX} editable={!busy} value={dishName} onChangeText={setDishName}
                placeholder="예: 파김치" placeholderTextColor={OnePick.textSecondary} style={styles.input} />
              <Button fullWidth size="lg" label="등록 요청하기" loading={requestVideo.isPending} disabled={busy || !canRequest}
                onPress={() => void request(video)} style={styles.submit} />
              <Button variant="ghost" label="목록에서 고르기" disabled={busy} onPress={() => setRequestMode(false)} style={styles.centered} />
            </View>}
          </>}
          {actionError ? <Text accessibilityRole="alert" style={styles.errorText}>{recipeErrorMessage(actionError)}</Text> : null}
        </View> : null}
      </> : null}

      {requested ? <View style={styles.block}><StateCard title="등록을 요청했어요."
        text={`관리자가 '${requested}' 요리를 확인해요. 승인돼도 자동으로 원픽이 되거나 승인 알림이 오지 않아요. 확인이 끝난 뒤 직접 선택할 수 있어요.`}
        action={{ label: '홈으로', variant: 'secondary', onPress: () => router.replace('/') }} /></View> : null}

      <Text style={styles.attribution}>YouTube Data API Services를 사용해요. YouTube는 OnePick을 후원하거나 승인하지 않아요.</Text>
    </ScrollView>
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: OnePick.background },
  content: { width: '100%', maxWidth: OnePick.maxWidth, alignSelf: 'center', paddingHorizontal: 20, paddingBottom: 36 },
  gate: { flex: 1, width: '100%', maxWidth: OnePick.maxWidth, alignSelf: 'center', justifyContent: 'center', gap: 12, paddingHorizontal: 20 },
  centered: { alignSelf: 'center' },
  backButton: { width: 44, height: 44, justifyContent: 'center', marginTop: 4, marginLeft: -8 },
  title: { color: OnePick.text, fontSize: 26, lineHeight: 34, fontWeight: '800', letterSpacing: -0.6, marginTop: 8 },
  subtitle: { color: OnePick.muted, fontSize: 13, lineHeight: 20, marginTop: 10 },
  notice: { color: OnePick.muted, fontSize: 12, lineHeight: 18, backgroundColor: OnePick.surface, borderRadius: 14, padding: 14, marginTop: 14 },
  policyCard: { borderWidth: 1, borderColor: OnePick.accentSoft, backgroundColor: OnePick.accentSoft, borderRadius: 18, padding: 18, marginTop: 18 },
  policyLink: { minHeight: 40, justifyContent: 'center', marginTop: 7 },
  policyLinkText: { color: OnePick.accent, fontSize: 12, fontWeight: '800' },
  externalLink: { color: OnePick.accent, fontSize: 12, fontWeight: '700', marginTop: 12 },
  consentButton: { marginTop: 18 },
  block: { marginTop: 16 },
  label: { color: OnePick.text, fontSize: 13, fontWeight: '800', marginTop: 18, marginBottom: 7 },
  input: { minHeight: 52, backgroundColor: OnePick.surface, borderWidth: 1, borderColor: OnePick.border, borderRadius: 12, paddingHorizontal: 16, color: OnePick.text, fontSize: 16 },
  hint: { color: OnePick.textSecondary, fontSize: 11, lineHeight: 17, marginTop: 7 },
  loading: { marginTop: 18 },
  inlineState: { flexDirection: 'row', alignItems: 'center', gap: 9, paddingVertical: 18 },
  stateTitle: { color: OnePick.text, fontSize: 15, fontWeight: '800' },
  stateText: { color: OnePick.muted, fontSize: 12, lineHeight: 18, marginTop: 7 },
  errorText: { color: OnePick.danger, fontSize: 12, lineHeight: 18, marginTop: 12 },
  videoCard: { borderWidth: 1, borderColor: OnePick.border, backgroundColor: OnePick.surface, borderRadius: 20, padding: 14, marginTop: 16 },
  videoRow: { flexDirection: 'row', alignItems: 'center' },
  videoCopy: { flex: 1, paddingLeft: 14 },
  itemCategory: { color: OnePick.accent, fontSize: 12, fontWeight: '800', letterSpacing: 0.8 },
  itemName: { color: OnePick.text, fontSize: 16, fontWeight: '800', marginTop: 5 },
  itemMeta: { color: OnePick.muted, fontSize: 12, lineHeight: 18, marginTop: 5 },
  dishText: { color: OnePick.text, fontSize: 13, lineHeight: 20, marginTop: 14 },
  dishList: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 },
  dishSearch: { marginTop: 12 },
  requestLink: { minHeight: 44, justifyContent: 'center', alignSelf: 'center', marginTop: 6 },
  requestCard: { borderWidth: 1, borderColor: OnePick.border, borderRadius: 16, padding: 14, marginTop: 16 },
  submit: { marginTop: 16 },
  attribution: { color: OnePick.textSecondary, fontSize: 10, lineHeight: 15, marginTop: 24, marginBottom: 10 },
  pressed: { opacity: 0.7 },
});
