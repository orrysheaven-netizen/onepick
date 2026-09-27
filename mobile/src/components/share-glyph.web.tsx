import { OnePick } from '@/constants/onepick';

/** Small "share" mark: an arrow leaving a tray. */
export function ShareGlyph() {
  return <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke={OnePick.muted}
    strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 15V3" /><path d="m7 8 5-5 5 5" /><path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7" />
  </svg>;
}
