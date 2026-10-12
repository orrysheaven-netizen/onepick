import { Pressable, StyleSheet, Text, View } from 'react-native';

import { profileAvatarUrl } from '@/lib/profile/profileAvatar';
import { PickPhoto } from '@/components/pick-photo';
import { StoreBadge } from '@/components/store-badge';
import { Avatar } from '@/components/ui';
import { profileDisplayName } from '@/lib/profile/profileName';
import { MIN_TOUCH_TARGET } from '@/components/ui/touch';
import { OnePick, OnePickFeedType, OnePickRadius, OnePickSpace, OnePickType } from '@/constants/onepick';
import type { HomeFeedPick } from '@/repositories/interfaces/readRepository';

/**
 * One current Pick in the Home feed (Figma Feed Card v3, 993:7228; author row moved above the
 * photo on 2026-10-11, Figma 1203:8496 / 1212:9543): author (avatar + nickname) → photo →
 * store/branch → menu → one-line review. The author row appears once, above the photo only.
 *
 * The read model does not expose branch as a separate field yet, so the current
 * provider/item name stays on the Store Branch role without guessing a split.
 */
export function HomePickRow({ pick, onOpenItem, onOpenProfile, onOpenProvider, onOpenMenu, authorAbove = false }: {
  pick: HomeFeedPick;
  /**
   * Home feed only (2026-10-11): avatar + nickname above the photo. Other screens that share
   * this card (/feed) keep the nickname-only row below the menu until they are decided separately.
   */
  authorAbove?: boolean;
  /** Kept for caller compatibility; v3 no longer draws the legacy current-Pick flag. */
  mine?: boolean;
  onOpenItem: () => void;
  onOpenProfile: () => void;
  /** Store profile; the store/branch line links there when a provider is available. */
  onOpenProvider?: () => void;
  /**
   * Everyone's Picks for this menu. Used only when the menu line shows a real menu
   * (provider-backed rows); otherwise the line keeps opening the Pick's item.
   */
  onOpenMenu?: () => void;
}) {
  const channel = pick.channels?.length === 1 ? pick.channels[0] : undefined;
  // Only provider-backed offline/online rows have a store/provider line. Legacy
  // rows without a channel keep their historical item name as the menu/title;
  // never promote the category name into a fake 20px menu title.
  const hasProviderContext = channel === 'offline' || channel === 'online';
  const storeBranchName = hasProviderContext ? pick.name : undefined;
  const menuName = hasProviderContext ? pick.categoryName : pick.name;
  const contentName = storeBranchName ? `${storeBranchName} ${menuName}` : menuName;
  const openMenu = hasProviderContext ? onOpenMenu : undefined;
  const authorName = profileDisplayName(pick);

  return <View style={styles.card}>
    {/* Shown name follows the #804 rule (nickname, else username); the route keeps the username. */}
    {authorAbove ? <View style={styles.authorRow}>
      <Pressable accessibilityRole="button" accessibilityLabel={`${authorName} 프로필 보기`} onPress={onOpenProfile}
        style={({ pressed }) => [styles.profileAction, pressed && styles.pressed]}>
        <Avatar name={authorName} size={24} tone="subtle" imageUrl={profileAvatarUrl(pick.profileImageUrl)} />
        <Text numberOfLines={1} ellipsizeMode="tail" style={[styles.username, styles.authorName]}>{authorName}</Text>
      </Pressable>
    </View> : null}

    <Pressable accessibilityRole="button" accessibilityLabel={`${pick.name} 상세 보기`} onPress={onOpenItem}
      style={({ pressed }) => [styles.photo, pressed && styles.pressed]}>
      <PickPhoto feedCard uri={pick.thumbnailUrl} label={contentName} itemId={pick.itemId} logoUri={pick.brandLogoUrl} />
    </Pressable>

    <View style={styles.textArea}>
      <View style={styles.itemGroup}>
        {/* Shared StoreBadge before the store name (#553 / #762, 2026-10-12). This is the store
            icon, not the offline/online Channel Badge, which Home Feed v3 still omits. */}
        {storeBranchName ? <View style={styles.storeRow}>
          <StoreBadge />
          {onOpenProvider
            ? <Pressable accessibilityRole="button" accessibilityLabel={`${storeBranchName} 매장 보기`} onPress={onOpenProvider}
                style={({ pressed }) => [styles.storeAction, pressed && styles.pressed]}>
                <Text numberOfLines={1} ellipsizeMode="tail" style={styles.storeBranch}>{storeBranchName}</Text>
              </Pressable>
            : <Text numberOfLines={1} ellipsizeMode="tail" style={[styles.storeBranch, styles.storeText]}>{storeBranchName}</Text>}
        </View> : null}
        <Pressable accessibilityRole="button"
          accessibilityLabel={openMenu ? `${menuName} 원픽 목록 보기` : `${pick.name} 상세 보기`}
          onPress={openMenu ?? onOpenItem}
          style={({ pressed }) => [styles.blockAction, openMenu && styles.menuAction, pressed && styles.pressed]}>
          <Text numberOfLines={2} ellipsizeMode="tail" style={styles.menu}>{menuName}</Text>
        </Pressable>
      </View>

      {!authorAbove || pick.oneLineReview ? <View style={styles.personGroup}>
        {authorAbove ? null : <Pressable accessibilityRole="button" accessibilityLabel={`${authorName} 프로필 보기`} onPress={onOpenProfile}
          style={({ pressed }) => [styles.legacyProfileAction, pressed && styles.pressed]}>
          <Text numberOfLines={1} ellipsizeMode="tail" style={styles.username}>{authorName}</Text>
        </Pressable>}
        {pick.oneLineReview ? <Pressable accessibilityRole="button" accessibilityLabel={`${contentName} 한줄평 상세 보기`} onPress={onOpenItem}
          style={({ pressed }) => [styles.blockAction, pressed && styles.pressed]}>
          <Text numberOfLines={2} ellipsizeMode="tail" style={styles.review}>{quotedReview(pick.oneLineReview)}</Text>
        </Pressable> : null}
      </View> : null}
    </View>
  </View>;
}

/**
 * Display-only (2026-10-12, #762): wrap the one-line review in curly quotes “…” so it reads apart
 * from the store/menu lines. Stored text is untouched; a review the author already wrapped in
 * outer quotes is shown as written so it is not double-wrapped. Inner quotes are left alone.
 */
export function quotedReview(review: string): string {
  const text = review.trim();
  if (!text) return review;
  const wrapped = (text.startsWith('“') && text.endsWith('”')) || (text.length > 1 && text.startsWith('"') && text.endsWith('"'));
  return wrapped ? text : `“${text}”`;
}

const AUTHOR_ROW_HEIGHT = 24;

const styles = StyleSheet.create({
  card: { width: '100%', alignItems: 'stretch' },
  photo: { width: '100%', height: 176, borderRadius: OnePickRadius.lg, overflow: 'hidden' },
  textArea: { width: '100%', paddingTop: OnePickSpace.md, gap: OnePickSpace.md },
  itemGroup: { width: '100%', gap: OnePickSpace.xs },
  personGroup: { width: '100%', gap: OnePickSpace.xs },
  // StoreBadge (28) + store name, 8 apart; the name truncates instead of pushing the badge out.
  storeRow: { width: '100%', flexDirection: 'row', alignItems: 'center', gap: OnePickSpace.sm },
  storeText: { flexShrink: 1, minWidth: 0 },
  // Keep the 21/20px visual rows in place while their actual web/native targets
  // meet the 44px product contract. This follows the shared Avatar/footer pattern.
  storeAction: {
    flexShrink: 1,
    alignSelf: 'center',
    maxWidth: '100%',
    minWidth: MIN_TOUCH_TARGET,
    minHeight: MIN_TOUCH_TARGET,
    marginVertical: -(MIN_TOUCH_TARGET - OnePickFeedType.storeBranch.lineHeight) / 2,
    justifyContent: 'center',
  },
  // 24px visual row (Avatar 24 + nickname, gap 6), 8 above the photo; the 44px target
  // overlaps the row's own margins without moving the layout box.
  authorRow: { width: '100%', height: AUTHOR_ROW_HEIGHT, marginBottom: OnePickSpace.sm, justifyContent: 'center' },
  profileAction: {
    alignSelf: 'flex-start',
    maxWidth: '100%',
    minWidth: MIN_TOUCH_TARGET,
    minHeight: MIN_TOUCH_TARGET,
    marginVertical: -(MIN_TOUCH_TARGET - AUTHOR_ROW_HEIGHT) / 2,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  legacyProfileAction: {
    alignSelf: 'flex-start',
    maxWidth: '100%',
    minWidth: MIN_TOUCH_TARGET,
    minHeight: MIN_TOUCH_TARGET,
    marginVertical: -(MIN_TOUCH_TARGET - OnePickFeedType.nickname.lineHeight) / 2,
    justifyContent: 'center',
  },
  blockAction: { width: '100%' },
  // As a menu link the title row gets a 44px+ target (one or two lines) without moving the
  // visual row: equal padding and negative margin leave the layout box unchanged.
  menuAction: {
    paddingVertical: (MIN_TOUCH_TARGET - OnePickType.title.lineHeight) / 2,
    marginVertical: -(MIN_TOUCH_TARGET - OnePickType.title.lineHeight) / 2,
  },
  storeBranch: { ...OnePickFeedType.storeBranch, color: OnePick.textPrimary },
  menu: { ...OnePickType.title, color: OnePick.textPrimary },
  username: { ...OnePickFeedType.nickname, color: OnePick.textSecondary },
  authorName: { flexShrink: 1 },
  review: { ...OnePickFeedType.review, color: OnePick.textPrimary },
  pressed: { opacity: 0.9 },
});

