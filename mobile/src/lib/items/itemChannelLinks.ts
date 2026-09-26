import type { PickChannel } from './pickChannel';

/** Where to find a restaurant item: its store (map page) or its online shop. */
export type ItemChannelLink = { channel: PickChannel; url: string; host: string };

type ItemChannelRow = { channel?: unknown; target_url?: unknown; is_primary?: unknown };

export const ITEM_CHANNEL_LINK_LABELS: Record<PickChannel, string> = {
  offline: '매장 정보 보기',
  online: '온라인몰에서 보기',
};

/** Mirrors item_channels_target_url_shape; anything else is dropped rather than opened. */
export function safeChannelUrl(value: unknown): { url: string; host: string } | null {
  if (typeof value !== 'string') return null;
  const url = value.trim();
  if (!url || url.length > 2048 || !/^https:\/\/[^\s]+$/.test(url)) return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' || !parsed.hostname) return null;
    return { url, host: parsed.hostname.replace(/^www\./, '') };
  } catch {
    return null;
  }
}

/** Primary channel first, then 매장 before 온라인. Channels without a usable URL are hidden. */
export function parseItemChannelLinks(rows: readonly ItemChannelRow[] | null | undefined): ItemChannelLink[] {
  const links: (ItemChannelLink & { primary: boolean })[] = [];
  for (const row of rows ?? []) {
    if (row.channel !== 'offline' && row.channel !== 'online') continue;
    if (links.some((link) => link.channel === row.channel)) continue;
    const safe = safeChannelUrl(row.target_url);
    if (safe) links.push({ channel: row.channel, ...safe, primary: row.is_primary === true });
  }
  return links
    .sort((a, b) => Number(b.primary) - Number(a.primary) || (a.channel === 'offline' ? -1 : 1) - (b.channel === 'offline' ? -1 : 1))
    .map(({ primary: _primary, ...link }) => link);
}
