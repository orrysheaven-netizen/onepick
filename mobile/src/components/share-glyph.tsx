import { Text } from 'react-native';
import { OnePick } from '@/constants/onepick';

/** Small "share" mark; the web build draws it as an SVG (share-glyph.web.tsx). */
export function ShareGlyph() {
  return <Text style={{ color: OnePick.muted, fontSize: 16, fontWeight: '700' }}>⇪</Text>;
}
