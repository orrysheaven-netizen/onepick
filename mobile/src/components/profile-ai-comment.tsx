import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { SectionHeader } from '@/components/ui';
import { useProfileAiComment } from '@/hooks/useProfileAi';
import { OnePick } from '@/constants/onepick';

export function ProfileAiComment({
  profileId,
  showPrivate = false,
  sectionTitle,
  sectionDescription,
}: {
  profileId: string;
  showPrivate?: boolean;
  sectionTitle?: string;
  sectionDescription?: string;
}) {
  const query = useProfileAiComment(profileId);

  if (query.isPending) {
    return <View style={styles.loading}><ActivityIndicator size="small" /><Text style={styles.loadingText}>AI 댓글 확인 중</Text></View>;
  }
  if (query.isError || !query.data) return null;
  if (!showPrivate && !query.data.isVisible) return null;

  const comment = query.data;
  return <>
    {sectionTitle ? <View style={styles.sectionHeading}>
      <SectionHeader title={sectionTitle} />
      {sectionDescription ? <View style={styles.bridgeCard}>
        <Text style={styles.bridgeBadge}>구성 → 해석</Text>
        <Text style={styles.bridgeText}>{sectionDescription}</Text>
      </View> : null}
    </View> : null}
    <View style={styles.card}>
    <View style={styles.header}>
      <View style={styles.avatar}><Text style={styles.avatarText}>AI</Text></View>
      <View style={styles.headerCopy}>
        <View style={styles.nameRow}>
          <Text style={styles.name}>{comment.actor?.displayName ?? 'OnePick AI'}</Text>
          <Text style={styles.badge}>공식 AI</Text>
          {showPrivate && !comment.isVisible ? <Text style={styles.privateBadge}>비공개</Text> : null}
        </View>
        <Text style={styles.meta}>내 취향이 곧 나이다.</Text>
      </View>
    </View>
    <Text style={styles.summary}>{comment.summary}</Text>
    <Text style={styles.body}>{comment.body}</Text>
    <View style={styles.keywords}>{comment.keywords.map((keyword) =>
      <View key={keyword} style={styles.keyword}><Text style={styles.keywordText}>#{keyword}</Text></View>)}
    </View>
    {comment.isStale ? <Text style={styles.stale}>최근 원픽 변화는 다음 AI 평가 때 반영해요.</Text> : null}
    </View>
  </>;
}

const styles = StyleSheet.create({
  sectionHeading: { marginBottom: 10 },
  bridgeCard: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, borderRadius: 12, backgroundColor: OnePick.sunken, paddingHorizontal: 12, paddingVertical: 10, marginTop: 10 },
  bridgeBadge: { color: OnePick.accentDeep, fontSize: 12, lineHeight: 16, fontWeight: '700' },
  bridgeText: { flex: 1, color: OnePick.muted, fontSize: 12, lineHeight: 16 },
  card: { backgroundColor: OnePick.accentSoft, borderRadius: 20, padding: 16, marginBottom: 18 },
  loading: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 12 },
  loadingText: { color: OnePick.muted, fontSize: 13, lineHeight: 18 },
  header: { flexDirection: 'row', alignItems: 'center' },
  avatar: { width: 36, height: 36, borderRadius: 11, backgroundColor: OnePick.accent, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: OnePick.onAccent, fontSize: 13, fontWeight: '900' },
  headerCopy: { flex: 1, marginLeft: 12 },
  nameRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 7 },
  name: { color: OnePick.text, fontSize: 13, lineHeight: 18, fontWeight: '700' },
  badge: { color: OnePick.accentDeep, backgroundColor: OnePick.surface, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3, fontSize: 11, lineHeight: 14, fontWeight: '700' },
  privateBadge: { color: OnePick.muted, backgroundColor: OnePick.surface, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3, fontSize: 11, lineHeight: 14, fontWeight: '700' },
  meta: { color: OnePick.muted, fontSize: 12, lineHeight: 16, marginTop: 2 },
  summary: { color: OnePick.accentDeep, fontSize: 17, lineHeight: 24, fontWeight: '700', letterSpacing: -0.3, marginTop: 14 },
  body: { color: OnePick.text, fontSize: 14, lineHeight: 20, marginTop: 8 },
  keywords: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginTop: 14 },
  keyword: { backgroundColor: OnePick.surface, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6 },
  keywordText: { color: OnePick.accentDeep, fontSize: 12, lineHeight: 16, fontWeight: '600' },
  stale: { color: OnePick.muted, fontSize: 12, lineHeight: 16, marginTop: 12 },
});
