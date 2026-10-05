import { OnePick } from '@/constants/onepick';
import type { PickChannel } from '@/lib/items/pickChannel';

/**
 * 10px channel icon for ChannelBadge (docs/channel-badge.md): 매장 외관 for offline,
 * 장바구니 for online. The viewBox is cropped so the mark matches the label's height.
 * Recipe has no confirmed icon yet, so its badge is text only.
 */
export function ChannelGlyph({ channel }: { channel: PickChannel }) {
  if (channel === 'offline') {
    return <svg width="10" height="10" viewBox="2 3 20 18" fill="none" stroke={OnePick.textPrimary}
      strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 9.5L4.5 4h15L21 9.5z" /><path d="M5 9.5V20h14V9.5" /><path d="M10 20v-5h4v5" />
    </svg>;
  }
  if (channel === 'online') {
    return <svg width="10" height="10" viewBox="1 2 21 21" fill="none" stroke={OnePick.textPrimary}
      strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="9" cy="20" r="1.5" /><circle cx="18" cy="20" r="1.5" /><path d="M2 3h3l2.5 12h11.5l2-8H6.2" />
    </svg>;
  }
  return null;
}
