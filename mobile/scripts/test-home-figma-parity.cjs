// Home must match the Figma 30-1 / 30-1A–D values (10-05 "피그마 기준 적용").
// Each check names the Figma node it comes from, so a drift points back to the design.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = (file) => fs.readFileSync(path.join(__dirname, '../src', file), 'utf8');
const icon = (file) => fs.readFileSync(path.join(__dirname, '../public/icons', file), 'utf8');

const row = src('components/home-pick-row.tsx');
assert.match(row, /<Avatar name=\{pick\.username\} size=\{32\}/, 'Feed Card 303:430: 32px profile image');
assert.match(row, /photo: \{ width: 80, height: 80, borderRadius: OnePickRadius\.md/, 'Feed Card: 80px photo, radius 12');
assert.match(row, /channel === 'offline' \? <StoreBadge \/>/, 'Feed Card: offline Picks use the Store Badge 752:4350');
assert.match(row, /flag: \{ position: 'absolute', top: 16, right: 0 \}/, 'Feed Card: flag at card top 16, right edge');

const badge = src('components/store-badge.tsx');
assert.match(badge, /width: 28, height: 28, borderRadius: 14, borderWidth: 1, borderColor: OnePick\.borderStrong/, 'Store Badge: 28px white circle, 1px border/strong');
assert.ok(icon('store.svg').includes('M0.7 5.25L1.75 1.4H12.25L13.3 5.25H0.7Z'), 'Store Badge: storefront icon (10-05)');

const tile = src('components/recent-item-card.tsx');
assert.match(tile, /copy: \{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingTop: 8/, 'Menu Tile 303:425: text 8 below the photo, 8 between name and count');
assert.match(tile, /name: \{[^}]*fontSize: 12, lineHeight: 24/, 'Menu Tile: store + menu 12');
assert.match(tile, /count: \{[^}]*fontSize: 10, lineHeight: 18/, 'Menu Tile: count 10');

const home = src('app/(tabs)/index.tsx');
assert.match(home, /menuGrid: \{[^}]*rowGap: 14 \}/, 'Menu grid 92:56: 14 between rows');
assert.match(home, /rankingHeader: \{ height: 28,[^}]*marginBottom: OnePickSpace\.md \}/, 'Sort header 405:824: 28 high, 12 above the grid');
assert.match(home, /sectionDivider: \{ height: 1, backgroundColor: '#E5E5EB', marginVertical: 24 \}/, 'Divider 681:4049');
assert.match(home, /feedTitle: \{ \.\.\.OnePickType\.headline, color/, 'Section Header 303:422: Headline 16');
assert.match(home, /moreText: \{ \.\.\.OnePickType\.caption, color: OnePick\.textSecondary \}/, 'Section Header: 더보기 Caption 12');

const header = src('components/home-header.tsx');
assert.match(header, /themeText: \{ \.\.\.OnePickType\.title,/, 'Theme Selector 303:418: Title 20');
assert.match(header, /<Icon name="chevronDown" size="sm"/, 'Theme Selector: shared 16px chevron icon (icon/size/sm), not a ▾ glyph');
assert.doesNotMatch(header, /맛집 ▾/);
assert.match(header, /paddingHorizontal: 20, paddingVertical: 24, borderRadius: OnePickRadius\.lg/, 'Popups 656:3474: padding 20×24, radius 16');
assert.match(header, /inputRow: \{ height: 52,[^}]*backgroundColor: OnePick\.bgSubtle \}/, 'Input 285:261: 52 high, bg/subtle');
assert.match(header, /result: \{ minHeight: 76,/, 'Menu Row 508:2345: 76 high');
assert.match(header, /thumb: \{ width: 56, height: 56, borderRadius: OnePickRadius\.md \}/, 'Menu Row: 56px photo');
assert.match(header, /closeButton: \{ height: 44,/, 'Button / 닫기 656:3479: 44 high');
assert.match(header, /placeholder="예: 라멘"/, 'Search 30-1B input placeholder');
// Icons come from the shared OnePick / Icon set (Foundations): search 24, chevron 16, clear 16.
assert.match(header, /<Icon name="search" color=\{OnePick\.textPrimary\} \/>/, 'Search icon 656:3466 at icon/size/md');
assert.match(header, /<Icon name="clear" size="sm"/, 'Input clear 514:2856 at icon/size/sm');
assert.ok(icon('ui/search.svg').includes('M15.5 15.5 20 20'), 'Search icon 656:3466 geometry');
assert.ok(icon('ui/clear.svg').includes('m8.5 8.5 7 7'), 'Input clear 514:2856 geometry');

console.log('Home Figma parity checks passed: feed card, store badge, flag position, menu tile, sections, theme selector, popups and icons.');
