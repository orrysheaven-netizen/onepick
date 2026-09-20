import { Pressable, StyleSheet, Text, View } from 'react-native';

import { ProfileAiComment } from '@/components/profile-ai-comment';
import { useGenerateProfileAi, useProfileAiComment, useProfileAiStatus, useSetProfileAiVisibility } from '@/hooks/useProfileAi';
import type { ProfileAiStatus } from '@/services/profileAiService';

// The cooldown is at most 24h, so day-granularity would read as "약 1일" for
// anything from 1 minute to 24 hours remaining. Hours stay meaningful throughout.
function hoursFromSeconds(seconds: number) {
  return Math.max(1, Math.ceil(seconds / 3600));
}

function progressCopy(status: ProfileAiStatus) {
  if (!status.hasReview) {
    if (status.currentPickCount < status.minimumPicks) {
      return `${status.currentPickCount}/${status.minimumPicks} · 원픽 ${status.minimumPicks - status.currentPickCount}개만 더 고르면 AI 평가가 열려요.`;
    }
    const extra = status.currentPickCount > status.minimumPicks
      ? ` 현재 원픽 ${status.currentPickCount}개 · 10개까지 채우면 해석이 더 풍부해져요.`
      : ' 10개까지 채우면 해석이 더 풍부해져요.';
    return `${status.minimumPicks}/${status.minimumPicks}개를 채웠으니 AI 평가가 가능합니다.${extra}`;
  }
  if (status.reviewPickCount < status.recommendedPicks) {
    if (status.currentPickCount < status.recommendedPicks) {
      return `${status.currentPickCount}/${status.recommendedPicks} · ${status.recommendedPicks - status.currentPickCount}개 더 고르면 더 풍부한 평가로 갱신할 수 있어요.`;
    }
    return '10개의 원픽이 모였어요. 더 풍부한 AI 평가로 한 번 바로 갱신할 수 있어요.';
  }
  const changeText = `새로운 취향 변화 ${Math.min(status.changedCount, status.minimumChanges)}/${status.minimumChanges}`;
  if (status.retryAfterSeconds > 0) {
    return `${changeText} · 다음 재평가까지 약 ${hoursFromSeconds(status.retryAfterSeconds)}시간`;
  }
  return status.changedCount >= status.minimumChanges
    ? `${changeText} · 다시 평가할 수 있어요.`
    : `${changeText} · 원픽을 더 추가하거나 바꾸면 AI가 다시 읽어요.`;
}

export function ProfileAiPanel({
  profileId,
  currentPickCount,
  previewStatus,
}: {
  profileId: string;
  currentPickCount: number;
  previewStatus?: ProfileAiStatus;
}) {
  const preview = Boolean(previewStatus);
  const status = useProfileAiStatus(preview ? undefined : profileId);
  const comment = useProfileAiComment(preview ? undefined : profileId);
  const generate = useGenerateProfileAi(preview ? undefined : profileId);
  const visibility = useSetProfileAiVisibility(preview ? undefined : profileId);
  const value = previewStatus ?? status.data;
  const fallbackReadyForFirstReview =
    !value &&
    !status.isPending &&
    !comment.isPending &&
    comment.data === null &&
    currentPickCount >= 5;

  return <View style={styles.section}>
    <View style={styles.headingRow}>
      <View>
        <Text style={styles.eyebrow}>AI TASTE COMMENT</Text>
        <Text style={styles.title}>AI 취향평가</Text>
      </View>
      <Text style={styles.concept}>내 취향이 곧 나이다.</Text>
    </View>

    <View style={styles.bridgeCard}>
      <Text style={styles.bridgeBadge}>구성 → 해석</Text>
      <Text style={styles.bridgeText}>위 구성은 큰 틀만 보여줘요. AI는 비율을 점수로 쓰지 않고, 원픽과 한줄평의 공통점·대비를 직접 읽어요.</Text>
    </View>

    {value ? <View style={styles.progressCard}>
      <Text style={styles.progressText}>{progressCopy(value)}</Text>
      <View style={styles.track}>
        <View style={[styles.fill, { width: `${Math.min(100, (Math.min(value.currentPickCount, 10) / 10) * 100)}%` }]} />
      </View>
      <Pressable
        accessibilityRole="button"
        disabled={!value.canGenerate || generate.isPending}
        onPress={() => { if (!preview) generate.mutate(); }}
        style={({ pressed }) => [styles.primaryButton, (!value.canGenerate || generate.isPending) && styles.disabled, pressed && styles.pressed]}>
        <Text style={styles.primaryButtonText}>{generate.isPending ? 'AI가 취향을 읽는 중…' : value.hasReview ? 'AI가 다시 본 나' : 'AI 평가 보기'}</Text>
      </Pressable>
      {generate.isError ? <Text accessibilityRole="alert" style={styles.error}>AI 평가를 만들지 못했어요. 잠시 후 다시 시도해주세요.</Text> : null}
    </View> : fallbackReadyForFirstReview ? <View style={styles.progressCard}>
      <Text style={styles.progressText}>5/5개를 채웠으니 AI 평가가 가능합니다.{currentPickCount > 5 ? ` 현재 원픽 ${currentPickCount}개 · 10개까지 채우면 해석이 더 풍부해져요.` : ' 10개까지 채우면 해석이 더 풍부해져요.'}</Text>
      <View style={styles.track}>
        <View style={[styles.fill, { width: `${Math.min(100, (Math.min(currentPickCount, 10) / 10) * 100)}%` }]} />
      </View>
      <Pressable
        accessibilityRole="button"
        disabled={generate.isPending}
        onPress={() => { if (!preview) generate.mutate(); }}
        style={({ pressed }) => [styles.primaryButton, generate.isPending && styles.disabled, pressed && styles.pressed]}>
        <Text style={styles.primaryButtonText}>{generate.isPending ? 'AI가 취향을 읽는 중…' : 'AI 평가 보기'}</Text>
      </Pressable>
      {generate.isError ? <Text accessibilityRole="alert" style={styles.error}>AI 평가를 만들지 못했어요. 잠시 후 다시 시도해주세요.</Text> : null}
    </View> : status.isPending ? <Text style={styles.helper}>AI 평가 가능 여부를 확인하고 있어요.</Text>
      : <Text style={styles.error}>AI 평가 상태를 불러오지 못했어요.</Text>}

    {preview ? <Text style={styles.previewNote}>QA PREVIEW · 버튼은 실제 요청을 보내지 않아요.</Text> : <ProfileAiComment profileId={profileId} showPrivate />}

    {!preview && comment.data ? <Pressable
      accessibilityRole="button"
      disabled={visibility.isPending}
      onPress={() => visibility.mutate(!comment.data!.isVisible)}
      style={({ pressed }) => [styles.visibilityButton, pressed && styles.pressed]}>
      <Text style={styles.visibilityText}>{comment.data.isVisible ? 'AI 댓글 비공개로 전환' : 'AI 댓글을 프로필에 공개'}</Text>
    </Pressable> : null}
  </View>;
}

const styles = StyleSheet.create({
  section: { marginTop: 6, marginBottom: 18 },
  headingRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', gap: 12, marginBottom: 10 },
  eyebrow: { color: '#4945ED', fontSize: 10, fontWeight: '900', letterSpacing: 1.6 },
  title: { color: '#202124', fontSize: 19, fontWeight: '900', marginTop: 4 },
  concept: { color: '#747985', fontSize: 11, textAlign: 'right' },
  bridgeCard: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, borderRadius: 14, backgroundColor: '#F1F2F6', paddingHorizontal: 11, paddingVertical: 9, marginBottom: 10 },
  bridgeBadge: { color: '#4945ED', fontSize: 10, fontWeight: '900', paddingTop: 1 },
  bridgeText: { flex: 1, color: '#5F6470', fontSize: 11, lineHeight: 16 },
  progressCard: { borderWidth: 1, borderColor: '#E3E5EA', backgroundColor: '#FFFFFF', borderRadius: 18, padding: 16, marginBottom: 10 },
  progressText: { color: '#202124', fontSize: 13, lineHeight: 20, fontWeight: '700' },
  track: { height: 7, borderRadius: 999, backgroundColor: '#ECEEF3', overflow: 'hidden', marginTop: 12 },
  fill: { height: '100%', backgroundColor: '#4945ED', borderRadius: 999 },
  helper: { color: '#747985', fontSize: 11, lineHeight: 17, marginTop: 8 },
  primaryButton: { minHeight: 46, borderRadius: 14, backgroundColor: '#4945ED', alignItems: 'center', justifyContent: 'center', marginTop: 12 },
  primaryButtonText: { color: '#FFFFFF', fontSize: 13, fontWeight: '900' },
  visibilityButton: { minHeight: 44, alignItems: 'center', justifyContent: 'center', backgroundColor: '#ECEEF3', borderRadius: 14, marginTop: -6 },
  visibilityText: { color: '#5F6470', fontSize: 12, fontWeight: '800' },
  disabled: { opacity: 0.4 },
  pressed: { opacity: 0.72 },
  previewNote: { color: '#89909C', fontSize: 10, lineHeight: 16, marginTop: -2, marginBottom: 10 },
  error: { color: '#A9482D', fontSize: 11, lineHeight: 17, marginTop: 10 },
});
