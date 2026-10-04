import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { PickPhoto } from '@/components/pick-photo';
import { Avatar } from '@/components/ui';
import { MIN_TOUCH_TARGET } from '@/components/ui/touch';
import { OnePick, OnePickRadius, OnePickSpace, OnePickType } from '@/constants/onepick';
import { PICK_CHANNEL_OPTIONS } from '@/lib/items/pickChannel';
import { sharePick } from '@/lib/share/sharePick';
import type { HomeFeedPick } from '@/repositories/interfaces/readRepository';

export function MenuDetailPickCard({
  pick,
  itemPickCountLabel,
  region,
  commentCount,
  onOpenItem,
  onOpenProfile,
  onOpenProvider,
  onOpenComments,
}: {
  pick: HomeFeedPick;
  itemPickCountLabel?: string;
  region?: string | null;
  commentCount?: number;
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
      {/* Figma 45: photo left; @아이디 / [매장] 매장명 / 지역 › / 한줄평. The menu name is the page title, so it is not repeated. */}
      <View style={styles.body}>
        <Pressable accessibilityRole="button" accessibilityLabel={`${contentName} 상세 보기`} onPress={onOpenItem}
          style={({ pressed }) => pressed && styles.pressed}>
          <PickPhoto size={64} compactRadius={12} uri={pick.thumbnailUrl} label={contentName} itemId={pick.itemId} logoUri={pick.brandLogoUrl} />
        </Pressable>
        <View style={styles.copy}>
          <View style={styles.personRow}>
            <Avatar name={pick.username} size={24} tone="subtle" onPress={onOpenProfile} accessibilityLabel={`@${pick.username} 공개 프로필 보기`} />
            <Pressable accessibilityRole="button" accessibilityLabel={`@${pick.username} 공개 프로필 보기`} onPress={onOpenProfile}
              style={({ pressed }) => [styles.personAction, pressed && styles.pressed]}>
              <Text numberOfLines={1} style={styles.personName}>@{pick.username}</Text>
            </Pressable>
          </View>
          <Pressable accessibilityRole="button" accessibilityLabel={`${contentName} 상세 보기`} onPress={onOpenItem}
            style={({ pressed }) => [styles.titleRow, pressed && styles.pressed]}>
            {channelLabel ? <View style={styles.channelBadge}><Text style={styles.channelBadgeText}>{channelLabel}</Text></View> : null}
            <Text numberOfLines={1} style={styles.menuName}>{providerName ?? menuName}</Text>
          </Pressable>
          {region ? (pick.providerId && onOpenProvider ? (
            <Pressable accessibilityRole="button" accessibilityLabel={`${providerName ?? menuName} 매장 프로필 보기`} onPress={onOpenProvider}
              style={({ pressed }) => [styles.providerAction, pressed && styles.pressed]}>
              <Text numberOfLines={1} style={styles.region}>{region} ›</Text>
            </Pressable>
          ) : <Text numberOfLines={1} style={styles.region}>{region}</Text>) : null}
          <Pressable accessibilityRole="button" accessibilityLabel={`${contentName} 상세 보기`} onPress={onOpenItem}
            style={({ pressed }) => pressed && styles.pressed}>
            <Text numberOfLines={2} style={styles.review}>“{pick.oneLineReview}”</Text>
          </Pressable>
        </View>
      </View>

      <View style={styles.footer}>
        {itemPickCountLabel ? <Text style={styles.metric}>원픽 {itemPickCountLabel}</Text> : null}
        <Pressable accessibilityRole="button" accessibilityLabel={`${pick.name} 댓글 보기`} onPress={onOpenComments}
          style={({ pressed }) => [styles.footerAction, pressed && styles.pressed]}>
          <Text style={styles.footerText}>{commentCount ? `댓글 ${commentCount}` : '댓글'}</Text>
        </Pressable>
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
  personRow: { minHeight: 32, flexDirection: 'row', alignItems: 'center', gap: OnePickSpace.sm },
  personAction: { flex: 1, minWidth: 0, minHeight: 32, justifyContent: 'center' },
  personName: { ...OnePickType.caption, color: OnePick.textPrimary },
  body: { width: '100%', flexDirection: 'row', alignItems: 'flex-start', gap: OnePickSpace.md },
  titleRow: { minHeight: 28, flexDirection: 'row', alignItems: 'center', gap: 7, minWidth: 0 },
  region: { ...OnePickType.caption, color: OnePick.textSecondary },
  copy: { flex: 1, minWidth: 0, gap: 3 },
  menuName: { ...OnePickType.headline, color: OnePick.textPrimary },
  channelBadge: {
    height: 28,
    justifyContent: 'center',
    paddingHorizontal: 9,
    borderRadius: OnePickRadius.full,
    backgroundColor: OnePick.bgPlaceholder,
  },
  channelBadgeText: { ...OnePickType.captionMedium, color: OnePick.textPrimary },
  providerAction: { minWidth: 0, flexShrink: 1, flexDirection: 'row', alignItems: 'center', gap: 4 },
  review: { ...OnePickType.body, color: OnePick.textPrimary },
  footer: { minHeight: 18, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: OnePickSpace.md },
  metric: { ...OnePickType.captionMedium, color: OnePick.muted },
  // 44×44 touch target. The negative margins (card gap above + card padding below = 20)
  // keep the visible footer row at 24pt without overlapping the item body Pressable.
  footerAction: { minHeight: MIN_TOUCH_TARGET, minWidth: MIN_TOUCH_TARGET, marginTop: -OnePickSpace.sm, marginBottom: -OnePickSpace.md, alignItems: 'center', justifyContent: 'center' },
  footerText: { ...OnePickType.captionMedium, color: OnePick.muted },
  notice: { ...OnePickType.caption, color: OnePick.success },
  error: { ...OnePickType.caption, color: OnePick.danger },
  pressed: { opacity: 0.6 },
});
