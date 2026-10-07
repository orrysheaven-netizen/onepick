// Home keeps the existing 30E contracts while the feed card follows the approved
// 2026-10-07 Figma v3 (screen 993:7239 / card 993:7228).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = (file) => fs.readFileSync(path.join(__dirname, '../src', file), 'utf8');
const icon = (file) => fs.readFileSync(path.join(__dirname, '../public/icons', file), 'utf8');

const tokens = src('constants/onepick.ts');
assert.match(tokens, /textSecondary: '#55596A'/, 'Semantic text\/secondary matches the approved 10-07 Figma value');
assert.match(tokens, /gutter: 16,/, 'Global layout\/gutter stays 16');
assert.match(tokens, /homeFeedGutter: 20,/, 'Home Feed gets a dedicated 20px gutter');
assert.match(tokens, /storeBranch: \{ fontFamily: BodyFont, fontSize: 14, lineHeight: 21, fontWeight: '500' \}/);
assert.match(tokens, /nickname: \{ fontFamily: BodyFont, fontSize: 13, lineHeight: 20, fontWeight: '500' \}/);
assert.match(tokens, /review: \{ fontFamily: BodyFont, fontSize: 15, lineHeight: 22, fontWeight: '400' \}/);
assert.match(tokens, /meta: \{ fontFamily: BodyFont, fontSize: 13, lineHeight: 20, fontWeight: '400' \}/);

const row = src('components/home-pick-row.tsx');
assert.doesNotMatch(row, /<Avatar|<CurrentPickFlag|<StoreBadge|import \{ Avatar|import \{ CurrentPickFlag|import \{ StoreBadge/, 'Home Feed v3 intentionally omits legacy avatar, current-Pick flag and channel badge');
assert.match(row, /import \{ MIN_TOUCH_TARGET \} from '@\/components\/ui\/touch';/, 'Interactive Home text uses the shared 44px target contract');
assert.match(row, /storeAction: \{[\s\S]*?minWidth: MIN_TOUCH_TARGET,[\s\S]*?minHeight: MIN_TOUCH_TARGET,[\s\S]*?OnePickFeedType\.storeBranch\.lineHeight/, 'Store/provider action keeps a real 44×44 target without changing visual line height');
assert.match(row, /profileAction: \{[\s\S]*?minWidth: MIN_TOUCH_TARGET,[\s\S]*?minHeight: MIN_TOUCH_TARGET,[\s\S]*?OnePickFeedType\.nickname\.lineHeight/, 'Nickname profile action keeps a real 44×44 target without changing visual line height');
assert.match(row, /hasProviderContext = channel === 'offline' \|\| channel === 'online'/, 'Only provider-backed rows get the store/provider line');
assert.match(row, /menuName = hasProviderContext \? pick\.categoryName : pick\.name/, 'Legacy no-channel rows keep item name as the menu/title');
assert.match(row, /<PickPhoto feedCard/, 'Feed Card v3 uses the full-width photo variant');
assert.match(row, /photo: \{ width: '100%', height: 176, borderRadius: OnePickRadius\.lg/, 'Feed Card v3 photo is full-width × 176, radius 16');
assert.match(row, /textArea: \{ width: '100%', paddingTop: OnePickSpace\.md, gap: OnePickSpace\.md \}/, 'Feed Card v3 text starts 12 below photo and groups are 12 apart');
assert.match(row, /itemGroup: \{ width: '100%', gap: OnePickSpace\.xs \}/, 'Store/menu group uses 4px gap');
assert.match(row, /personGroup: \{ width: '100%', gap: OnePickSpace\.xs \}/, 'Nickname/review group uses 4px gap');
assert.match(row, /numberOfLines=\{1\} ellipsizeMode="tail" style=\{styles\.storeBranch\}/, 'Store/branch is separate from menu and stays one line');
assert.match(row, /numberOfLines=\{2\} ellipsizeMode="tail" style=\{styles\.menu\}/, 'Menu is a separate auto-height Title up to two lines');
assert.match(row, /numberOfLines=\{1\} ellipsizeMode="tail" style=\{styles\.username\}/, 'Nickname stays one line');
assert.match(row, /numberOfLines=\{2\} ellipsizeMode="tail" style=\{styles\.review\}/, 'Review is auto-height up to two lines');
assert.match(row, /storeBranch: \{ \.\.\.OnePickFeedType\.storeBranch, color: OnePick\.textPrimary \}/, 'Feed Card store/branch uses 14\/21 Medium');
assert.match(row, /menu: \{ \.\.\.OnePickType\.title, color: OnePick\.textPrimary \}/, 'Feed Card menu uses Title 20\/28 Bold without mixed inline line-height');
assert.match(row, /username: \{ \.\.\.OnePickFeedType\.nickname, color: OnePick\.textSecondary \}/, 'Feed Card nickname uses 13\/20 Medium + secondary');
assert.match(row, /review: \{ \.\.\.OnePickFeedType\.review, color: OnePick\.textPrimary \}/, 'Feed Card review uses 15\/22 Regular');
const photo = src('components/pick-photo.tsx');
assert.match(photo, /feedCard: \{ width: '100%', height: 176, borderRadius: 16 \}/, 'Shared photo exposes the v3 176px frame');
assert.match(photo, /feedCard[\s\S]*contentFit="cover"/, 'v3 photo uses the Figma cover crop');

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
assert.match(home, /content: \{[^}]*paddingHorizontal: OnePickLayout\.homeFeedGutter/, 'Home feed surface uses the dedicated 20px gutter');
assert.match(home, /feedGap: \{ height: OnePickSpace\.xxl \}/, 'Home feed cards keep the Figma 24px vertical gap');
assert.match(home, /fixedHeader: \{[^}]*paddingHorizontal: OnePickSpace\.gutter/, 'Header\/overlay surface keeps the global 16px gutter');
const fullFeed = src('app/feed.tsx');
assert.match(fullFeed, /content: \{[^}]*paddingHorizontal: OnePickSpace\.gutter/, '/feed keeps the global 16px gutter; Home-only 20px must not leak here');

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

console.log('Home Figma parity checks passed: v3 feed card, Home-only gutter, menu tile, sections, theme selector, popups and icons.');

