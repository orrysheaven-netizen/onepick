import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { PickPhoto } from '@/components/pick-photo';
import { OnePick, OnePickRadius, OnePickType } from '@/constants/onepick';

import { Avatar } from './avatar';

type Props = {
  categoryName: string;
  itemName: string;
  /** The one-line reason. Always rendered in quotes; it is the point of the card. */
  review?: string | null;
  /** Shown in place of a missing review, e.g. "12명이 추천". */
  fallbackText?: string;
  photo: { uri?: string | null; itemId?: string; itemStatus?: string; hasPhoto?: boolean };
  /** Who picked it. Rendered first: the feed reads person → category → item → reason. */
  person?: { username: string; label?: string; onPress?: () => void; accessibilityLabel?: string };
  timeLabel?: string;
  /** Small pill next to the category, e.g. "내 원픽". */
  badge?: string;
  onPress: () => void;
  accessibilityLabel: string;
  /** Action row under the body (Buttons, comment count). */
  footer?: ReactNode;
};

export function PickCard({ categoryName, itemName, review, fallbackText, photo, person, timeLabel, badge, onPress, accessibilityLabel, footer }: Props) {
  return (
    <View style={styles.card}>
      {person ? (
        <View style={styles.personRow}>
          <Avatar name={person.username} size={32} onPress={person.onPress} accessibilityLabel={person.accessibilityLabel} />
          {person.onPress
            ? <Pressable accessibilityRole="button" accessibilityLabel={person.accessibilityLabel ?? `@${person.username} 프로필 보기`} onPress={person.onPress}
                style={({ pressed }) => [styles.personCopy, pressed && styles.pressed]}>
                <Text numberOfLines={1} style={styles.personLabel}>{person.label ?? `@${person.username}`}</Text>
              </Pressable>
            : <View style={styles.personCopy}><Text numberOfLines={1} style={styles.personLabel}>{person.label ?? `@${person.username}`}</Text></View>}
          {timeLabel ? <Text style={styles.time}>{timeLabel}</Text> : null}
        </View>
      ) : null}

      <Pressable accessibilityRole="button" accessibilityLabel={accessibilityLabel} onPress={onPress}
        style={({ pressed }) => [styles.body, pressed && styles.pressed]}>
        <PickPhoto feed uri={photo.uri} label={itemName} itemId={photo.itemId} itemStatus={photo.itemStatus} hasPhoto={photo.hasPhoto} />
        <View style={styles.copy}>
          <View style={styles.categoryRow}>
            <Text numberOfLines={1} style={styles.category}>{categoryName}</Text>
            {badge ? <View style={styles.badge}><Text style={styles.badgeText}>{badge}</Text></View> : null}
          </View>
          <Text style={styles.itemName}>{itemName}</Text>
          {review
            ? <Text numberOfLines={3} style={styles.review}>{`“${review}”`}</Text>
            : fallbackText ? <Text style={styles.fallback}>{fallbackText}</Text> : null}
        </View>
      </Pressable>

      {footer ? <View style={styles.footer}>{footer}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { gap: 12, padding: 16, backgroundColor: OnePick.surface, borderWidth: 1, borderColor: OnePick.border, borderRadius: OnePickRadius.card },
  personRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  personCopy: { flex: 1, minWidth: 0 },
  personLabel: { ...OnePickType.label, color: OnePick.text },
  time: { ...OnePickType.caption, color: OnePick.hint },
  body: { flexDirection: 'row', alignItems: 'flex-start', gap: 14 },
  copy: { flex: 1, minWidth: 0, gap: 4 },
  categoryRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  category: { ...OnePickType.caption, fontWeight: '600', color: OnePick.accentDeep, flexShrink: 1 },
  badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: OnePickRadius.pill, backgroundColor: OnePick.accentSoft },
  badgeText: { fontSize: 11, lineHeight: 14, fontWeight: '700', color: OnePick.accentDeep },
  itemName: { fontSize: 17, lineHeight: 24, fontWeight: '700', letterSpacing: -0.4, color: OnePick.text },
  review: { ...OnePickType.body, color: OnePick.text },
  fallback: { ...OnePickType.label, color: OnePick.muted },
  footer: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  pressed: { opacity: 0.6 },
});
