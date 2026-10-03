const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (relative) => fs.readFileSync(path.join(__dirname, '..', relative), 'utf8');

// Home feed / menu detail card footers carry the most-used actions (댓글·공유).
// RN-web ignores hitSlop, so the Pressable itself must be a 44×44 target.
// Web QA on 2026-10-03 measured these at 21×24 (menu detail) and 21×32 (home feed).

const feed = read('src/components/home-feed-card.tsx');
assert.match(feed, /import \{ MIN_TOUCH_TARGET \} from '@\/components\/ui\/touch';/);
assert.match(feed,
  /action: \{ minHeight: MIN_TOUCH_TARGET, minWidth: MIN_TOUCH_TARGET, marginVertical: -\(MIN_TOUCH_TARGET - 32\) \/ 2,/,
  'home feed 댓글/공유 are 44×44 while the visible footer row stays 32');
assert.match(feed, /style=\{\(\{ pressed \}\) => \[styles\.action, pressed && styles\.pressed\]\}>\s*<Text style=\{styles\.actionText\}>댓글<\/Text>/);
assert.match(feed, /style=\{\(\{ pressed \}\) => \[styles\.action, \(pressed \|\| sharing\) && styles\.pressed\]\}>/);

// PickCard spacing that the ±6 negative margin relies on (must not reach the body or card edge).
const pickCard = read('src/components/ui/pick-card.tsx');
assert.match(pickCard, /card: \{ gap: 12, padding: 16,/, 'PickCard gap/padding still leave room for the 6pt overhang');

const menu = read('src/components/menu-detail-pick-card.tsx');
assert.match(menu, /import \{ MIN_TOUCH_TARGET \} from '@\/components\/ui\/touch';/);
assert.match(menu,
  /footerAction: \{ minHeight: MIN_TOUCH_TARGET, minWidth: MIN_TOUCH_TARGET, marginTop: -OnePickSpace\.sm, marginBottom: -OnePickSpace\.md,/,
  'menu detail 댓글/공유 are 44×44 while the visible footer row stays 24');
// The overhang equals the card gap above and padding below, so it never overlaps the item body Pressable.
assert.match(menu, /card: \{[\s\S]*?gap: OnePickSpace\.sm,[\s\S]*?paddingVertical: OnePickSpace\.md,/);
assert.equal((menu.match(/styles\.footerAction/g) || []).length, 2, 'both 댓글 and 공유 use the 44 target');

for (const [name, source] of [['home-feed-card', feed], ['menu-detail-pick-card', menu]]) {
  assert.doesNotMatch(source, /hitSlop/, `${name} relies on real 44 targets, not hitSlop (ignored on web)`);
}

console.log('PASS card footer 댓글/공유 actions keep 44×44 touch targets');
