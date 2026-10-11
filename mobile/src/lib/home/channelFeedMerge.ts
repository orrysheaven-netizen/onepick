import type { PickChannel, ReadCursor } from '@/repositories/interfaces/readRepository';

/**
 * Home feed channel scope (#762, 2026-10-10 user decision): one channel, several channels
 * read as one list, or null for every channel. The feed RPCs take a single `p_channel`,
 * and `null` there also returns recipe Picks, so a multi-channel scope is read one channel
 * at a time and merged here instead of widening the server filter.
 */
export type PickChannelScope = PickChannel | readonly PickChannel[] | null;

export interface ChannelFeedRow {
  pickId: string;
  startedAt: string;
}

export interface ChannelFeedPage<T extends ChannelFeedRow> {
  items: T[];
  nextCursor: ReadCursor | null;
}

/** Stable cache-key part: 'offline+online' regardless of the order the scope was written in. */
export function channelScopeKey(scope: PickChannelScope): string | null {
  if (scope === null || typeof scope === 'string') return scope;
  return [...new Set(scope)].sort().join('+');
}

/** Channels to read separately, or [scope] for a single/null scope (one server read). */
export function channelScopeList(scope: PickChannelScope): (PickChannel | null)[] {
  if (scope === null || typeof scope === 'string') return [scope];
  const unique = [...new Set(scope)];
  return unique.length ? unique : [null];
}

/**
 * Microseconds since epoch from a Postgres timestamptz string. Date.parse keeps only
 * milliseconds, which would misorder two Picks started in the same millisecond.
 */
function timestampMicros(value: string): number {
  const match = /^(.*?T\d{2}:\d{2}:\d{2})(?:\.(\d+))?(.*)$/.exec(value);
  if (!match) return Date.parse(value) * 1000;
  const fraction = (match[2] ?? '').padEnd(6, '0').slice(0, 6);
  const wholeSeconds = Date.parse(`${match[1]}${match[3] || 'Z'}`);
  return wholeSeconds * 1000 + Number(fraction);
}

/** Server order: started_at desc, then pick id desc (uuid order = lowercase hex order). */
export function compareFeedOrder(a: ChannelFeedRow, b: ChannelFeedRow) {
  const byTime = timestampMicros(b.startedAt) - timestampMicros(a.startedAt);
  if (byTime !== 0) return byTime;
  const aId = a.pickId.toLowerCase();
  const bId = b.pickId.toLowerCase();
  return aId === bId ? 0 : aId < bId ? 1 : -1;
}

/**
 * Merge one keyset page per channel (all read with the same cursor) into one page.
 *
 * A channel that has more rows only proves order up to its last fetched row, so the merged
 * page stops at the earliest such boundary; rows after it are re-read on the next page.
 * The next cursor is the last emitted row, which every channel accepts. A legacy Pick
 * matched by two channels appears once.
 */
export function mergeChannelPages<T extends ChannelFeedRow>(pages: readonly ChannelFeedPage<T>[], limit = 20): ChannelFeedPage<T> {
  const byId = new Map<string, T>();
  for (const page of pages) {
    for (const item of page.items) if (!byId.has(item.pickId)) byId.set(item.pickId, item);
  }
  const merged = [...byId.values()].sort(compareFeedOrder);

  let end = merged.length;
  for (const page of pages) {
    const last = page.items.at(-1);
    if (!page.nextCursor || !last) continue;
    const boundary = merged.findIndex((item) => item.pickId === last.pickId) + 1;
    if (boundary > 0 && boundary < end) end = boundary;
  }
  end = Math.min(end, limit);

  const items = merged.slice(0, end);
  const hasMore = end < merged.length || pages.some((page) => page.nextCursor !== null);
  const lastItem = items.at(-1);
  return {
    items,
    nextCursor: hasMore && lastItem ? { timestamp: lastItem.startedAt, id: lastItem.pickId } : null,
  };
}

/** Read a feed page for a channel scope: one server call per channel, merged in server order. */
export async function readChannelScopePage<T extends ChannelFeedRow>(
  scope: PickChannelScope,
  read: (channel: PickChannel | null) => Promise<ChannelFeedPage<T>>,
  limit = 20,
): Promise<ChannelFeedPage<T>> {
  const channels = channelScopeList(scope);
  if (channels.length === 1) return read(channels[0]);
  return mergeChannelPages(await Promise.all(channels.map(read)), limit);
}
