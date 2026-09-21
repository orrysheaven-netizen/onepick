/**
 * The host of a stored purchase link, for display. Cards show where a link
 * goes, never the whole URL: a shop URL is long enough to break the layout,
 * and seeing the destination first is what makes an external link safe to tap.
 *
 * Stored links are already normalized to https by the database, so anything
 * else here is unexpected data rather than user input; it renders nothing
 * instead of guessing.
 */
export function purchaseHost(url: string | null | undefined) {
  const value = url?.trim();
  if (!value) return null;
  const match = /^https:\/\/([^/?#\s]+)/i.exec(value);
  if (!match) return null;
  // Drop a port and a leading www., which carry nothing for the reader.
  return match[1].toLowerCase().replace(/:\d+$/, '').replace(/^www\./, '') || null;
}
