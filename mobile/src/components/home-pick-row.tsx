import { Pressable, StyleSheet, Text, View } from 'react-native';

import { CurrentPickFlag } from '@/components/current-pick-flag';
import { PickPhoto } from '@/components/pick-photo';
import { Avatar } from '@/components/ui';
import { OnePick, OnePickRadius, OnePickSpace, OnePickType } from '@/constants/onepick';
import { PICK_CHANNEL_OPTIONS } from '@/lib/items/pickChannel';
import type { HomeFeedPick } from '@/repositories/interfaces/readRepository';

/**
 * One current Pick in the Home / full feed (Figma 30-1, 30-1D):
 * photo | profile + flag, [매장] store (bold) menu, one-line review.
 * No comments/share on Home; the row opens the item and the person opens their profile.
 * Every feed row is a current Pick, so the flag is always shown.
 */
export function HomePickRow({ pick, mine = false, onOpenItem, onOpenProfile, onOpenProvider }: {
  pick: HomeFeedPick;
  /** The viewer's own current Pick (orange flag). */
  mine?: boolean;
  onOpenItem: () => void;
  onOpenProfile: () => void;
  /** Store profile (Figma 17A); the store name links there when the Pick has a provider. */
  onOpenProvider?: () => void;
}) {
  const channel = pick.channels?.length === 1 ? pick.channels[0] : undefined;
  const channelLabel = channel ? PICK_CHANNEL_OPTIONS.find((option) => option.channel === channel)?.label : undefined;
  // Store/online items are named for their provider; the menu is the category.
  const providerName = channel === 'offline' || channel === 'online' ? pick.name : undefined;
  const menuName = channel ? pick.categoryName : pick.name;
  const contentName = providerName ? `${providerName} ${menuName}` : menuName;

  return <View style={styles.row}>
    <Pressable accessibilityRole="button" accessibilityLabel={`${pick.name} 상세 보기`} onPress={onOpenItem}
      style={({ pressed }) => [styles.photo, pressed && styles.pressed]}>
      <PickPhoto feed uri={pick.thumbnailUrl} label={contentName} itemId={pick.itemId} logoUri={pick.brandLogoUrl} />
    </Pressable>
    <View style={styles.copy}>
      <View style={styles.personRow}>
        <Pressable accessibilityRole="button" accessibilityLabel={`@${pick.username} 프로필 보기`} onPress={onOpenProfile}
          style={({ pressed }) => [styles.person, pressed && styles.pressed]}>
          <Avatar name={pick.username} size={24} tone="subtle" imageUrl={pick.profileImageUrl} />
          <Text numberOfLines={1} style={styles.username}>@{pick.username}</Text>
        </Pressable>
        <CurrentPickFlag mine={mine} />
      </View>
      <Pressable accessibilityRole="button" accessibilityLabel={`${contentName} 상세 보기`} onPress={onOpenItem}
        style={({ pressed }) => [styles.body, pressed && styles.pressed]}>
        <View style={styles.titleRow}>
          {channelLabel ? <View style={styles.badge}><Text style={styles.badgeText}>{channelLabel}</Text></View> : null}
          <Text numberOfLines={1} style={styles.title}>
            {providerName ? <Text style={styles.provider} {...(onOpenProvider ? { accessibilityRole: 'link' as const,
              onPress: (event: { stopPropagation?: () => void }) => { event?.stopPropagation?.(); onOpenProvider(); } } : {})}>{providerName} </Text> : null}
            <Text style={providerName ? styles.menu : styles.provider}>{menuName}</Text>
          </Text>
        </View>
        {pick.oneLineReview ? <Text numberOfLines={2} style={styles.review}>{`“${pick.oneLineReview}”`}</Text> : null}
      </Pressable>
    </View>
  </View>;
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: OnePickSpace.md, paddingVertical: 8 },
  photo: { borderRadius: OnePickRadius.md, overflow: 'hidden' },
  copy: { flex: 1, minWidth: 0, gap: 6 },
  personRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: OnePickSpace.sm },
  person: { flexDirection: 'row', alignItems: 'center', gap: OnePickSpace.sm, minWidth: 0, flexShrink: 1, minHeight: 32 },
  username: { ...OnePickType.bodyMedium, color: OnePick.textPrimary, flexShrink: 1 },
  body: { gap: 4 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 6, minWidth: 0 },
  badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: OnePickRadius.sm, backgroundColor: OnePick.bgAccentSubtle },
  badgeText: { ...OnePickType.captionMedium, color: OnePick.accentDeep },
  title: { flex: 1, minWidth: 0, color: OnePick.textPrimary },
  provider: { ...OnePickType.headline, color: OnePick.textPrimary },
  menu: { ...OnePickType.body, fontSize: 16, color: OnePick.textPrimary },
  review: { ...OnePickType.body, color: OnePick.textPrimary },
  pressed: { opacity: 0.9 },
});
