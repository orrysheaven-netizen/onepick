import type { PickChannel } from '@/lib/items/pickChannel';

// Kept free of runtime imports: many screens and their tests load this file directly.
const CHANNEL_ORDER: readonly PickChannel[] = ['offline', 'online', 'recipe'];

/**
 * Home 오프라인 맛집/온라인 맛집 tabs. Delivery counts as offline (it is one
 * store's food); online means shipped or online-store sales. Items without a
 * channel (legacy products) only appear under 전체.
 */
export const HOME_CHANNEL_TABS: readonly { channel: PickChannel | null; label: string }[] = [
  { channel: null, label: '전체' },
  { channel: 'offline', label: '오프라인 맛집' },
  { channel: 'online', label: '온라인 맛집' },
];

// Content labels (cards, detail, rankings) match the Home tabs. The registration
// choice keeps the short 매장/온라인 wording with its own descriptions.
const CHANNEL_LABELS: Record<PickChannel, string> = { offline: '오프라인 맛집', online: '온라인 맛집', recipe: '레시피' };

export function isPickChannel(value: unknown): value is PickChannel {
  return value === 'offline' || value === 'online' || value === 'recipe';
}

export function channelLabel(channel: PickChannel) {
  return CHANNEL_LABELS[channel];
}

/** Card label for channels in a fixed order (오프라인, 온라인, 레시피); null when there are none. */
export function homeChannelLabel(channels: readonly PickChannel[] | null | undefined) {
  const labels = CHANNEL_ORDER
    .filter((channel) => (channels ?? []).includes(channel))
    .map((channel) => CHANNEL_LABELS[channel]);
  return labels.length ? labels.join('·') : null;
}

/** "도가니탕 · 오프라인 맛집" for items with a channel; the category name alone otherwise. */
export function categoryWithChannels(categoryName: string, channels: readonly PickChannel[] | null | undefined) {
  const label = homeChannelLabel(channels);
  return label ? `${categoryName} · ${label}` : categoryName;
}
