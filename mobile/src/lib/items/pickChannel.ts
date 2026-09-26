/**
 * How a food Pick was had: 매장 (eat-in, takeout and delivery — delivery is still one
 * store's food), 온라인 (shipped / online-store sales) or 레시피 (cooked from a video).
 * A member holds one current Pick per menu and channel. Mirrors picks.channel and
 * item_channels.channel; Picks outside food carry no channel.
 */
export type PickChannel = 'offline' | 'online' | 'recipe';

export const PICK_CHANNELS: readonly PickChannel[] = ['offline', 'online', 'recipe'];

export function isPickChannel(value: unknown): value is PickChannel {
  return value === 'offline' || value === 'online' || value === 'recipe';
}

/** A route or server value that names a channel, or undefined. */
export function parseChannelParam(value: unknown): PickChannel | undefined {
  return isPickChannel(value) ? value : undefined;
}

export const PICK_CHANNEL_OPTIONS: readonly { channel: PickChannel; label: string; description: string }[] = [
  { channel: 'offline', label: '매장', description: '매장에서 먹었거나 배달로 주문했어요' },
  { channel: 'online', label: '온라인', description: '택배·온라인몰로 주문했어요' },
];

/** Route params are untrusted; anything but 'online' means the default 매장 flow. */
export function parsePickChannel(value: unknown): PickChannel {
  return value === 'online' ? 'online' : 'offline';
}

// Delivery apps sell a store's food, so their links belong to the 매장 flow.
// Keep in sync with public.online_stores_not_delivery_app.
export const DELIVERY_APP_HOSTS: readonly string[] = ['baemin.com', 'coupangeats.com', 'yogiyo.co.kr', 'ddangyo.com'];

export function isDeliveryAppUrl(url: string) {
  let host: string;
  try {
    host = new URL(url.trim()).hostname.toLowerCase().replace(/\.$/, '');
  } catch {
    return false;
  }
  return DELIVERY_APP_HOSTS.some((delivery) => host === delivery || host.endsWith(`.${delivery}`));
}
