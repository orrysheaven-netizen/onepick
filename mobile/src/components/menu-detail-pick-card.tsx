import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { PickPhoto } from '@/components/pick-photo';
import { Avatar, Icon } from '@/components/ui';
import { MIN_TOUCH_TARGET } from '@/components/ui/touch';
import { OnePick, OnePickRadius, OnePickSpace, OnePickType } from '@/constants/onepick';
import { PICK_CHANNEL_OPTIONS } from '@/lib/items/pickChannel';
import { sharePick } from '@/lib/share/sharePick';
import type { HomeFeedPick } from '@/repositories/interfaces/readRepository';

export function MenuDetailPickCard({
  pick,
  itemPickCountLabel,
  onOpenItem,
  onOpenProfile,
  onOpenProvider,
  onOpenComments,
}: {
  pick: HomeFeedPick;
  itemPickCountLabel?: string;
  onOpenItem: () => void;
  onOpenProfile: () => void;
  onOpenProvider?: () => void;
  onOpenComments: () => void;
}) {
  const [sharing, setSharing] = useState(false);
  const [shareNotice, setShareNotice] = useState<'copied' | 'error' | null>(null);
  const channel = pick.channels?.length === 1 ? pick.channels[0] : undefined;
  const channelLabel = channel ? PICK_CHANNEL_OPTIONS.find((option) => option.channel === channel)?.label : undefined;
  const providerName = channel === 'offline' || channel === 'online' ? pick.name : undefined;
  const menuName = pick.categoryName || pick.name;
  const contentName = providerName ? `${providerName} ${menuName}` : menuName;

  const handleShare = async () => {
    if (sharing) return;
    setSharing(true);
    setShareNotice(null);
    try {
      const result = await sharePick({
        pickId: pick.pickId,
        username: pick.username,
        categoryName: pick.categoryName,
        itemName: contentName,
        oneLineReview: pick.oneLineReview,
      });
      if (result === 'copied') setShareNotice('copied');
    } catch {
      setShareNotice('error');
    } finally {
      setSharing(false);
    }
  };

  return (
    <View style={styles.card}>
      <View style={styles.personRow}>
        <Avatar name={pick.username} size={32} imageUrl={pick.profileImageUrl} onPress={onOpenProfile} accessibilityLabel={`@${pick.username} 공개 프로필 보기`} />
        <Pressable accessibilityRole="button" accessibilityLabel={`@${pick.username} 공개 프로필 보기`} onPress={onOpenProfile}
          style={({ pressed }) => [styles.personAction, pressed && styles.pressed]}>
          <Text numberOfLines={1} style={styles.personName}>{pick.username}</Text>
        </Pressable>
      </View>

      <Pressable accessibilityRole="button" accessibilityLabel={`${contentName} 상세 보기`} onPress={onOpenItem}
        style={({ pressed }) => [styles.body, pressed && styles.pressed]}>
        <PickPhoto size={64} compactRadius={12} uri={pick.thumbnailUrl} label={contentName} itemId={pick.itemId} logoUri={pick.brandLogoUrl} />
        <View style={styles.copy}>
          <Text numberOfLines={1} style={styles.menuName}>{menuName}</Text>
          <View style={styles.providerRow}>
            {channelLabel ? <View style={styles.channelBadge}><Text style={styles.channelBadgeText}>{channelLabel}</Text></View> : null}
            {providerName ? (pick.providerId && onOpenProvider ? (
              <Pressable accessibilityRole="button" accessibilityLabel={`${providerName} 제공처 프로필 보기`}
                onPress={(event) => { event.stopPropagation(); onOpenProvider(); }}
                style={({ pressed }) => [styles.providerAction, pressed && styles.pressed]}>
                <Text numberOfLines={1} style={styles.providerName}>{providerName}</Text>
                <Icon name="chevronRight" size="sm" color={OnePick.textPrimary} />
              </Pressable>
            ) : <Text numberOfLines={1} style={styles.providerName}>{providerName}</Text>) : null}
          </View>
          <Text numberOfLines={2} style={styles.review}>“{pick.oneLineReview}”</Text>
        </View>
      </Pressable>

      <View style={styles.footer}>
        {itemPickCountLabel ? <Text style={styles.metric}>원픽 {itemPickCountLabel}</Text> : null}
        <Text style={styles.separator}>·</Text>
        <Pressable accessibilityRole="button" accessibilityLabel={`${pick.name} 댓글 보기`} onPress={onOpenComments}
          style={({ pressed }) => [styles.footerAction, pressed && styles.pressed]}>
          <Text style={styles.footerText}>댓글</Text>
        </Pressable>
        <Text style={styles.separator}>·</Text>
        <Pressable accessibilityRole="button" accessibilityLabel={`${pick.name} 공유`} disabled={sharing}
          onPress={() => void handleShare()} style={({ pressed }) => [styles.footerAction, (pressed || sharing) && styles.pressed]}>
          <Text style={styles.footerText}>{sharing ? '공유 중…' : '공유'}</Text>
        </Pressable>
        {shareNotice ? <Text accessibilityLiveRegion="polite" style={shareNotice === 'error' ? styles.error : styles.notice}>
          {shareNotice === 'copied' ? '링크를 복사했어요.' : '공유하지 못했어요. 다시 시도해주세요.'}
        </Text> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    width: '100%',
    gap: OnePickSpace.sm,
    paddingVertical: OnePickSpace.md,
    borderBottomWidth: 1,
    borderBottomColor: OnePick.border,
  },
  personRow: { height: 36, flexDirection: 'row', alignItems: 'center', gap: 10 },
  personAction: { flex: 1, minWidth: 0, minHeight: 36, justifyContent: 'center' },
  personName: { ...OnePickType.bodyMedium, color: OnePick.textPrimary },
  body: { width: '100%', flexDirection: 'row', alignItems: 'center', gap: 10 },
  copy: { flex: 1, minWidth: 0, gap: 3 },
  menuName: { ...OnePickType.headline, color: OnePick.textPrimary },
  providerRow: { minHeight: 28, flexDirection: 'row', alignItems: 'center', gap: 7, minWidth: 0 },
  channelBadge: {
    height: 28,
    justifyContent: 'center',
    paddingHorizontal: 9,
    borderRadius: OnePickRadius.full,
    backgroundColor: OnePick.bgPlaceholder,
  },
  channelBadgeText: { ...OnePickType.captionMedium, color: OnePick.textPrimary },
  providerAction: { minWidth: 0, flexShrink: 1, flexDirection: 'row', alignItems: 'center', gap: 4 },
  providerName: { ...OnePickType.bodyMedium, color: OnePick.textPrimary, flexShrink: 1 },
  review: { ...OnePickType.body, color: OnePick.textPrimary },
  footer: { minHeight: 18, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 5 },
  metric: { ...OnePickType.captionMedium, color: OnePick.muted },
  separator: { ...OnePickType.captionMedium, color: OnePick.muted },
  // 44×44 touch target. The negative margins (card gap above + card padding below = 20)
  // keep the visible footer row at 24pt without overlapping the item body Pressable.
  footerAction: { minHeight: MIN_TOUCH_TARGET, minWidth: MIN_TOUCH_TARGET, marginTop: -OnePickSpace.sm, marginBottom: -OnePickSpace.md, alignItems: 'center', justifyContent: 'center' },
  footerText: { ...OnePickType.captionMedium, color: OnePick.muted },
  notice: { ...OnePickType.caption, color: OnePick.success },
  error: { ...OnePickType.caption, color: OnePick.danger },
  pressed: { opacity: 0.6 },
});
