import { Pressable, StyleSheet, Text, View } from 'react-native';

import { PickPhoto } from '@/components/pick-photo';
import { OnePick } from '@/constants/onepick';
import type { HomeFeedPick } from '@/repositories/interfaces/readRepository';

/** Person-first card for the home 팔로잉 tab: who, then what, then why. */
export function FollowingPickCard({ pick, mine, onOpenItem, onOpenProfile, onOpenPick }: {
  pick: HomeFeedPick;
  mine?: boolean;
  onOpenItem: () => void;
  onOpenProfile: () => void;
  onOpenPick: () => void;
}) {
  return <View style={styles.card}>
    <Pressable accessibilityRole="button" accessibilityLabel={`@${pick.username} 프로필 보기`} onPress={onOpenProfile}
      style={({ pressed }) => [styles.personRow, pressed && styles.pressed]}>
      <View style={styles.avatar}><Text style={styles.avatarInitial}>{pick.username.slice(0, 1).toUpperCase()}</Text></View>
      <Text numberOfLines={1} style={styles.username}>@{pick.username}</Text>
      <Text numberOfLines={1} style={styles.category}>{pick.categoryName} 원픽</Text>
    </Pressable>
    <Pressable accessibilityRole="button" accessibilityLabel={pick.name + ' 제품 상세 보기'} onPress={onOpenItem}
      style={({ pressed }) => [styles.body, pressed && styles.pressed]}>
      <PickPhoto tall uri={pick.thumbnailUrl} label={pick.name} itemId={pick.itemId} />
      <View style={styles.copy}>
        <View style={styles.nameRow}>
          <Text style={styles.itemName}>{pick.name}</Text>
          {mine ? <View style={styles.badge}><Text style={styles.badgeText}>MY PICK</Text></View> : null}
        </View>
        {pick.oneLineReview ? <>
          <Text style={styles.reasonLabel}>추천 이유</Text>
          <Text numberOfLines={4} style={styles.review}>{`“${pick.oneLineReview}”`}</Text>
        </> : null}
      </View>
    </Pressable>
    <Pressable accessibilityRole="button" accessibilityLabel={`@${pick.username}의 원픽에 의견 나누기`} onPress={onOpenPick}
      style={({ pressed }) => [styles.footer, pressed && styles.pressed]}>
      <Text style={styles.footerText}>의견 나누기</Text><Text style={styles.arrow}>›</Text>
    </Pressable>
  </View>;
}

const styles = StyleSheet.create({
  card: { overflow: 'hidden', backgroundColor: OnePick.surface, borderWidth: 1, borderColor: OnePick.border, borderRadius: 20 },
  personRow: { minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: 9, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 6 },
  avatar: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: OnePick.accentSoft },
  avatarInitial: { color: OnePick.accent, fontSize: 12, fontWeight: '800' },
  username: { flexShrink: 1, color: OnePick.text, fontSize: 13, fontWeight: '800' },
  category: { flex: 1, minWidth: 0, color: OnePick.muted, fontSize: 11, fontWeight: '700', textAlign: 'right' },
  body: { flexDirection: 'row', alignItems: 'flex-start', gap: 14, paddingHorizontal: 16, paddingBottom: 14 },
  copy: { flex: 1, minWidth: 0 },
  nameRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  itemName: { flexShrink: 1, color: OnePick.text, fontSize: 18, lineHeight: 25, fontWeight: '700', letterSpacing: -0.5 },
  badge: { paddingHorizontal: 9, paddingVertical: 6, borderRadius: 6, backgroundColor: OnePick.accentSoft },
  badgeText: { color: OnePick.accent, fontSize: 12, fontWeight: '700' },
  reasonLabel: { color: OnePick.accent, fontSize: 11, fontWeight: '700', marginTop: 7 },
  review: { color: OnePick.text, fontSize: 14, lineHeight: 21, marginTop: 2 },
  footer: { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, borderTopWidth: 1, borderTopColor: OnePick.hairline },
  footerText: { color: OnePick.muted, fontSize: 12, fontWeight: '700' },
  arrow: { color: OnePick.muted, fontSize: 22 },
  pressed: { opacity: 0.65 },
});
