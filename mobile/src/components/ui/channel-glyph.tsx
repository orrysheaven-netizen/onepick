import type { PickChannel } from '@/lib/items/pickChannel';

/**
 * Native has no SVG renderer in this app, so the badge is text only there; the web
 * build draws the icons (channel-glyph.web.tsx). The label carries the meaning.
 */
export function ChannelGlyph(_props: { channel: PickChannel }) {
  return null;
}
