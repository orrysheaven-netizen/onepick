import type { PickChannel } from '@/repositories/interfaces/readRepository';

/**
 * Home 매장/온라인 tabs. Delivery counts as 매장 (it is one store's food);
 * 온라인 means shipped or online-store sales. Items without a channel (legacy
 * products) only appear under 전체.
 */
export const HOME_CHANNEL_TABS: readonly { channel: PickChannel | null; label: string }[] = [
  { channel: null, label: '전체' },
  { channel: 'offline', label: '매장' },
  { channel: 'online', label: '온라인' },
];

// Content labels (cards, detail, rankings). The tabs and the registration choice keep
// the short 매장/온라인 wording.
const CHANNEL_LABELS: Record<PickChannel, string> = { offline: '오프라인맛집', online: '온라인맛집' };

export function isPickChannel(value: unknown): value is PickChannel {
  return value === 'offline' || value === 'online';
}

/** Card label for an item's channels, in tab order; null when the item has none. */
export function homeChannelLabel(channels: readonly PickChannel[] | null | undefined) {
  const labels = HOME_CHANNEL_TABS
    .filter((tab) => tab.channel && (channels ?? []).includes(tab.channel))
    .map((tab) => CHANNEL_LABELS[tab.channel as PickChannel]);
  return labels.length ? labels.join('·') : null;
}

/** "도가니탕 · 오프라인맛집" for items with a channel; the category name alone otherwise. */
export function categoryWithChannels(categoryName: string, channels: readonly PickChannel[] | null | undefined) {
  const label = homeChannelLabel(channels);
  return label ? `${categoryName} · ${label}` : categoryName;
}
