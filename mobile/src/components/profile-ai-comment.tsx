import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { useProfileAiComment } from '@/hooks/useProfileAi';

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
      <Text style={styles.sectionTitle}>{sectionTitle}</Text>
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
    {comment.isStale ? <Text style={styles.stale}>최근 원픽 변화는 다음 AI 평가 때 반영됩니다.</Text> : null}
    </View>
  </>;
}

const styles = StyleSheet.create({
  sectionHeading: { marginBottom: 10 },
  sectionTitle: { color: '#202124', fontSize: 19, fontWeight: '900' },
  bridgeCard: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, borderRadius: 14, backgroundColor: '#F1F2F6', paddingHorizontal: 11, paddingVertical: 9, marginTop: 9 },
  bridgeBadge: { color: '#4945ED', fontSize: 10, fontWeight: '900', paddingTop: 1 },
  bridgeText: { flex: 1, color: '#5F6470', fontSize: 11, lineHeight: 16 },
  card: { borderWidth: 1, borderColor: '#DDDDF7', backgroundColor: '#FAFAFF', borderRadius: 18, padding: 16, marginBottom: 18 },
  loading: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 12 },
  loadingText: { color: '#747985', fontSize: 12 },
  header: { flexDirection: 'row', alignItems: 'center' },
  avatar: { width: 42, height: 42, borderRadius: 14, backgroundColor: '#4945ED', alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: '#FFFFFF', fontSize: 13, fontWeight: '900' },
  headerCopy: { flex: 1, marginLeft: 12 },
  nameRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 7 },
  name: { color: '#202124', fontSize: 14, fontWeight: '900' },
  badge: { color: '#4945ED', backgroundColor: '#EFEEFF', borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3, fontSize: 10, fontWeight: '800' },
  privateBadge: { color: '#747985', backgroundColor: '#ECEEF3', borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3, fontSize: 10, fontWeight: '800' },
  meta: { color: '#747985', fontSize: 11, marginTop: 3 },
  summary: { color: '#202124', fontSize: 16, lineHeight: 23, fontWeight: '900', marginTop: 16 },
  body: { color: '#5F6470', fontSize: 13, lineHeight: 21, marginTop: 9 },
  keywords: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginTop: 14 },
  keyword: { backgroundColor: '#FFFFFF', borderRadius: 999, borderWidth: 1, borderColor: '#E3E5EA', paddingHorizontal: 10, paddingVertical: 6 },
  keywordText: { color: '#4945ED', fontSize: 11, fontWeight: '800' },
  stale: { color: '#747985', fontSize: 11, lineHeight: 17, marginTop: 12 },
});
