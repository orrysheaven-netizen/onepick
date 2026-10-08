import { Pressable, StyleSheet, Text, View } from 'react-native';

import { PickPhoto } from '@/components/pick-photo';
import { ChannelBadge } from '@/components/ui';
import { MIN_TOUCH_TARGET, PRESSED_OPACITY } from '@/components/ui/touch';
import { OnePick, OnePickSpace, OnePickType } from '@/constants/onepick';
import type { PickReadItem } from '@/repositories/interfaces/readRepository';

/** Copy for the owner's photo-review states (L4). No middle dots in user copy. */
export const PROFILE_PHOTO_REVIEW_COPY = {
  pending: '사진 검수 중이에요. 승인되면 다른 사람에게도 보여요.',
  rejected: '사진이 반려됐어요. 상세에서 다시 올려주세요.',
} as const;

/**
 * One current Pick on a profile (#757 My Pick Row, Foundations): the whole row is a
 * single button to the Pick detail — no nested title/provider buttons and no ⋯ menu.
 * Order: [channel badge][category] → store (or item) name → one-line review.
 * One Pick per category, so the category line names what the Pick is for.
 * Row height follows its content; nothing inside is a fixed-height box.
 */
export function ProfileCurrentPickRow({ item, isFood, showPhotoReview = false, onOpenPick }: {
  item: PickReadItem;
  /** Food (main theme) rows show the channel badge and the store name. */
  isFood: boolean;
  /** Owner only: explain a Pick that waits for its photo review. */
  showPhotoReview?: boolean;
  onOpenPick: (pickId: string) => void;
}) {
  const channel = isFood ? (item.pick.channel ?? item.item?.channels?.[0] ?? null) : null;
  const categoryName = item.category?.name ?? null;
  const name = isFood && channel === 'recipe'
    ? item.item?.creatorName ?? item.item?.name ?? categoryName ?? '원픽'
    : item.item?.name ?? categoryName ?? '원픽';
  const imageUri = item.item?.thumbnailUrl ?? item.item?.imageUrl ?? item.item?.imageSourceUrl;
  // L4: a Pick on a published product waits for its first photo's admin review.
  const waitsForPhoto = showPhotoReview && item.pick.status === 'needs_review'
    && (item.item?.status === 'active' || item.item?.status === 'discontinued');
  const photoReviewText = !waitsForPhoto ? null
    : item.item?.photoPendingReview ? PROFILE_PHOTO_REVIEW_COPY.pending : PROFILE_PHOTO_REVIEW_COPY.rejected;
  const label = categoryName && categoryName !== name ? `${categoryName} ${name}` : name;
  // Screen readers get what sighted users see: the visible one-line review and, for the
  // owner, the photo-review status (`notice`), not only the row's title.
  const accessibilityLabel = [`${label} 원픽`, item.pick.oneLineReview ? `한줄평 ${item.pick.oneLineReview}` : null, photoReviewText]
    .filter(Boolean).join('. ');

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint="원픽 상세를 열어요"
      onPress={() => onOpenPick(item.pick.id)}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
      <PickPhoto
        size={64}
        uri={imageUri}
        label={label}
        itemId={item.item?.id}
        itemStatus={item.item?.status}
        hasPhoto={Boolean(item.item?.imagePath)}
      />
      <View style={styles.copy}>
        {channel || categoryName ? <View style={styles.meta}>
          {channel ? <ChannelBadge channel={channel} /> : null}
          {categoryName ? <Text numberOfLines={1} style={styles.category}>{categoryName}</Text> : null}
        </View> : null}
        <Text numberOfLines={1} style={styles.name}>{name}</Text>
        {item.pick.oneLineReview ? <Text numberOfLines={1} style={styles.review}>“{item.pick.oneLineReview}”</Text> : null}
        {photoReviewText ? <Text numberOfLines={2} style={styles.notice}>{photoReviewText}</Text> : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    minHeight: MIN_TOUCH_TARGET,
    flexDirection: 'row',
    alignItems: 'center',
    gap: OnePickSpace.md,
    paddingVertical: OnePickSpace.lg,
    borderBottomWidth: 1,
    borderBottomColor: OnePick.borderDefault,
  },
  copy: { flex: 1, minWidth: 0, gap: OnePickSpace.xs },
  meta: { flexDirection: 'row', alignItems: 'center', gap: OnePickSpace.sm },
  category: { ...OnePickType.captionMedium, flexShrink: 1, color: OnePick.textSecondary },
  name: { ...OnePickType.headline, color: OnePick.textPrimary },
  review: { ...OnePickType.body, color: OnePick.textSecondary },
  notice: { ...OnePickType.caption, color: OnePick.textSecondary },
  pressed: { opacity: PRESSED_OPACITY },
});
