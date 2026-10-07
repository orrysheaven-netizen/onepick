import { Pressable, StyleSheet, Text, View } from 'react-native';

import { PickPhoto } from '@/components/pick-photo';
import { OnePick, OnePickFeedType, OnePickRadius, OnePickSpace, OnePickType } from '@/constants/onepick';
import type { HomeFeedPick } from '@/repositories/interfaces/readRepository';

/**
 * One current Pick in the Home feed (Figma Feed Card v3, 993:7228):
 * photo → store/branch → menu → nickname → one-line review.
 *
 * The read model does not expose branch as a separate field yet, so the current
 * provider/item name stays on the Store Branch role without guessing a split.
 */
export function HomePickRow({ pick, onOpenItem, onOpenProfile, onOpenProvider }: {
  pick: HomeFeedPick;
  /** Kept for caller compatibility; v3 no longer draws the legacy current-Pick flag. */
  mine?: boolean;
  onOpenItem: () => void;
  onOpenProfile: () => void;
  /** Store profile; the store/branch line links there when a provider is available. */
  onOpenProvider?: () => void;
}) {
  const channel = pick.channels?.length === 1 ? pick.channels[0] : undefined;
  // Home is offline-first. Legacy rows may have no channel, so keep their item
  // name as provider context rather than inventing a branch or dropping the line.
  const storeBranchName = channel === 'recipe' ? undefined : pick.name;
  const menuName = pick.categoryName || pick.name;
  const contentName = storeBranchName ? `${storeBranchName} ${menuName}` : menuName;

  return <View style={styles.card}>
    <Pressable accessibilityRole="button" accessibilityLabel={`${pick.name} 상세 보기`} onPress={onOpenItem}
      style={({ pressed }) => [styles.photo, pressed && styles.pressed]}>
      <PickPhoto feedCard uri={pick.thumbnailUrl} label={contentName} itemId={pick.itemId} logoUri={pick.brandLogoUrl} />
    </Pressable>

    <View style={styles.textArea}>
      <View style={styles.itemGroup}>
        {storeBranchName
          ? onOpenProvider
            ? <Pressable accessibilityRole="button" accessibilityLabel={`${storeBranchName} 매장 보기`} onPress={onOpenProvider}
                style={({ pressed }) => [styles.inlineAction, pressed && styles.pressed]}>
                <Text numberOfLines={1} ellipsizeMode="tail" style={styles.storeBranch}>{storeBranchName}</Text>
              </Pressable>
            : <Text numberOfLines={1} ellipsizeMode="tail" style={styles.storeBranch}>{storeBranchName}</Text>
          : null}
        <Pressable accessibilityRole="button" accessibilityLabel={`${pick.name} 상세 보기`} onPress={onOpenItem}
          style={({ pressed }) => [styles.blockAction, pressed && styles.pressed]}>
          <Text numberOfLines={2} ellipsizeMode="tail" style={styles.menu}>{menuName}</Text>
        </Pressable>
      </View>

      <View style={styles.personGroup}>
        <Pressable accessibilityRole="button" accessibilityLabel={`${pick.username} 프로필 보기`} onPress={onOpenProfile}
          style={({ pressed }) => [styles.inlineAction, pressed && styles.pressed]}>
          <Text numberOfLines={1} ellipsizeMode="tail" style={styles.username}>{pick.username}</Text>
        </Pressable>
        {pick.oneLineReview ? <Pressable accessibilityRole="button" accessibilityLabel={`${contentName} 한줄평 상세 보기`} onPress={onOpenItem}
          style={({ pressed }) => [styles.blockAction, pressed && styles.pressed]}>
          <Text numberOfLines={2} ellipsizeMode="tail" style={styles.review}>{pick.oneLineReview}</Text>
        </Pressable> : null}
      </View>
    </View>
  </View>;
}

const styles = StyleSheet.create({
  card: { width: '100%', alignItems: 'stretch' },
  photo: { width: '100%', height: 176, borderRadius: OnePickRadius.lg, overflow: 'hidden' },
  textArea: { width: '100%', paddingTop: OnePickSpace.md, gap: OnePickSpace.md },
  itemGroup: { width: '100%', gap: OnePickSpace.xs },
  personGroup: { width: '100%', gap: OnePickSpace.xs },
  inlineAction: { alignSelf: 'flex-start', maxWidth: '100%' },
  blockAction: { width: '100%' },
  storeBranch: { ...OnePickFeedType.storeBranch, color: OnePick.textPrimary },
  menu: { ...OnePickType.title, color: OnePick.textPrimary },
  username: { ...OnePickFeedType.nickname, color: OnePick.textSecondary },
  review: { ...OnePickFeedType.review, color: OnePick.textPrimary },
  pressed: { opacity: 0.9 },
});
