import { useIsFocused } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { AppError } from '@/errors/appError';
import { useAuthSession } from '@/hooks/useAuthSession';
import { useGenerateProfileAiReview, useProfileAiReview, useSetProfileAiReviewVisibility } from '@/hooks/useProfileAiReview';
import { useProfileAiEligibility } from '@/hooks/useProfileAiEligibility';
import { useProfileAiStatus } from '@/hooks/useProfileAiStatus';
import { PROFILE_AI_PICK_GUIDANCE } from '@/lib/profileAiCopy';
import { formatRetryDelay, retryAfterSecondsFromCause } from '@/lib/profileAiRetry';
import { canRequestProfileAiGeneration } from '@/lib/profileAiStatus';
import { PROFILE_AI_TONES, profileAiToneLabel, type ProfileAiTone } from '@/lib/profileAiTone';
import { profileAiVisibilityErrorMessage } from '@/lib/profileAiVisibility';
import { MIN_PROFILE_AI_PICKS } from '@/services/profileAiReviewService';

type Props = { profileUserId: string; pickCount: number; isMine: boolean };

function errorMessage(error: unknown) {
  if (error instanceof AppError) {
    const seconds = retryAfterSecondsFromCause(error.cause);
    const delay = seconds ? formatRetryDelay(seconds) : null;
    if (error.code === 'AI_NOT_CONFIGURED') return 'AI 분석 서버 연결이 아직 준비되지 않았어요.';
    if (error.code === 'AI_NOT_ENOUGH_PICKS') return `공개된 원픽이 최소 ${MIN_PROFILE_AI_PICKS}개 필요해요.`;
    if (error.code === 'AI_REVIEW_STALE') return delay
      ? `원픽이 바뀌어 이번 평가를 저장하지 않았어요. 약 ${delay} 후 다시 요청할 수 있어요.`
      : '원픽이나 AI 댓글이 바뀌었어요. 최신 내용을 확인한 뒤 공개해주세요.';
    if (error.code === 'RATE_LIMITED') return delay ? `아직 다시 요청할 수 없어요. 약 ${delay} 후 다시 시도해주세요.`
      : '새 생성 요청은 두 말투를 합쳐 10분에 한 번 가능해요. 잠시 후 다시 시도해주세요.';
    if (error.code === 'AI_REVIEW_FAILED' && delay) return `평가를 만들지 못했어요. 약 ${delay} 후 다시 요청할 수 있어요.`;
  }
  return 'AI 취향평가를 완료하지 못했어요. 로그인과 연결 상태를 확인해주세요.';
}

function ConnectionNotice({ query }: { query: ReturnType<typeof useProfileAiStatus> }) {
  if (!query.isError && query.data?.configured && query.data.compatible) return null;
  const checking = query.isPending || query.isFetching;
  return <View style={styles.connectionNotice}>
    <Text accessibilityLiveRegion="polite" style={styles.hint}>{checking
      ? 'AI 분석 서버의 연결 설정을 확인하고 있어요.' : query.isError
        ? 'AI 연결 상태를 확인하지 못했어요. 인터넷 연결을 확인한 뒤 다시 시도해주세요.'
        : !query.data?.configured ? 'AI 분석 연결을 준비하고 있어요. 등록한 원픽과 기존 평가는 그대로 유지돼요.'
          : 'AI 분석 서버를 최신 규격으로 맞추고 있어요. 등록한 원픽과 기존 평가는 그대로 유지돼요.'}</Text>
    <Pressable accessibilityRole="button" disabled={query.isFetching} accessibilityLabel="AI 연결 상태 다시 확인"
      onPress={() => void query.refetch({ cancelRefetch: false })}
      style={({ pressed }) => [styles.statusButton, (pressed || query.isFetching) && styles.disabled]}>
      <Text style={styles.statusButtonText}>{query.isFetching ? '연결 확인 중…' : '연결 상태 다시 확인'}</Text>
    </Pressable>
  </View>;
}

export function ProfileAiToneButtons({ disabled, activeTone, status, onRequest }: {
  disabled: boolean; activeTone: ProfileAiTone | null; status: string; onRequest: (tone: ProfileAiTone) => void;
}) {
  return <View style={styles.toneContainer}>
    <Text style={styles.toneHeading}>내 취향, 어떻게 읽어줄까?</Text>
    <Text style={styles.hint}>오늘 듣고 싶은 말투를 골라주세요. 어느 쪽이든 자유롭게 선택할 수 있어요.</Text>
    {status ? <Text accessibilityLiveRegion="polite" style={styles.hint}>{status}</Text> : null}
    <View style={styles.toneRow}>{PROFILE_AI_TONES.map((option) => <View key={option.value} style={styles.toneOption}>
      <Pressable accessibilityRole="button" accessibilityLabel={option.title} testID={`ai-tone-${option.value}`}
        accessibilityState={{ disabled, busy: activeTone === option.value }} disabled={disabled}
        onPress={() => { if (!disabled && !activeTone) onRequest(option.value); }}
        style={({ pressed }) => [styles.toneButton, option.value === 'warm' && styles.warmButton,
          disabled && styles.disabled, pressed && styles.pressed]}>
        {activeTone === option.value ? <ActivityIndicator color="#FFFFFF" accessibilityLabel={`${option.label} 준비 중`} />
          : <Text style={styles.toneButtonText}>{option.title}</Text>}
      </Pressable>
      <Text style={styles.toneDescription}>{option.description}</Text>
    </View>)}</View>
  </View>;
}

export function ProfileAiReviewCard(props: Props) {
  const screenFocused = useIsFocused();
  const auth = useAuthSession();
  if (auth.isLoading || auth.error) return null;
  const viewerId = auth.user?.id;
  return <ProfileAiReviewContent key={`${props.profileUserId}:${viewerId ?? 'public'}`}
    {...props} viewerId={viewerId} active={screenFocused}
    isMine={props.isMine && viewerId === props.profileUserId} />;
}

function ProfileAiReviewContent({ profileUserId, pickCount, isMine, viewerId, active }: Props & { viewerId?: string; active: boolean }) {
  const query = useProfileAiReview(profileUserId, viewerId, active);
  const connection = useProfileAiStatus(isMine && active);
  const eligibility = useProfileAiEligibility(profileUserId, isMine && active, pickCount);
  const generate = useGenerateProfileAiReview(profileUserId, viewerId);
  const visibility = useSetProfileAiReviewVisibility(profileUserId, viewerId);
  const [message, setMessage] = useState('');
  const [preflighting, setPreflighting] = useState(false);
  const [visibilityNeedsCheck, setVisibilityNeedsCheck] = useState(false);
  const [activeTone, setActiveTone] = useState<ProfileAiTone | null>(null);
  const inFlight = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const review = query.data ?? null;
  const displayPickCount = eligibility.data ?? 0;
  const missingCount = Math.max(MIN_PROFILE_AI_PICKS - displayPickCount, 0);
  const pickProgress = eligibility.isError ? '분석 가능한 원픽 수를 확인하지 못했어요. 다시 확인해주세요.'
    : eligibility.isPending ? '분석 가능한 공개 원픽을 확인하고 있어요.'
      : `분석 가능한 공개 원픽 ${displayPickCount}/${MIN_PROFILE_AI_PICKS}개 · ${missingCount > 0
        ? `${missingCount}개 더 등록하면 요청할 수 있어요.` : '등록 조건을 충족했어요.'}`;
  const canGenerate = canRequestProfileAiGeneration({
    isOwner: isMine && viewerId === profileUserId, publicPickCount: displayPickCount, minimumPickCount: MIN_PROFILE_AI_PICKS,
    configured: connection.data?.configured, compatible: connection.data?.compatible,
    statusError: connection.isError || eligibility.isError,
    // Existing data remains usable during a background refresh. The click path
    // refetches status and eligibility before any model request.
    statusPending: connection.isPending || eligibility.isPending,
  });
  const busy = generate.isPending || visibility.isPending || preflighting;
  const generationLabel = (normal: string) => eligibility.isError ? '원픽 수 확인 필요'
    : eligibility.isPending ? '원픽 수 확인 중…'
      : missingCount > 0 ? `원픽 ${MIN_PROFILE_AI_PICKS}개부터 요청 가능`
        : connection.isPending ? '연결 상태 확인 중…'
          : connection.isError ? '연결 상태 확인 필요' : connection.data?.configured !== true ? 'AI 연결 준비 중'
            : connection.data?.compatible !== true ? 'AI 서버 업데이트 중' : normal;

  const run = async (tone: ProfileAiTone) => {
    if ((tone !== 'direct' && tone !== 'warm') || !canGenerate || busy || inFlight.current || visibilityNeedsCheck) return;
    inFlight.current = true;
    setActiveTone(tone);
    setPreflighting(true);
    setMessage('');
    try {
      const [checked, counted] = await Promise.all([
        connection.refetch({ cancelRefetch: false }), eligibility.refetch({ cancelRefetch: false }),
      ]);
      if (!mounted.current) return;
      if (checked.isError || !checked.data) { setMessage('AI 연결 상태를 확인하지 못했어요. 연결 상태를 다시 확인해주세요.'); return; }
      if (!checked.data.configured) { setMessage(errorMessage(new AppError('AI_NOT_CONFIGURED'))); return; }
      if (!checked.data.compatible) { setMessage('AI 분석 서버가 앱과 같은 규격으로 업데이트된 뒤 요청할 수 있어요.'); return; }
      if (counted.isError || typeof counted.data !== 'number' || !Number.isSafeInteger(counted.data) || counted.data < 0) {
        setMessage('분석 가능한 원픽 수를 확인하지 못했어요. 다시 확인해주세요.'); return;
      }
      if (counted.data < MIN_PROFILE_AI_PICKS) {
        setMessage(`분석 가능한 공개 원픽이 ${counted.data}개예요. ${MIN_PROFILE_AI_PICKS - counted.data}개 더 등록하면 요청할 수 있어요.`); return;
      }
      // Captured at click time; changing screens or pressing the other button
      // cannot replace this request's tone. The repository also verifies it.
      const saved = await generate.mutateAsync({ count: counted.data, tone });
      if (!mounted.current) return;
      setMessage(saved.isVisible ? '현재 원픽과 말투에 맞는 기존 평가를 확인했어요.'
        : `${profileAiToneLabel(saved.tone)}을 확인했어요. 지금은 나에게만 보이며, 공개 여부를 선택할 수 있어요.`);
    } catch (error) {
      if (mounted.current) {
        setMessage(errorMessage(error));
        if (error instanceof AppError && (error.code === 'AI_NOT_ENOUGH_PICKS' || error.code === 'AI_REVIEW_STALE')) void eligibility.refetch({ cancelRefetch: false });
        if (error instanceof AppError && error.code === 'AI_NOT_CONFIGURED') void connection.refetch({ cancelRefetch: false });
      }
    } finally {
      inFlight.current = false;
      if (mounted.current) { setPreflighting(false); setActiveTone(null); }
    }
  };
  const changeVisibility = async () => {
    if (!review || (!review.isVisible && review.isStale) || !isMine || busy || inFlight.current || visibilityNeedsCheck || query.isFetching) return;
    inFlight.current = true; setMessage('');
    try {
      const saved = await visibility.mutateAsync(review.isVisible ? { isVisible: false }
        : { isVisible: true, expectedReview: { id: review.id, generatedAt: review.generatedAt } });
      if (mounted.current) setMessage(saved.isVisible ? 'AI 취향평가를 공개했어요.' : 'AI 취향평가를 공개 프로필에서 숨겼어요.');
    } catch (error) {
      if (mounted.current) { setMessage(profileAiVisibilityErrorMessage(error)); setVisibilityNeedsCheck(true); }
    } finally { inFlight.current = false; }
  };
  const checkVisibility = async () => {
    if (!isMine || inFlight.current || query.isFetching) return;
    inFlight.current = true;
    try {
      const checked = await query.refetch({ cancelRefetch: false });
      if (!mounted.current) return;
      if (checked.isError) { setMessage('현재 공개 상태를 확인하지 못했어요. 저장되지 않았다고 단정할 수 없어요. 다시 확인해주세요.'); return; }
      setVisibilityNeedsCheck(false);
      setMessage(!checked.data ? '현재 표시할 수 있는 AI 댓글이 없어요.'
        : checked.data.isVisible ? '현재 AI 댓글은 공개된 상태예요.' : '현재 AI 댓글은 비공개 상태예요.');
    } catch { if (mounted.current) setMessage('현재 공개 상태를 확인하지 못했어요. 다시 확인해주세요.'); }
    finally { inFlight.current = false; }
  };
  const statusCheckButton = isMine && visibilityNeedsCheck ? <Pressable accessibilityRole="button"
    disabled={query.isFetching} onPress={() => void checkVisibility()}
    style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed]}>
    <Text style={styles.secondaryButtonText}>현재 공개 상태 확인</Text>
  </Pressable> : null;
  const toneButtons = <ProfileAiToneButtons disabled={!canGenerate || busy || visibilityNeedsCheck}
    activeTone={activeTone} status={generationLabel('')} onRequest={(tone) => void run(tone)} />;

  if (query.isPending) return <View style={styles.card}>
    <View style={styles.headingRow}><View><Text style={styles.eyebrow}>ONEPICK AI</Text><Text style={styles.title}>AI가 본 나</Text></View>
      <ActivityIndicator accessibilityLabel="AI 취향평가 불러오는 중" /></View>
    {message ? <Text accessibilityLiveRegion="polite" style={styles.message}>{message}</Text> : null}
  </View>;
  if (query.isError) {
    if (!isMine) return null;
    return <View style={styles.card}><Text style={styles.eyebrow}>ONEPICK AI</Text><Text style={styles.title}>AI가 본 나</Text>
      <Text accessibilityRole="alert" style={styles.error}>AI 취향평가를 불러오지 못했어요.</Text>
      {message ? <Text accessibilityLiveRegion="polite" style={styles.message}>{message}</Text> : null}
      {statusCheckButton ?? <Pressable accessibilityRole="button" onPress={() => void query.refetch()}
        style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed]}>
        <Text style={styles.secondaryButtonText}>다시 불러오기</Text></Pressable>}
    </View>;
  }
  if (!review) {
    if (!isMine) return null;
    return <View style={styles.card}>
      <Text style={styles.eyebrow}>ONEPICK AI</Text><Text style={styles.title}>AI가 본 나</Text>
      <Text style={styles.tagline}>내 취향이 곧 나이다.</Text>
      <Text style={styles.guidance}>{PROFILE_AI_PICK_GUIDANCE}</Text>
      <Text accessibilityLiveRegion="polite" style={styles.hint}>{pickProgress}</Text>
      {eligibility.isError ? <Pressable accessibilityRole="button" disabled={eligibility.isFetching}
        onPress={() => void eligibility.refetch({ cancelRefetch: false })} style={({ pressed }) => [styles.statusButton, pressed && styles.pressed]}>
        <Text style={styles.statusButtonText}>원픽 수 다시 확인</Text></Pressable> : null}
      <Text style={styles.description}>버튼을 누르면 공개된 원픽의 제품·콘텐츠 정보와 한줄평이 OpenAI로 전달되어 취향의 패턴을 해석합니다. 사진과 SNS 정보는 보내지 않아요.</Text>
      <Text style={styles.hint}>결과는 먼저 나에게만 보여요. 확인한 뒤 프로필에 공개할 수 있어요.</Text>
      <ConnectionNotice query={connection} />
      {toneButtons}
      {statusCheckButton}
      {message ? <Text accessibilityLiveRegion="polite" style={styles.message}>{message}</Text> : null}
    </View>;
  }
  if (!isMine && (!review.isVisible || review.isStale)) return null;
  const date = new Date(review.generatedAt);
  const dateLabel = Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString('ko-KR');
  return <View style={styles.card}>
    <View style={styles.authorRow}><View style={styles.aiAvatar}><Text style={styles.aiAvatarText}>AI</Text></View>
      <View style={styles.authorCopy}><View style={styles.nameRow}><Text style={styles.authorName}>{review.actor.displayName}</Text>
        <View style={styles.badge}><Text style={styles.badgeText}>AI</Text></View></View>
        <Text style={styles.authorMeta}>{profileAiToneLabel(review.tone)}{review.isStale ? ' · 이전 원픽 기준' : ''}{dateLabel ? ` · ${dateLabel}` : ''}</Text>
      </View>
    </View>
    {isMine && review.isStale ? <Text accessibilityLiveRegion="polite" style={styles.hiddenNotice}>원픽 또는 제품·카테고리 정보가 바뀌어 이전 평가를 자동으로 숨겼어요. 현재 원픽으로 다시 평가해주세요.</Text>
      : !review.isVisible && isMine ? <Text style={styles.hiddenNotice}>나에게만 보이는 평가예요. 공개 여부를 직접 선택해주세요.</Text> : null}
    <Text style={styles.summary}>{review.summary}</Text><Text style={styles.body}>{review.body}</Text>
    <View style={styles.keywords}>{review.keywords.map((keyword, index) => <View key={`${index}:${keyword}`} style={styles.keyword}><Text style={styles.keywordText}>#{keyword}</Text></View>)}</View>
    <Text style={styles.disclaimer}>생성 당시의 취향에 대한 AI 해석이며, 사람의 가치·성격·능력이나 민감한 개인 특성을 진단하지 않습니다.</Text>
    {isMine ? <View style={styles.actions}>
      <Text style={styles.guidance}>{PROFILE_AI_PICK_GUIDANCE}</Text>
      <Text accessibilityLiveRegion="polite" style={styles.hint}>{pickProgress}</Text>
      {eligibility.isError ? <Pressable accessibilityRole="button" disabled={eligibility.isFetching}
        onPress={() => void eligibility.refetch({ cancelRefetch: false })} style={({ pressed }) => [styles.statusButton, pressed && styles.pressed]}>
        <Text style={styles.statusButtonText}>원픽 수 다시 확인</Text></Pressable> : null}
      <Text style={styles.hint}>다시 평가하면 공개 원픽 정보와 한줄평이 OpenAI로 전달됩니다. 원픽과 말투가 같으면 기존 결과를 보여줘요. 다른 말투로 새로 생성한 댓글도 본인 확인 후 다시 공개할 수 있어요.</Text>
      <Text style={styles.hint}>새 생성 요청은 두 말투를 합쳐 10분에 한 번 가능해요.</Text>
      <ConnectionNotice query={connection} />
      {toneButtons}
      <Pressable accessibilityRole="button" disabled={busy || visibilityNeedsCheck || query.isFetching || (review.isStale && !review.isVisible)}
        onPress={() => void changeVisibility()} style={({ pressed }) => [styles.secondaryButton, styles.actionButton,
          (busy || visibilityNeedsCheck || query.isFetching || (review.isStale && !review.isVisible)) && styles.disabled, pressed && styles.pressed]}>
        <Text style={styles.secondaryButtonText}>{review.isVisible ? '프로필에서 숨기기' : review.isStale ? '재평가 후 공개할 수 있어요' : '프로필에 공개하기'}</Text>
      </Pressable>
      {statusCheckButton}
    </View> : null}
    {message ? <Text accessibilityLiveRegion="polite" style={styles.message}>{message}</Text> : null}
  </View>;
}

const styles = StyleSheet.create({
  card: { backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#E3E5EA', borderRadius: 20, padding: 18, marginBottom: 18 },
  headingRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  eyebrow: { color: '#4945ED', fontSize: 11, fontWeight: '900', letterSpacing: 1.8 },
  title: { color: '#202124', fontSize: 18, fontWeight: '900', marginTop: 5 },
  tagline: { color: '#4945ED', fontSize: 13, fontWeight: '800', marginTop: 10 },
  guidance: { color: '#5F6470', fontSize: 12, lineHeight: 19, marginTop: 10 },
  description: { color: '#747985', fontSize: 12, lineHeight: 19, marginTop: 7 },
  hint: { color: '#747985', fontSize: 12, lineHeight: 18, marginTop: 10 },
  connectionNotice: { marginVertical: 6 },
  statusButton: { minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start', paddingHorizontal: 2 },
  statusButtonText: { color: '#4945ED', fontSize: 12, fontWeight: '800' },
  toneContainer: { marginTop: 14 }, toneHeading: { color: '#202124', fontSize: 14, fontWeight: '800' },
  toneRow: { flexDirection: 'row', gap: 10, marginTop: 12 }, toneOption: { flex: 1, minWidth: 0 },
  toneButton: { minHeight: 66, padding: 10, borderRadius: 14, backgroundColor: '#4945ED', alignItems: 'center', justifyContent: 'center' },
  warmButton: { backgroundColor: '#7454AD' },
  toneButtonText: { color: '#FFFFFF', fontSize: 12, fontWeight: '800', lineHeight: 18, textAlign: 'center' },
  toneDescription: { color: '#747985', fontSize: 10, lineHeight: 16, marginTop: 6, textAlign: 'center' },
  authorRow: { flexDirection: 'row', alignItems: 'center' },
  aiAvatar: { width: 44, height: 44, borderRadius: 15, backgroundColor: '#EFEEFF', alignItems: 'center', justifyContent: 'center' },
  aiAvatarText: { color: '#4945ED', fontSize: 13, fontWeight: '900' }, authorCopy: { flex: 1, marginLeft: 12 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 7 }, authorName: { color: '#202124', fontSize: 14, fontWeight: '900' },
  badge: { backgroundColor: '#4945ED', borderRadius: 999, paddingHorizontal: 7, paddingVertical: 3 },
  badgeText: { color: '#FFFFFF', fontSize: 9, fontWeight: '900' }, authorMeta: { color: '#89909C', fontSize: 11, marginTop: 4 },
  hiddenNotice: { color: '#A9482D', fontSize: 11, fontWeight: '700', lineHeight: 18, marginTop: 14 },
  summary: { color: '#202124', fontSize: 17, fontWeight: '900', lineHeight: 24, marginTop: 17 },
  body: { color: '#5F6470', fontSize: 13, lineHeight: 21, marginTop: 9 }, keywords: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginTop: 14 },
  keyword: { backgroundColor: '#F5F6F8', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6 },
  keywordText: { color: '#4945ED', fontSize: 11, fontWeight: '800' }, disclaimer: { color: '#89909C', fontSize: 10, lineHeight: 16, marginTop: 14 },
  actions: { gap: 8, marginTop: 14 },
  secondaryButton: { minHeight: 44, borderRadius: 14, backgroundColor: '#ECEEF3', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16, marginTop: 10 },
  secondaryButtonText: { color: '#5F6470', fontSize: 12, fontWeight: '800' }, actionButton: { marginTop: 0 },
  message: { color: '#5F6470', fontSize: 11, lineHeight: 17, marginTop: 10 }, error: { color: '#A9482D', fontSize: 12, lineHeight: 18, marginTop: 10 },
  disabled: { opacity: 0.45 }, pressed: { opacity: 0.72 },
});
