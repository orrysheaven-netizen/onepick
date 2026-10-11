import { StyleSheet, Text, View } from 'react-native';

import { OnePick, OnePickRadius, OnePickSpace, OnePickType } from '@/constants/onepick';
import type { PickChannel } from '@/lib/items/pickChannel';

import { ChannelGlyph } from './channel-glyph';

/** Badge copy. 오프라인/온라인 are symmetric on purpose (docs/channel-badge.md). */
export const CHANNEL_BADGE_LABELS: Record<PickChannel, string> = {
  offline: '오프라인',
  online: '온라인',
  recipe: '레시피',
};

/**
 * Figma Foundations `OnePick / Channel Badge` (810:4516, confirmed 2026-10-05).
 * Both channels share one look — white fill, 1px strong border, ink text — and differ
 * only by label and icon (매장 외관 / 장바구니). It is information, not a control:
 * never make it pressable, and keep it off photos (put it first in the meta row).
 */
export function ChannelBadge({ channel }: { channel: PickChannel }) {
  return (
    <View style={styles.badge}>
      <ChannelGlyph channel={channel} />
      <Text numberOfLines={1} style={styles.label}>{CHANNEL_BADGE_LABELS[channel]}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    height: 24,
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    flexShrink: 0,
    gap: OnePickSpace.xs,
    paddingHorizontal: OnePickSpace.sm,
    borderRadius: OnePickRadius.md,
    borderWidth: 1,
    borderColor: OnePick.borderStrong,
    backgroundColor: OnePick.bgDefault,
  },
  label: { ...OnePickType.captionMedium, color: OnePick.textPrimary },
});
