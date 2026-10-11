import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Avatar } from '@/components/ui';
import { MIN_TOUCH_TARGET, PRESSED_OPACITY } from '@/components/ui/touch';
import { OnePick, OnePickSpace, OnePickType } from '@/constants/onepick';

export type ProfileStat = {
  key: string;
  label: string;
  value: string;
  accessibilityLabel?: string;
  /** Present for 팔로워/팔로잉, which open the follow list. */
  onPress?: () => void;
  disabled?: boolean;
};

/**
 * Shared profile identity block (#757, Figma 40/65): avatar 64 on the left, then the
 * display name, an optional @username handle (only once a nickname exists), and the
 * 원픽 팔로워 팔로잉 stats. The bio runs full width underneath. Used by both the own
 * profile and the public profile so the two stay one layout.
 */
export function ProfileIdentity({ name, handle, bio, bioPlaceholder, stats, avatar, imageUrl }: {
  name: string;
  /** Own profile can supply its editable photo; public profiles use the display avatar. */
  avatar?: ReactNode;
  imageUrl?: string | null;
  handle?: string | null;
  bio?: string | null;
  /** Own profile only: a quiet hint when the bio is empty. */
  bioPlaceholder?: string;
  stats: ProfileStat[];
}) {
  const bioText = bio?.trim();
  return (
    <View style={styles.block}>
      <View style={styles.row}>
        {avatar ?? <Avatar name={name} size={64} tone="subtle" imageUrl={imageUrl} />}
        <View style={styles.copy}>
          <Text accessibilityRole="header" numberOfLines={1} style={styles.name}>{name}</Text>
          {handle ? <Text numberOfLines={1} style={styles.handle}>{handle}</Text> : null}
          <View style={styles.stats}>
            {stats.map((stat) => {
              const content = <Text style={styles.statText}>{stat.label} <Text style={styles.statValue}>{stat.value}</Text></Text>;
              return stat.onPress ? (
                <Pressable key={stat.key} accessibilityRole="button" accessibilityLabel={stat.accessibilityLabel}
                  disabled={stat.disabled} onPress={stat.onPress}
                  style={({ pressed }) => [styles.stat, pressed && !stat.disabled && styles.pressed]}>
                  {content}
                </Pressable>
              ) : <View key={stat.key} accessibilityLabel={stat.accessibilityLabel} style={styles.stat}>{content}</View>;
            })}
          </View>
        </View>
      </View>
      {bioText
        ? <Text numberOfLines={3} style={styles.bio}>{bioText}</Text>
        : bioPlaceholder ? <Text numberOfLines={2} style={styles.bioPlaceholder}>{bioPlaceholder}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  block: { gap: OnePickSpace.md },
  row: { flexDirection: 'row', alignItems: 'center', gap: OnePickSpace.lg },
  copy: { flex: 1, minWidth: 0 },
  name: { ...OnePickType.pageTitle, color: OnePick.textPrimary },
  handle: { ...OnePickType.caption, color: OnePick.textSecondary },
  // Stats keep a 44px touch row; the text itself stays one caption line.
  stats: { minHeight: MIN_TOUCH_TARGET, flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', columnGap: OnePickSpace.md },
  stat: { minHeight: MIN_TOUCH_TARGET, justifyContent: 'center' },
  statText: { ...OnePickType.body, color: OnePick.textSecondary },
  statValue: { ...OnePickType.bodyMedium, color: OnePick.textPrimary },
  bio: { ...OnePickType.body, color: OnePick.textPrimary },
  bioPlaceholder: { ...OnePickType.body, color: OnePick.textSecondary },
  pressed: { opacity: PRESSED_OPACITY },
});
