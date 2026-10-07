import { Pressable, StyleSheet, Text, View } from 'react-native';

import { CurrentPickFlag } from '@/components/current-pick-flag';
import { PickPhoto } from '@/components/pick-photo';
import { StoreBadge } from '@/components/store-badge';
import { OnePick, OnePickRadius, OnePickSpace, OnePickType } from '@/constants/onepick';
import { PICK_CHANNEL_OPTIONS } from '@/lib/items/pickChannel';
import type { HomeFeedPick } from '@/repositories/interfaces/readRepository';

/**
 * One current Pick in Home / full feed.
 * Approved information order (Figma v3, 2026-10-07):
 * photo → store/branch → menu → person → one-line review.
 * Channel badge and Current Pick flag remain as existing product contracts.
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
  // Store items are named for their provider (including branch display when present);
  // the category is the menu. #804 will replace username with the public nickname data source.
  const providerName = channel === 'offline' || channel === 'online' ? pick.name : undefined;
  const menuName = channel ? pick.categoryName : pick.name;
  const contentName = providerName ? `${providerName} ${menuName}` : menuName;
  const personLabel = pick.username;

  return <View style={styles.card}>
    <Pressable accessibilityRole="button" accessibilityLabel={`${contentName} 상세 보기`} onPress={onOpenItem}
      style={({ pressed }) => [styles.photo, pressed && styles.pressed]}>
      <PickPhoto wide uri={pick.thumbnailUrl} label={contentName} itemId={pick.itemId} logoUri={pick.brandLogoUrl} />
      <View pointerEvents="none" style={styles.flag}><CurrentPickFlag mine={mine} /></View>
      {channel === 'offline' ? <View pointerEvents="none" style={styles.channelBadge}><StoreBadge /></View>
        : channelLabel ? <View pointerEvents="none" style={[styles.channelBadge, styles.textBadge]}>
            <Text style={styles.badgeText}>{channelLabel}</Text>
          </View> : null}
    </Pressable>

    <View style={styles.copy}>
      <View style={styles.primaryGroup}>
        {providerName ? <Pressable accessibilityRole={onOpenProvider ? 'link' : 'button'}
          accessibilityLabel={onOpenProvider ? `${providerName} 매장 보기` : `${providerName} 상세 보기`}
          onPress={onOpenProvider ?? onOpenItem}
          style={({ pressed }) => [styles.inlinePressable, pressed && styles.pressed]}>
          <Text numberOfLines={1} style={styles.provider}>{providerName}</Text>
        </Pressable> : null}
        <Pressable accessibilityRole="button" accessibilityLabel={`${menuName} 상세 보기`} onPress={onOpenItem}
          style={({ pressed }) => [styles.inlinePressable, pressed && styles.pressed]}>
          <Text numberOfLines={2} style={styles.menu}>{menuName}</Text>
        </Pressable>
      </View>

      <View style={styles.socialGroup}>
        <Pressable accessibilityRole="button" accessibilityLabel={`${personLabel} 프로필 보기`} onPress={onOpenProfile}
          style={({ pressed }) => [styles.inlinePressable, pressed && styles.pressed]}>
          <Text numberOfLines={1} style={styles.person}>{personLabel}</Text>
        </Pressable>
        {pick.oneLineReview ? <Text numberOfLines={2} style={styles.review}>{pick.oneLineReview}</Text> : null}
      </View>
    </View>
  </View>;
}

const styles = StyleSheet.create({
  card: { position: 'relative' },
  photo: { position: 'relative', width: '100%', borderRadius: OnePickRadius.lg, overflow: 'hidden' },
  flag: { position: 'absolute', top: OnePickSpace.md, right: OnePickSpace.md },
  channelBadge: { position: 'absolute', left: OnePickSpace.md, bottom: OnePickSpace.md },
  textBadge: {
    minHeight: 28,
    paddingHorizontal: OnePickSpace.sm,
    borderRadius: OnePickRadius.full,
    backgroundColor: OnePick.bgDefault,
    borderWidth: 1,
    borderColor: OnePick.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { ...OnePickType.captionMedium, color: OnePick.textSecondary },
  copy: { paddingTop: OnePickSpace.md },
  primaryGroup: { gap: OnePickSpace.xs },
  socialGroup: { gap: OnePickSpace.xs, marginTop: OnePickSpace.md },
  inlinePressable: { alignSelf: 'flex-start', maxWidth: '100%' },
  provider: { ...OnePickType.bodyMedium, color: OnePick.textPrimary },
  menu: { ...OnePickType.title, color: OnePick.textPrimary },
  person: { ...OnePickType.captionMedium, color: OnePick.textSecondary },
  review: { ...OnePickType.body, color: OnePick.textPrimary },
  pressed: { opacity: 0.9 },
});
