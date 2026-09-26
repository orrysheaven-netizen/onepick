/**
 * Where a restaurant Pick was bought: 매장 (eat-in, takeout and delivery — delivery is
 * still one store's food) or 온라인 (shipped / online-store sales). Mirrors
 * public.item_channels.channel.
 */
export type PickChannel = 'offline' | 'online';

export const PICK_CHANNEL_OPTIONS: readonly { channel: PickChannel; label: string; description: string }[] = [
  { channel: 'offline', label: '매장', description: '매장에서 먹었거나 배달로 주문했어요' },
  { channel: 'online', label: '온라인', description: '택배·온라인몰로 주문했어요' },
];

/**
 * Where 매장 (place) search has data. The place catalog is loaded region by region
 * (SBIZ 상가정보, docs/place-catalog.md); update this when a new region is loaded.
 */
export const PLACE_COVERAGE_REGIONS: readonly string[] = ['서울'];
export const PLACE_COVERAGE_NOTICE = `매장 등록은 현재 ${PLACE_COVERAGE_REGIONS.join('·')} 음식점만 가능해요.`;

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
