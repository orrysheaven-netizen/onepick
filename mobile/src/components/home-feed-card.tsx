import { useState } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';

import { PickCard } from '@/components/ui';
import { OnePick, OnePickType } from '@/constants/onepick';
import { PICK_CHANNEL_OPTIONS } from '@/lib/items/pickChannel';
import { sharePick } from '@/lib/share/sharePick';
import type { HomeFeedPick } from '@/repositories/interfaces/readRepository';

/**
 * One person's current Pick on Home (docs/people-first-home.md):
 * person → current-Pick state → channel/provider → menu → one-line reason.
 *
 * Home deliberately has no like button and no "나도 이게 원픽" CTA. The card
 * opens the item, 댓글 focuses this person's Pick thread, and 공유 reuses the
 * existing Pick deep link.
 */
export function HomeFeedCard({ pick, mine, menuContext = false, onOpenItem, onOpenProfile, onOpenComments, onOpenProvider }: {
  pick: HomeFeedPick;
  /** The viewer already has this exact item as a current Pick. */
  mine?: boolean;
  /** The surrounding screen already names the menu; use D hierarchy for the provider. */
  menuContext?: boolean;
  onOpenItem: () => void;
  onOpenProfile: () => void;
  onOpenComments: () => void;
  onOpenProvider?: () => void;
}) {
  const [sharing, setSharing] = useState(false);
  const [shareNotice, setShareNotice] = useState<'copied' | 'error' | null>(null);
  const channel = pick.channels?.length === 1 ? pick.channels[0] : undefined;
  const channelLabel = channel ? PICK_CHANNEL_OPTIONS.find((option) => option.channel === channel)?.label : undefined;

  // Store/online provider items are named for their provider. Recipe videos need
  // creator_name in the feed read model before we can show a source name without
  // guessing, so recipe keeps only the channel badge until that data contract lands.
  const providerName = channel === 'offline' || channel === 'online'
    ? pick.name
    : channel ? undefined : pick.categoryName;
  const menuName = channel ? pick.categoryName : pick.name;
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

  return <PickCard
    channelLabel={channelLabel}
    providerName={providerName}
    itemName={menuName}
    menuContext={menuContext}
    review={pick.oneLineReview}
    photo={{ uri: pick.thumbnailUrl, itemId: pick.itemId, logoUri: pick.brandLogoUrl, label: contentName }}
    person={{ username: pick.username, onPress: onOpenProfile }}
    onPress={onOpenItem}
    onPressProvider={pick.providerId ? onOpenProvider : undefined}
    accessibilityLabel={pick.name + ' 상세 보기'}
    footer={<>
      {mine ? <Text style={styles.mine}>✓ 내 원픽</Text> : null}
      <Pressable accessibilityRole="button" accessibilityLabel={`${pick.name} 댓글 보기`}
        onPress={onOpenComments} style={({ pressed }) => [styles.action, pressed && styles.pressed]}>
        <Text style={styles.actionText}>댓글</Text>
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel={`${pick.name} 공유`} disabled={sharing}
        onPress={() => void handleShare()} style={({ pressed }) => [styles.action, (pressed || sharing) && styles.pressed]}>
        <Text style={styles.actionText}>{sharing ? '공유 중…' : '공유'}</Text>
      </Pressable>
      {shareNotice ? <Text accessibilityLiveRegion="polite" style={shareNotice === 'error' ? styles.error : styles.notice}>
        {shareNotice === 'copied' ? '링크를 복사했어요.' : '공유하지 못했어요. 다시 시도해주세요.'}
      </Text> : null}
    </>} />;
}

const styles = StyleSheet.create({
  mine: { ...OnePickType.caption, fontWeight: '600', color: OnePick.text },
  action: { minHeight: 32, justifyContent: 'center' },
  actionText: { ...OnePickType.caption, fontWeight: '600', color: OnePick.muted },
  notice: { ...OnePickType.caption, color: OnePick.success },
  error: { ...OnePickType.caption, color: OnePick.danger },
  pressed: { opacity: 0.55 },
});
