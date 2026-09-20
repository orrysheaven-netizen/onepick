import { useEffect, useMemo, useRef } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
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

  const current = useMemo(() => chooseOnboardingCategory({
    categories: categories.data ?? [],
    currentCategoryId: progress.data?.state?.currentCategoryId,
    handledCategoryIds: handled,
    events,
    userId: user?.id ?? 'anonymous',
  }), [categories.data, events, handled, progress.data?.state?.currentCategoryId, user?.id]);

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
  const loading = sessionLoading || profile.isPending || categories.isPending || progress.isPending;
  const canEvaluate = pickCount >= 5;
  const reachedRecommended = pickCount >= 10;

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

  if (loading) return <SafeAreaView style={styles.safeArea}><View style={styles.center}><ActivityIndicator /><Text style={styles.stateText}>취향 카테고리를 준비하고 있어요.</Text></View></SafeAreaView>;
  if (!user || profile.isError || !profile.data) return <SafeAreaView style={styles.safeArea}><View style={styles.center}>
    <Text style={styles.title}>프로필을 먼저 만들어주세요</Text>
    <Pressable onPress={() => router.replace('/auth/login')} style={styles.primary}><Text style={styles.primaryText}>로그인하기</Text></Pressable>
  </View></SafeAreaView>;

  return <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
    <View style={styles.content}>
      <View style={styles.topRow}>
        <View><Text style={styles.eyebrow}>TASTE ONBOARDING</Text><Text style={styles.title}>내 취향부터 가볍게</Text></View>
        <Pressable accessibilityRole="button" onPress={() => void exit()} style={styles.exit}><Text style={styles.exitText}>나중에 하기</Text></Pressable>
      </View>
      <Text style={styles.subtitle}>마음이 가는 카테고리만 고르세요. 관심 없으면 넘겨도 되고, 언제든 이어서 할 수 있어요.</Text>

      <View style={styles.progressCard}>
        <View style={styles.progressHeader}>
          <Text style={styles.progressLabel}>{Math.min(pickCount, 10)}/10</Text>
          <Text style={styles.progressHint}>{pickCount < 5 ? '5개부터 AI 평가' : reachedRecommended ? '권장 목표 달성' : '더 고르면 해석이 더 풍부해져요'}</Text>
        </View>
        <View style={styles.track}><View style={[styles.fill, { width: `${Math.min(100, pickCount * 10)}%` }]} /></View>
        <View style={styles.marker}><Text style={styles.markerText}>5</Text><Text style={styles.markerText}>10</Text></View>
        {canEvaluate ? <Pressable accessibilityRole="button" onPress={() => router.push('/profile')} style={styles.aiButton}>
          <Text style={styles.aiButtonText}>{reachedRecommended ? '더 풍부한 AI 평가 보기' : '지금 AI 평가 보기'}</Text>
        </Pressable> : null}
      </View>

      {current ? <View style={styles.categoryCard}>
        <Text style={styles.cardKicker}>이번 카테고리</Text>
        {currentParentName ? <View style={styles.parentPill}><Text style={styles.parentPillText}>{currentParentName}</Text></View> : null}
        <Text style={styles.categoryName}>{currentCategoryName}</Text>
        <Text style={styles.cardText}>여기서 지금 가장 좋아하는 하나가 떠오르나요?</Text>
        <Pressable
          accessibilityRole="button"
          disabled={setCurrent.isPending}
          onPress={() => router.push({ pathname: '/pick/find', params: { categoryId: current.id, onboarding: '1' } })}
          style={({ pressed }) => [styles.primary, setCurrent.isPending && styles.disabled, pressed && styles.pressed]}>
          <Text style={styles.primaryText}>이 카테고리에서 원픽 고르기</Text>
        </Pressable>
        <Pressable accessibilityRole="button" disabled={setCurrent.isPending || recordAction.isPending} onPress={() => void skip()}
          style={({ pressed }) => [styles.skip, (setCurrent.isPending || recordAction.isPending) && styles.disabled, pressed && styles.pressed]}>
          <Text style={styles.skipText}>{setCurrent.isPending ? '준비 중…' : recordAction.isPending ? '넘기는 중…' : '넘기기'}</Text>
        </Pressable>
      </View> : <View style={styles.categoryCard}>
        <Text style={styles.categoryName}>지금 보여드릴 카테고리를 모두 봤어요</Text>
        <Text style={styles.cardText}>새 카테고리가 열리면 다시 이어서 고를 수 있어요.</Text>
        <Pressable onPress={() => void finish()} style={styles.primary}><Text style={styles.primaryText}>프로필로 이동</Text></Pressable>
      </View>}

      <Text style={styles.footer}>넘기기는 추천 순서를 다듬는 신호로만 사용하고, AI 평가의 성격 판단 근거로 사용하지 않아요.</Text>
    </View>
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#F5F6F8' },
  content: { flex: 1, width: '100%', maxWidth: 560, alignSelf: 'center', paddingHorizontal: 22, paddingTop: 24, paddingBottom: 28 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  stateText: { color: '#747985', fontSize: 13, marginTop: 10 },
  topRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 14 },
  eyebrow: { color: '#4945ED', fontSize: 11, fontWeight: '900', letterSpacing: 2 },
  title: { color: '#202124', fontSize: 27, lineHeight: 34, fontWeight: '900', marginTop: 7 },
  subtitle: { color: '#747985', fontSize: 13, lineHeight: 20, marginTop: 12 },
  exit: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 4 },
  exitText: { color: '#747985', fontSize: 12, fontWeight: '800' },
  progressCard: { backgroundColor: '#FFFFFF', borderRadius: 20, borderWidth: 1, borderColor: '#E3E5EA', padding: 18, marginTop: 24 },
  progressHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 },
  progressLabel: { color: '#202124', fontSize: 19, fontWeight: '900' },
  progressHint: { color: '#747985', fontSize: 11, flex: 1, textAlign: 'right' },
  track: { height: 9, backgroundColor: '#ECEEF3', borderRadius: 999, overflow: 'hidden', marginTop: 14 },
  fill: { height: '100%', backgroundColor: '#4945ED', borderRadius: 999 },
  marker: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 5 },
  markerText: { color: '#89909C', fontSize: 10 },
  aiButton: { minHeight: 44, borderRadius: 14, backgroundColor: '#EFEEFF', alignItems: 'center', justifyContent: 'center', marginTop: 14 },
  aiButtonText: { color: '#4945ED', fontSize: 12, fontWeight: '900' },
  categoryCard: { backgroundColor: '#FFFFFF', borderRadius: 24, borderWidth: 1, borderColor: '#E3E5EA', padding: 22, marginTop: 18 },
  cardKicker: { color: '#4945ED', fontSize: 11, fontWeight: '900', letterSpacing: 1.4 },
  parentPill: { alignSelf: 'flex-start', borderRadius: 999, backgroundColor: '#EFEEFF', paddingHorizontal: 10, paddingVertical: 5, marginTop: 12 },
  parentPillText: { color: '#4945ED', fontSize: 10, fontWeight: '900' },
  categoryName: { color: '#202124', fontSize: 25, lineHeight: 32, fontWeight: '900', marginTop: 8 },
  cardText: { color: '#747985', fontSize: 13, lineHeight: 20, marginTop: 9 },
  primary: { minHeight: 52, borderRadius: 16, backgroundColor: '#4945ED', alignItems: 'center', justifyContent: 'center', marginTop: 22, paddingHorizontal: 16 },
  primaryText: { color: '#FFFFFF', fontSize: 14, fontWeight: '900' },
  skip: { minHeight: 48, alignItems: 'center', justifyContent: 'center', marginTop: 8 },
  skipText: { color: '#747985', fontSize: 12, fontWeight: '800' },
  footer: { color: '#89909C', fontSize: 10, lineHeight: 16, marginTop: 18 },
  disabled: { opacity: 0.45 },
  pressed: { opacity: 0.72 },
});
