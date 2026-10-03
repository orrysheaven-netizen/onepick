import { useEffect, useMemo, useRef } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAuthSession } from '@/hooks/useAuthSession';
import { useMyProfile } from '@/hooks/useMyProfile';
import { useExploreCategories } from '@/hooks/useExploreData';
import { useRegistrationCategories } from '@/hooks/useRegisterPick';
import {
  useCompleteOnboarding,
  useOnboardingProgress,
  usePauseOnboarding,
  useRecordOnboardingAction,
  useSetOnboardingCurrent,
} from '@/hooks/useOnboarding';
import { categoryPath } from '@/lib/categories/categoryTree';
import { chooseOnboardingCategory } from '@/lib/onboarding/categorySequence';
import { Button, StateCard } from '@/components/ui';
import { isLabCategory } from '@/lib/profile/profilePickGroups';
import { OnePick, OnePickFeatures, OnePickMvp } from '@/constants/onepick';

export default function OnboardingScreen() {
  const router = useRouter();
  const { user, isLoading: sessionLoading } = useAuthSession();
  const profile = useMyProfile(user?.id);
  const categories = useRegistrationCategories();
  const categoryCatalog = useExploreCategories(Boolean(categories.data));
  const progress = useOnboardingProgress(user?.id);
  const setCurrent = useSetOnboardingCurrent(user?.id);
  const recordAction = useRecordOnboardingAction(user?.id);
  const pause = usePauseOnboarding(user?.id);
  const complete = useCompleteOnboarding(user?.id);
  const persisted = useRef<string | null>(null);

  const selectedIds = useMemo(
    () => profile.data?.currentPicks.map(({ pick }) => pick.categoryId) ?? [],
    [profile.data?.currentPicks],
  );
  const events = progress.data?.events ?? [];
  const handled = useMemo(
    () => [...new Set([...selectedIds, ...events.map((event) => event.categoryId)])],
    [events, selectedIds],
  );

  // 실험실 themes are not offered here; wait for the catalog so none slips in before themes
  // are known (a failed catalog falls back to every category rather than an empty flow).
  const catalogReady = !OnePickFeatures.lab || Boolean(categoryCatalog.data) || categoryCatalog.isError;
  const mainCategories = useMemo(() => (categories.data ?? []).filter((category) =>
    !isLabCategory(category.id, categoryCatalog.data ?? [], OnePickMvp.mainThemeCode, OnePickFeatures.lab)),
  [categories.data, categoryCatalog.data]);

  const current = useMemo(() => !catalogReady ? null : chooseOnboardingCategory({
    categories: mainCategories,
    currentCategoryId: progress.data?.state?.currentCategoryId,
    handledCategoryIds: handled,
    events,
    userId: user?.id ?? 'anonymous',
  }), [catalogReady, mainCategories, events, handled, progress.data?.state?.currentCategoryId, user?.id]);

  useEffect(() => {
    if (!user || !current || setCurrent.isPending) return;
    if (progress.data?.state?.currentCategoryId === current.id || persisted.current === current.id) return;
    persisted.current = current.id;
    void setCurrent.mutateAsync(current.id).catch(() => { persisted.current = null; });
  }, [current, progress.data?.state?.currentCategoryId, setCurrent, user]);

  const currentPath = current ? categoryPath(current, categoryCatalog.data ?? []) : null;
  const fallbackParts = current ? (current.label ?? current.name).split(' › ') : [];
  const currentParentName = currentPath?.parent?.name ?? (fallbackParts.length > 1 ? fallbackParts[0] : null);
  const currentCategoryName = current?.name ?? fallbackParts.at(-1) ?? '';

  const pickCount = profile.data?.currentPicks.length ?? 0;
  // Profile and progress queries only run with a signed-in user, so a signed-out visit must not
  // wait on them; a failed load must not wait on the catalog, which only runs after categories load.
  const signedOut = !sessionLoading && !user;
  // No profile yet is expected for a new sign-in (사용자명 단계); only other failures are load errors.
  const profileMissing = profile.isError && (profile.error as { code?: string } | null)?.code === 'PROFILE_NOT_FOUND';
  const loadFailed = !signedOut && ((profile.isError && !profileMissing) || categories.isError || progress.isError);
  const loading = !signedOut && !loadFailed
    && (sessionLoading || profile.isPending || categories.isPending || progress.isPending || !catalogReady);
  const canEvaluate = pickCount >= 10;
  const retryLoad = () => {
    if (profile.isError && !profileMissing) void profile.refetch();
    if (categories.isError) void categories.refetch();
    if (progress.isError) void progress.refetch();
  };

  const skip = async () => {
    if (!current || setCurrent.isPending || recordAction.isPending) return;
    persisted.current = null;
    await recordAction.mutateAsync({ categoryId: current.id, action: 'skipped' }).catch(() => {});
  };
  const exit = async () => {
    if (!pause.isPending) await pause.mutateAsync().catch(() => {});
    router.replace('/profile');
  };
  const finish = async () => {
    if (!complete.isPending) await complete.mutateAsync().catch(() => {});
    router.replace('/profile');
  };

  if (signedOut) return <SafeAreaView style={styles.safeArea}><View style={styles.center}>
    <StateCard title="로그인하고 취향을 골라보세요" text="카테고리마다 가장 좋아하는 하나를 고르면 내 프로필에 모여요."
      action={{ label: '로그인하기', variant: 'primary', onPress: () => router.replace('/auth/login') }} />
  </View></SafeAreaView>;
  if (loadFailed) return <SafeAreaView style={styles.safeArea}><View style={styles.center}>
    <StateCard tone="danger" accessibilityRole="alert" title="취향 카테고리를 불러오지 못했어요" text="연결 상태를 확인하고 다시 시도해주세요."
      action={{ label: '다시 불러오기', variant: 'primary', onPress: retryLoad }} />
    <Button variant="ghost" label="홈으로" onPress={() => router.replace('/')} />
  </View></SafeAreaView>;
  if (loading) return <SafeAreaView style={styles.safeArea}><View style={styles.center}><StateCard loading title="취향 카테고리를 준비하고 있어요." /></View></SafeAreaView>;
  if (profileMissing || !profile.data) return <SafeAreaView style={styles.safeArea}><View style={styles.center}>
    <StateCard title="사용자명을 먼저 만들어주세요" action={{ label: '사용자명 만들기', variant: 'primary', onPress: () => router.replace('/auth/username') }} />
  </View></SafeAreaView>;

  return <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
    <View style={styles.content}>
      <View style={styles.topRow}>
        <Text style={styles.title}>내 취향부터 가볍게</Text>
        <Button variant="ghost" size="sm" label="나중에 하기" onPress={() => void exit()} />
      </View>
      <Text style={styles.subtitle}>마음이 가는 카테고리만 고르세요. 관심 없으면 넘겨도 되고, 언제든 이어서 할 수 있어요.</Text>

      <View style={styles.progressCard}>
        <View style={styles.progressHeader}>
          <Text style={styles.progressLabel}>{Math.min(pickCount, 10)}/10</Text>
          <Text style={styles.progressHint}>{pickCount < 10 ? '10개부터 AI 평가' : 'AI 평가 가능'}</Text>
        </View>
        <View style={styles.track}><View style={[styles.fill, { width: `${Math.min(100, pickCount * 10)}%` }]} /></View>
        <View style={styles.marker}><Text style={styles.markerText}>10</Text></View>
        {canEvaluate ? <Button variant="soft" size="sm" fullWidth style={styles.aiButton} onPress={() => router.push('/profile')}
          label="AI 평가 보기" /> : null}
      </View>

      {current ? <View style={styles.categoryCard}>
        <Text style={styles.cardKicker}>이번 카테고리</Text>
        {currentParentName ? <View style={styles.parentPill}><Text style={styles.parentPillText}>{currentParentName}</Text></View> : null}
        <Text style={styles.categoryName}>{currentCategoryName}</Text>
        <Text style={styles.cardText}>여기서 지금 가장 좋아하는 하나가 떠오르나요?</Text>
        <Button size="lg" fullWidth style={styles.primary} disabled={setCurrent.isPending} label="이 카테고리에서 원픽 고르기"
          onPress={() => router.push({ pathname: '/pick/find', params: { categoryId: current.id, onboarding: '1' } })} />
        <Button variant="ghost" style={styles.skip} disabled={setCurrent.isPending || recordAction.isPending} onPress={() => void skip()}
          label={setCurrent.isPending ? '준비 중…' : recordAction.isPending ? '넘기는 중…' : '넘기기'} />
      </View> : <View style={styles.categoryCard}>
        <Text style={styles.categoryName}>지금 보여드릴 카테고리를 모두 봤어요</Text>
        <Text style={styles.cardText}>새 카테고리가 열리면 다시 이어서 고를 수 있어요.</Text>
        <Button size="lg" fullWidth style={styles.primary} label="프로필로 이동" onPress={() => void finish()} />
      </View>}

      <Text style={styles.footer}>넘기기는 추천 순서를 다듬는 신호로만 사용하고, AI 평가의 성격 판단 근거로 사용하지 않아요.</Text>
    </View>
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: OnePick.background },
  content: { flex: 1, width: '100%', maxWidth: OnePick.maxWidth, alignSelf: 'center', paddingHorizontal: 20, paddingTop: 24, paddingBottom: 28 },
  center: { flex: 1, width: '100%', maxWidth: OnePick.maxWidth, alignSelf: 'center', justifyContent: 'center', padding: 20 },
  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 14 },
  title: { flex: 1, color: OnePick.text, fontSize: 26, lineHeight: 34, fontWeight: '800', letterSpacing: -0.6 },
  subtitle: { color: OnePick.muted, fontSize: 14, lineHeight: 20, marginTop: 10 },
  progressCard: { backgroundColor: OnePick.surface, borderRadius: 20, borderWidth: 1, borderColor: OnePick.border, padding: 18, marginTop: 24 },
  progressHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 },
  progressLabel: { color: OnePick.text, fontSize: 19, lineHeight: 26, fontWeight: '700', letterSpacing: -0.4 },
  progressHint: { color: OnePick.muted, fontSize: 12, lineHeight: 16, flex: 1, textAlign: 'right' },
  track: { height: 9, backgroundColor: OnePick.sunken, borderRadius: 999, overflow: 'hidden', marginTop: 14 },
  fill: { height: '100%', backgroundColor: OnePick.accent, borderRadius: 999 },
  marker: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: 5 },
  markerText: { color: OnePick.textSecondary, fontSize: 12, lineHeight: 16 },
  aiButton: { marginTop: 14 },
  categoryCard: { backgroundColor: OnePick.surface, borderRadius: 20, borderWidth: 1, borderColor: OnePick.border, padding: 20, marginTop: 16 },
  cardKicker: { color: OnePick.accentDeep, fontSize: 12, lineHeight: 16, fontWeight: '600' },
  parentPill: { alignSelf: 'flex-start', borderRadius: 999, backgroundColor: OnePick.accentSoft, paddingHorizontal: 10, paddingVertical: 5, marginTop: 12 },
  parentPillText: { color: OnePick.accentDeep, fontSize: 12, lineHeight: 16, fontWeight: '700' },
  categoryName: { color: OnePick.text, fontSize: 22, lineHeight: 30, fontWeight: '800', letterSpacing: -0.5, marginTop: 8 },
  cardText: { color: OnePick.muted, fontSize: 14, lineHeight: 20, marginTop: 8 },
  primary: { marginTop: 20 },
  skip: { alignSelf: 'center', marginTop: 6 },
  footer: { color: OnePick.muted, fontSize: 12, lineHeight: 16, marginTop: 18 },
  pressed: { opacity: 0.72 },
});
