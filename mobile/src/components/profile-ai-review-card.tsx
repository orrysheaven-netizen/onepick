import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { AppError } from '@/errors/appError';
import { useAuthSession } from '@/hooks/useAuthSession';
import {
  useGenerateProfileAiReview,
  useProfileAiReview,
  useSetProfileAiReviewVisibility,
} from '@/hooks/useProfileAiReview';
import { MIN_PROFILE_AI_PICKS } from '@/services/profileAiReviewService';

type Props = {
  profileUserId: string;
  pickCount: number;
  isMine: boolean;
};

function errorMessage(error: unknown) {
  if (error instanceof AppError) {
    if (error.code === 'AI_NOT_CONFIGURED') return 'AI 분석 서버 연결이 아직 준비되지 않았어요.';
    if (error.code === 'AI_NOT_ENOUGH_PICKS') return `원픽이 최소 ${MIN_PROFILE_AI_PICKS}개 필요해요.`;
    if (error.code === 'RATE_LIMITED') return '조금 전에 분석했어요. 잠시 뒤 다시 시도해주세요.';
  }
  return 'AI 취향평가를 완료하지 못했어요. 다시 시도해주세요.';
}

export function ProfileAiReviewCard({ profileUserId, pickCount, isMine }: Props) {
  const auth = useAuthSession();
  const viewerId = auth.user?.id;
  const query = useProfileAiReview(profileUserId, viewerId);
  const generate = useGenerateProfileAiReview(profileUserId, pickCount, viewerId);
  const visibility = useSetProfileAiReviewVisibility(profileUserId, viewerId);
  const [message, setMessage] = useState('');
  const review = query.data ?? null;
  const missingCount = Math.max(MIN_PROFILE_AI_PICKS - pickCount, 0);
  const canGenerate = isMine && auth.user?.id === profileUserId && missingCount === 0;
  const busy = generate.isPending || visibility.isPending;

  const run = async () => {
    if (!canGenerate || busy) return;
    setMessage('');
    try {
      await generate.mutateAsync();
      setMessage('현재 원픽을 바탕으로 AI 취향평가를 업데이트했어요.');
    } catch (error) {
      setMessage(errorMessage(error));
    }
  };

  const changeVisibility = async () => {
    if (!review || !isMine || busy) return;
    setMessage('');
    try {
      await visibility.mutateAsync(!review.isVisible);
      setMessage(review.isVisible ? 'AI 취향평가를 공개 프로필에서 숨겼어요.' : 'AI 취향평가를 공개했어요.');
    } catch {
      setMessage('공개 설정을 바꾸지 못했어요.');
    }
  };

  if (query.isPending) {
    return (
      <View style={styles.card}>
        <View style={styles.headingRow}>
          <View>
            <Text style={styles.eyebrow}>ONEPICK AI</Text>
            <Text style={styles.title}>AI가 본 나</Text>
          </View>
          <ActivityIndicator accessibilityLabel="AI 취향평가 불러오는 중" />
        </View>
      </View>
    );
  }

  if (query.isError) {
    if (!isMine) return null;
    return (
      <View style={styles.card}>
        <Text style={styles.eyebrow}>ONEPICK AI</Text>
        <Text style={styles.title}>AI가 본 나</Text>
        <Text accessibilityRole="alert" style={styles.error}>AI 취향평가를 불러오지 못했어요.</Text>
        <Pressable accessibilityRole="button" onPress={() => void query.refetch()}
          style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed]}>
          <Text style={styles.secondaryButtonText}>다시 불러오기</Text>
        </Pressable>
      </View>
    );
  }

  if (!review) {
    if (!isMine) return null;
    return (
      <View style={styles.card}>
        <Text style={styles.eyebrow}>ONEPICK AI</Text>
        <Text style={styles.title}>AI가 본 나</Text>
        <Text style={styles.tagline}>내 취향이 곧 나이다.</Text>
        <Text style={styles.description}>
          공개한 원픽과 한줄평에서 반복되는 취향의 패턴을 AI가 짧게 해석합니다.
        </Text>
        {missingCount > 0 ? (
          <Text style={styles.hint}>원픽을 {missingCount}개 더 고르면 평가를 받을 수 있어요.</Text>
        ) : null}
        <Pressable accessibilityRole="button" disabled={!canGenerate || busy} onPress={() => void run()}
          style={({ pressed }) => [styles.primaryButton, (!canGenerate || busy) && styles.disabled, pressed && styles.pressed]}>
          {generate.isPending ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.primaryButtonText}>AI에게 내 취향 보여주기</Text>}
        </Pressable>
        {message ? <Text accessibilityLiveRegion="polite" style={styles.message}>{message}</Text> : null}
      </View>
    );
  }

  return (
    <View style={styles.card}>
      <View style={styles.authorRow}>
        <View style={styles.aiAvatar}><Text style={styles.aiAvatarText}>AI</Text></View>
        <View style={styles.authorCopy}>
          <View style={styles.nameRow}>
            <Text style={styles.authorName}>{review.actor.displayName}</Text>
            <View style={styles.badge}><Text style={styles.badgeText}>AI</Text></View>
          </View>
          <Text style={styles.authorMeta}>공개된 원픽을 바탕으로 한 취향 해석</Text>
        </View>
      </View>

      {!review.isVisible && isMine ? <Text style={styles.hiddenNotice}>현재 공개 프로필에서는 숨김 상태예요.</Text> : null}
      <Text style={styles.summary}>{review.summary}</Text>
      <Text style={styles.body}>{review.body}</Text>
      <View style={styles.keywords}>
        {review.keywords.map((keyword) => (
          <View key={keyword} style={styles.keyword}><Text style={styles.keywordText}>#{keyword}</Text></View>
        ))}
      </View>
      <Text style={styles.disclaimer}>
        이 내용은 취향 패턴에 대한 AI 해석이며 성격·능력·민감한 개인 특성을 진단하지 않습니다.
      </Text>

      {isMine ? (
        <View style={styles.actions}>
          <Pressable accessibilityRole="button" disabled={!canGenerate || busy} onPress={() => void run()}
            style={({ pressed }) => [styles.primaryButton, styles.actionButton, (!canGenerate || busy) && styles.disabled, pressed && styles.pressed]}>
            {generate.isPending ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.primaryButtonText}>현재 원픽으로 다시 평가</Text>}
          </Pressable>
          <Pressable accessibilityRole="button" disabled={busy} onPress={() => void changeVisibility()}
            style={({ pressed }) => [styles.secondaryButton, styles.actionButton, busy && styles.disabled, pressed && styles.pressed]}>
            <Text style={styles.secondaryButtonText}>{review.isVisible ? '프로필에서 숨기기' : '프로필에 공개하기'}</Text>
          </Pressable>
        </View>
      ) : null}
      {message ? <Text accessibilityLiveRegion="polite" style={styles.message}>{message}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#E3E5EA', borderRadius: 20, padding: 18, marginBottom: 18 },
  headingRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  eyebrow: { color: '#4945ED', fontSize: 11, fontWeight: '900', letterSpacing: 1.8 },
  title: { color: '#202124', fontSize: 18, fontWeight: '900', marginTop: 5 },
  tagline: { color: '#4945ED', fontSize: 13, fontWeight: '800', marginTop: 10 },
  description: { color: '#747985', fontSize: 12, lineHeight: 19, marginTop: 7 },
  hint: { color: '#747985', fontSize: 12, lineHeight: 18, marginTop: 10 },
  authorRow: { flexDirection: 'row', alignItems: 'center' },
  aiAvatar: { width: 44, height: 44, borderRadius: 15, backgroundColor: '#EFEEFF', alignItems: 'center', justifyContent: 'center' },
  aiAvatarText: { color: '#4945ED', fontSize: 13, fontWeight: '900' },
  authorCopy: { flex: 1, marginLeft: 12 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  authorName: { color: '#202124', fontSize: 14, fontWeight: '900' },
  badge: { backgroundColor: '#4945ED', borderRadius: 999, paddingHorizontal: 7, paddingVertical: 3 },
  badgeText: { color: '#FFFFFF', fontSize: 9, fontWeight: '900' },
  authorMeta: { color: '#89909C', fontSize: 11, marginTop: 4 },
  hiddenNotice: { color: '#A9482D', fontSize: 11, fontWeight: '700', marginTop: 14 },
  summary: { color: '#202124', fontSize: 17, fontWeight: '900', lineHeight: 24, marginTop: 17 },
  body: { color: '#5F6470', fontSize: 13, lineHeight: 21, marginTop: 9 },
  keywords: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginTop: 14 },
  keyword: { backgroundColor: '#F5F6F8', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6 },
  keywordText: { color: '#4945ED', fontSize: 11, fontWeight: '800' },
  disclaimer: { color: '#89909C', fontSize: 10, lineHeight: 16, marginTop: 14 },
  actions: { gap: 8, marginTop: 14 },
  primaryButton: { minHeight: 46, borderRadius: 14, backgroundColor: '#4945ED', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16, marginTop: 14 },
  primaryButtonText: { color: '#FFFFFF', fontSize: 12, fontWeight: '900' },
  secondaryButton: { minHeight: 44, borderRadius: 14, backgroundColor: '#ECEEF3', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16, marginTop: 10 },
  secondaryButtonText: { color: '#5F6470', fontSize: 12, fontWeight: '800' },
  actionButton: { marginTop: 0 },
  message: { color: '#5F6470', fontSize: 11, lineHeight: 17, marginTop: 10 },
  error: { color: '#A9482D', fontSize: 12, lineHeight: 18, marginTop: 10 },
  disabled: { opacity: 0.45 },
  pressed: { opacity: 0.72 },
});
