// Home keeps the existing 30E contracts while the feed card follows the approved
// 2026-10-07 Figma v3 (screen 993:7239 / card 993:7228).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = (file) => fs.readFileSync(path.join(__dirname, '../src', file), 'utf8');
const icon = (file) => fs.readFileSync(path.join(__dirname, '../public/icons', file), 'utf8');

const row = src('components/home-pick-row.tsx');
assert.match(row, /<PickPhoto wide /, 'Feed Card v3: full-width 358×176 photo');
assert.match(row, /copy: \{ paddingTop: OnePickSpace\.md \}/, 'Feed Card v3: image → copy gap 12');
assert.match(row, /primaryGroup: \{ gap: OnePickSpace\.xs \}/, 'Feed Card v3: store → menu gap 4');
assert.match(row, /socialGroup: \{ gap: OnePickSpace\.xs, marginTop: OnePickSpace\.md \}/, 'Feed Card v3: menu → person group 12, person → review 4');
assert.match(row, /menu: \{ \.\.\.OnePickType\.title, color: OnePick\.textPrimary \}/, 'Feed Card v3: menu uses Title 20\/28');
assert.match(row, /person: \{ \.\.\.OnePickType\.captionMedium, color: OnePick\.textSecondary \}/, 'Feed Card v3: person remains secondary');
assert.match(row, /review: \{ \.\.\.OnePickType\.body, color: OnePick\.textPrimary \}/, 'Feed Card v3: one-line review is primary body text');
assert.match(row, /channel === 'offline' \? <View[^>]*style=\{styles\.channelBadge\}><StoreBadge \/><\/View>/, 'Feed Card keeps the offline Store Badge contract');
assert.match(row, /flag: \{ position: 'absolute', top: OnePickSpace\.md, right: OnePickSpace\.md \}/, 'Feed Card keeps Current Pick flag overlay');

const photo = src('components/pick-photo.tsx');
assert.match(photo, /wide: \{ width: '100%', aspectRatio: 358 \/ 176, borderRadius: 16 \}/, 'Feed Card v3 photo ratio is 358:176');

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
assert.match(home, /feedGap: \{ height: OnePickSpace\.xxl \}/, 'Feed Card v3: Home card-to-card gap is 24');
const fullFeed = src('app/feed.tsx');
assert.match(fullFeed, /gap: \{ height: OnePickSpace\.xxl \}/, 'Feed Card v3: full feed uses the same 24px card gap');

const header = src('components/home-header.tsx');
assert.match(header, /themeText: \{ \.\.\.OnePickType\.title,/, 'Theme Selector 303:418: Title 20');
assert.match(header, /<Image source=\{chevronIcon\}/, 'Theme Selector: 14px chevron icon, not a ▾ glyph');
assert.doesNotMatch(header, /맛집 ▾/);
assert.match(header, /paddingHorizontal: 20, paddingVertical: 24, borderRadius: OnePickRadius\.lg/, 'Popups 656:3474: padding 20×24, radius 16');
assert.match(header, /inputRow: \{ height: 52,[^}]*backgroundColor: OnePick\.bgSubtle \}/, 'Input 285:261: 52 high, bg/subtle');
assert.match(header, /result: \{ minHeight: 76,/, 'Menu Row 508:2345: 76 high');
assert.match(header, /thumb: \{ width: 56, height: 56, borderRadius: OnePickRadius\.md \}/, 'Menu Row: 56px photo');
assert.match(header, /closeButton: \{ height: 44,/, 'Button / 닫기 656:3479: 44 high');
assert.match(header, /placeholder="예: 라멘"/, 'Search 30-1B input placeholder');
assert.ok(icon('search.svg').includes('M15.5 15.5L20 20'), 'Search icon 656:3466');
assert.ok(icon('chevron-down.svg').includes('M3.5 5.25L7 8.75L10.5 5.25'), 'Chevron 303:420');
assert.ok(icon('clear.svg').includes('M6.2 6.2L11.8 11.8M11.8 6.2L6.2 11.8'), 'Input clear 514:2856');

console.log('Home Figma parity checks passed: v3 feed card rhythm, 24px list gap, store badge/flag contracts, menu tile, sections, theme selector, popups and icons.');
