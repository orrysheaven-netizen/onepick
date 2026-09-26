import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ExternalLink } from '@/components/external-link';
import { PickPhoto } from '@/components/pick-photo';
import { Button, StateCard } from '@/components/ui';
import { AppError } from '@/errors/appError';
import { useAuthSession } from '@/hooks/useAuthSession';
import { useRegistrationCategories } from '@/hooks/useRegisterPick';
import { useImportYouTubeVideo, useYouTubeVideoLookup } from '@/hooks/useYouTubeCatalog';
import { acceptYouTubePolicyConsent, getYouTubePolicyConsent } from '@/lib/youtube/consent';
import { YOUTUBE_VIDEO_ID_PATTERN, parseYouTubeVideoUrl, youtubeVideoUrl } from '@/lib/youtube/videoLink';
import type { YouTubeVideoEntry } from '@/types/domain/youtubeCatalog';
import { OnePick } from '@/constants/onepick';

type Params = {
  categoryId?: string | string[];
  externalVideoId?: string | string[];
  url?: string | string[];
  onboarding?: string | string[];
};

const scalar = (value: string | string[] | undefined) => typeof value === 'string' ? value : undefined;

function recipeErrorMessage(error: unknown) {
  if (error instanceof AppError) {
    if (error.code === 'VIDEO_URL_INVALID') return 'YouTube 영상 링크를 확인해주세요. 채널·재생목록 링크는 등록할 수 없어요.';
    if (error.code === 'CATALOG_NOT_CONFIGURED') return 'YouTube API 연결 정보가 아직 준비되지 않았어요.';
    if (error.code === 'AUTH_REQUIRED') return '로그인 상태를 다시 확인한 뒤 레시피 등록을 이어가주세요.';
    if (error.code === 'RATE_LIMITED') return 'YouTube 확인 요청이 많아요. 잠시 후 다시 시도해주세요.';
    if (error.code === 'ITEM_NOT_FOUND') return '영상을 찾지 못했어요. 비공개이거나 삭제된 영상인지 확인해주세요.';
    if (error.code === 'ITEM_NOT_ELIGIBLE') return '지금은 이 영상을 레시피 원픽으로 등록할 수 없어요.';
    if (error.code === 'CATEGORY_NOT_FOUND' || error.code === 'ITEM_CATEGORY_MISMATCH') return '레시피 카테고리 정보를 확인하지 못했어요.';
  }
  return 'YouTube 영상 정보를 불러오지 못했어요. 다시 시도해주세요.';
}

export default function RecipePickScreen() {
  const auth = useAuthSession();
  const params = useLocalSearchParams<Params>();
  const key = JSON.stringify([auth.user?.id ?? null, params.categoryId ?? null, params.externalVideoId ?? null, params.url ?? null, params.onboarding ?? null]);
  return <RecipePickContent key={key} auth={auth} params={params} />;
}

function RecipePickContent({ auth, params }: { auth: ReturnType<typeof useAuthSession>; params: Params }) {
  const router = useRouter();
  const { user, isLoading: sessionLoading, error: sessionError, retry: retrySession } = auth;
  const authReady = !sessionLoading && !sessionError;
  const returnVideoId = scalar(params.externalVideoId);
  const validReturn = Boolean(returnVideoId && YOUTUBE_VIDEO_ID_PATTERN.test(returnVideoId));
  const [link, setLink] = useState(() => validReturn ? youtubeVideoUrl(returnVideoId!) : (scalar(params.url) ?? '').slice(0, 2048));
  const [consent, setConsent] = useState<boolean | null>(null);
  const [consentSaving, setConsentSaving] = useState(false);
  const [importError, setImportError] = useState<unknown>(null);
  const categories = useRegistrationCategories();
  const category = !categories.isError ? categories.data?.find((entry) =>
    entry.slug === 'recipe' && (!scalar(params.categoryId) || entry.id === scalar(params.categoryId))) : undefined;

  useEffect(() => {
    let active = true;
    void getYouTubePolicyConsent().then((value) => { if (active) setConsent(value); })
      .catch(() => { if (active) setConsent(false); });
    return () => { active = false; };
  }, []);

  const trimmedLink = link.trim();
  const videoId = parseYouTubeVideoUrl(trimmedLink);
  const lookupEnabled = Boolean(consent && authReady && user && category && videoId);
  const lookup = useYouTubeVideoLookup(videoId, lookupEnabled);
  const importVideo = useImportYouTubeVideo();
  const video = lookup.data?.externalId === videoId ? lookup.data : undefined;
  const importing = importVideo.isPending;

  const focused = useRef(false);
  const navigating = useRef(false);
  const latest = useRef({ userId: user?.id, categoryId: category?.id, videoId });
  latest.current = { userId: user?.id, categoryId: category?.id, videoId };

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
    if (!canAct() || latest.current.categoryId !== categoryId) return;
    navigating.current = true;
    router.push({
      pathname: '/pick/choose',
      params: { itemId, categoryId, ...(scalar(params.onboarding) === '1' ? { onboarding: '1' } : {}) },
    });
  };

  const login = () => {
    if (!canAct() || !category || !videoId) return;
    navigating.current = true;
    router.push({ pathname: '/auth/login', params: { action: 'choose_recipe', externalVideoId: videoId, categoryId: category.id } });
  };

  const register = async (entry: YouTubeVideoEntry) => {
    if (!canAct() || importing || !category || !user) return;
    if (entry.existingItemId) { chooseItem(entry.existingItemId, category.id); return; }
    const owner = user.id;
    const categoryId = category.id;
    setImportError(null);
    try {
      const item = await importVideo.mutateAsync(entry.externalId);
      if (!focused.current || latest.current.userId !== owner || latest.current.videoId !== entry.externalId) return;
      if (item.categoryId !== categoryId) throw new AppError('ITEM_CATEGORY_MISMATCH');
      chooseItem(item.itemId, item.categoryId);
    } catch (error) {
      if (focused.current && latest.current.userId === owner) setImportError(error);
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
        title={sessionError ? '로그인 상태를 확인하지 못했어요' : '로그인 상태를 확인하고 있어요'}
        action={sessionError ? { label: '다시 확인하기', variant: 'secondary', onPress: retrySession } : undefined} />
      <Button variant="ghost" label="돌아가기" onPress={back} style={styles.centered} />
    </View>
  </SafeAreaView>;

  return <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
      <Pressable accessibilityRole="button" accessibilityLabel="돌아가기" onPress={back} style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}><Text style={styles.backText}>‹</Text></Pressable>
      <Text style={styles.title}>나의 레시피 원픽</Text>
      <Text style={styles.subtitle}>가장 좋아하는 레시피 영상의 YouTube 링크를 붙여넣어 원픽으로 등록하세요.</Text>
      <Text style={styles.notice}>OnePick은 영상 제목·채널명·썸네일만 사용하며 조회수, 좋아요 수 같은 통계는 가져오지 않습니다. 저장된 YouTube API 데이터는 30일 정책보다 짧은 주기로 재검증하거나 제거합니다.</Text>

      {consent === null ? <ActivityIndicator style={styles.loading} /> : !consent ? <View style={styles.policyCard}>
        <Text style={styles.stateTitle}>YouTube 영상 확인 전 동의가 필요해요</Text>
        <Text style={styles.stateText}>레시피 영상 정보는 YouTube Data API Services로 확인합니다. 아래 안내와 약관을 확인한 뒤 동의해야 등록할 수 있어요.</Text>
        <Pressable onPress={() => router.push('/legal/privacy')} style={styles.policyLink}><Text style={styles.policyLinkText}>OnePick 개인정보 및 YouTube API 안내 ›</Text></Pressable>
        <Pressable onPress={() => router.push('/legal/terms')} style={styles.policyLink}><Text style={styles.policyLinkText}>OnePick YouTube API 이용조건 ›</Text></Pressable>
        <ExternalLink href="https://www.youtube.com/t/terms" style={styles.externalLink}>YouTube 이용약관</ExternalLink>
        <ExternalLink href="https://policies.google.com/privacy" style={styles.externalLink}>Google 개인정보처리방침</ExternalLink>
        <Button fullWidth label="개인정보 안내와 YouTube API 이용조건을 확인했고 동의합니다" loading={consentSaving}
          disabled={consentSaving} onPress={() => void acceptConsent()} style={styles.consentButton} />
      </View> : null}

      {!category && !categories.isPending ? <View style={styles.block}><StateCard compact tone="danger" title="레시피 카테고리를 사용할 수 없어요"
        text="카테고리가 공개·선택 가능 상태인지 확인해주세요."
        action={categories.isError ? { label: '카테고리 다시 불러오기', variant: 'secondary', disabled: categories.isFetching, onPress: () => { if (!categories.isFetching) void categories.refetch(); } } : undefined} /></View> : null}
      {categories.isPending ? <ActivityIndicator style={styles.loading} /> : null}
      {params.externalVideoId !== undefined && !validReturn ? <Text accessibilityRole="alert" style={styles.errorText}>레시피 영상 선택 링크를 확인해주세요. 링크를 다시 붙여넣을 수 있어요.</Text> : null}

      {consent ? <>
        <Text style={styles.label}>YouTube 영상 링크</Text>
        <TextInput autoFocus={Platform.OS !== 'web' && !validReturn} accessibilityLabel="레시피 YouTube 영상 링크" autoCapitalize="none" autoCorrect={false}
          editable={Boolean(category) && !importing} maxLength={2048} value={link} keyboardType="url"
          onChangeText={(value) => { if (!importing) { setLink(value); setImportError(null); } }}
          placeholder="https://youtu.be/…" placeholderTextColor={OnePick.hint} returnKeyType="done" style={styles.input} />
        <Text style={styles.hint}>YouTube 앱의 공유 › 링크 복사로 받은 영상·Shorts 링크를 붙여넣으세요. 채널·재생목록 링크는 등록할 수 없어요.</Text>

        {trimmedLink && !videoId ? <Text accessibilityRole="alert" style={styles.errorText}>{recipeErrorMessage(new AppError('VIDEO_URL_INVALID'))}</Text> : null}

        {videoId && !user && category ? <View style={styles.block}><StateCard compact text="레시피 영상을 확인하고 등록하려면 로그인이 필요해요."
          action={{ label: '로그인하고 레시피 등록 계속', variant: 'secondary', onPress: login }} /></View> : null}

        {lookupEnabled && lookup.isFetching && !video ? <View style={styles.inlineState}><ActivityIndicator /><Text style={styles.stateText}>YouTube에서 영상 정보를 확인하고 있어요</Text></View> : null}
        {lookupEnabled && lookup.isError && !lookup.isFetching ? <View style={styles.block}><StateCard compact tone="danger" accessibilityRole="alert"
          text={recipeErrorMessage(lookup.error)}
          action={lookup.error instanceof AppError && lookup.error.code === 'AUTH_REQUIRED'
            ? { label: '다시 로그인하고 레시피 등록 계속', variant: 'secondary', onPress: login }
            : { label: '영상 다시 확인하기', variant: 'secondary', onPress: () => void lookup.refetch() }} /></View> : null}

        {video ? <View style={styles.videoCard}>
          <View style={styles.videoRow}>
            <PickPhoto uri={video.thumbnailUrl} label={`${video.title} 썸네일`} />
            <View style={styles.videoCopy}>
              <Text style={styles.itemCategory}>레시피 · YouTube{video.existingItemId ? ' · 등록됨' : ''}</Text>
              <Text style={styles.itemName} numberOfLines={3}>{video.title}</Text>
              {video.channelTitle ? <Text style={styles.itemMeta} numberOfLines={1}>{video.channelTitle}</Text> : null}
            </View>
          </View>
          <ExternalLink href={video.videoUrl} style={styles.externalLink}>YouTube에서 영상 보기 ›</ExternalLink>
          <Button fullWidth size="lg" label="이 레시피를 원픽으로 등록" loading={importing} disabled={importing}
            accessibilityLabel={`${video.title} 레시피를 원픽으로 등록`} onPress={() => void register(video)} style={styles.submit} />
          {importError ? <Text accessibilityRole="alert" style={styles.errorText}>{recipeErrorMessage(importError)}</Text> : null}
        </View> : null}
      </> : null}

      <Text style={styles.attribution}>YouTube Data API Services를 사용합니다. YouTube는 OnePick을 후원하거나 승인하지 않습니다.</Text>
    </ScrollView>
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: OnePick.background },
  content: { width: '100%', maxWidth: OnePick.maxWidth, alignSelf: 'center', paddingHorizontal: 20, paddingBottom: 36 },
  gate: { flex: 1, width: '100%', maxWidth: OnePick.maxWidth, alignSelf: 'center', justifyContent: 'center', gap: 12, paddingHorizontal: 20 },
  centered: { alignSelf: 'center' },
  backButton: { width: 44, height: 44, justifyContent: 'center', marginTop: 4, marginLeft: -8 },
  backText: { color: OnePick.text, fontSize: 36, lineHeight: 38, fontWeight: '300' },
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
  hint: { color: OnePick.hint, fontSize: 11, lineHeight: 17, marginTop: 7 },
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
  submit: { marginTop: 16 },
  attribution: { color: OnePick.hint, fontSize: 10, lineHeight: 15, marginTop: 24, marginBottom: 10 },
  pressed: { opacity: 0.7 },
});
