import { StyleSheet, Text, View } from 'react-native';

import { OnePick } from '@/constants/onepick';
import { useFollowCounts } from '@/hooks/useFollow';

/** Own following/follower numbers. Never rendered on someone else's profile. */
export function ProfileFollowCounts({ userId }: { userId: string }) {
  const query = useFollowCounts(userId);
  if (!query.data) return null;
  return (
    <View style={styles.card} accessibilityLabel={`팔로잉 ${query.data.followingCount}명, 팔로워 ${query.data.followerCount}명`}>
      <View style={styles.cell}><Text style={styles.label}>팔로잉</Text><Text style={styles.number}>{query.data.followingCount}명</Text></View>
      <View style={styles.divider} />
      <View style={styles.cell}><Text style={styles.label}>팔로워</Text><Text style={styles.number}>{query.data.followerCount}명</Text></View>
      <Text style={styles.hint}>나에게만 보여요</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { flexDirection: 'row', alignItems: 'center', gap: 14, borderWidth: 1, borderColor: OnePick.border, backgroundColor: OnePick.surface, borderRadius: 16, paddingHorizontal: 16, paddingVertical: 13, marginBottom: 6 },
  cell: { flexDirection: 'row', alignItems: 'baseline', gap: 6 },
  label: { color: OnePick.muted, fontSize: 12, fontWeight: '700' },
  number: { color: OnePick.text, fontSize: 17, fontWeight: '900' },
  divider: { width: 1, height: 16, backgroundColor: OnePick.border },
  hint: { flex: 1, color: OnePick.hint, fontSize: 11, textAlign: 'right' },
});
