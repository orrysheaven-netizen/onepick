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
assert.doesNotMatch(row, /<CurrentPickFlag|import \{ CurrentPickFlag/, 'Home Feed v3 intentionally omits the legacy current-Pick flag');
assert.doesNotMatch(row, /PICK_CHANNEL_OPTIONS|channelLabel|<ChannelBadge/, 'Home Feed v3 still omits the offline/online Channel Badge (StoreBadge is a different element)');
// #553 / #762 (2026-10-12): the shared StoreBadge sits before the store name, in the same row.
assert.match(row, /import \{ StoreBadge \} from '@\/components\/store-badge';/, 'Store icon reuses the shared StoreBadge, no new icon');
assert.match(row, /storeBranchName \? <View style=\{styles\.storeRow\}>\s*<StoreBadge decorative=\{Boolean\(onOpenProvider\)\} \/>\s*\{onOpenProvider/, 'StoreBadge renders first in the store row, before the store name');
// #762 L1 (2026-10-12): beside the "… 매장 보기" link the badge is hidden from screen readers; default keeps "매장".
const badgeSrc = src('components/store-badge.tsx');
assert.match(badgeSrc, /export function StoreBadge\(\{ decorative = false \}/, 'StoreBadge stays decorative-off by default for other callers');
assert.match(badgeSrc, /accessible: false, importantForAccessibility: 'no-hide-descendants' as const, accessibilityElementsHidden: true, 'aria-hidden': true/, 'Decorative badge: no focus stop or announcement');
assert.match(badgeSrc, /: \{ accessible: true, accessibilityLabel: '매장' \}/, 'Default badge keeps its "매장" label');
assert.doesNotMatch(badgeSrc, /Pressable|onPress|MIN_TOUCH_TARGET/, 'Badge gains no click or 44px target');
assert.match(row, /storeRow: \{ width: '100%', flexDirection: 'row', alignItems: 'center', gap: OnePickSpace\.sm \}/, 'Store row: badge + name side by side, 8 apart');
// 2026-10-11 (Figma 1212:8609): Home's author row is the shared Avatar 24 (subtle) + nickname, above the photo.
assert.match(row, /authorAbove \? <View style=\{styles\.authorRow\}>[\s\S]*?<Avatar name=\{authorName\} size=\{24\} tone="subtle" imageUrl=\{profileAvatarUrl\(pick\.profileImageUrl\)\} \/>/, 'Author row: shared Avatar 24 subtle (profile photo when set) before the nickname');
assert.match(row, /const authorName = profileDisplayName\(pick\);/, '#804: nickname when set, else username');
assert.match(row, /import \{ MIN_TOUCH_TARGET \} from '@\/components\/ui\/touch';/, 'Interactive Home text uses the shared 44px target contract');
assert.match(row, /storeAction: \{[\s\S]*?minWidth: MIN_TOUCH_TARGET,[\s\S]*?minHeight: MIN_TOUCH_TARGET,[\s\S]*?OnePickFeedType\.storeBranch\.lineHeight/, 'Store/provider action keeps a real 44×44 target without changing visual line height');
assert.match(row, /  profileAction: \{\n[^}]*minWidth: MIN_TOUCH_TARGET,\n[^}]*minHeight: MIN_TOUCH_TARGET,\n[^}]*AUTHOR_ROW_HEIGHT/, 'Author row profile action keeps a real 44×44 target without changing the 24px row');
assert.match(row, /legacyProfileAction: \{\n[^}]*minWidth: MIN_TOUCH_TARGET,\n[^}]*minHeight: MIN_TOUCH_TARGET,\n[^}]*OnePickFeedType\.nickname\.lineHeight/, 'Other screens keep the nickname-only 44×44 action');
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
// 1217:8655 → 1279:9867 (2026-10-12 정돈): no rule between feed cards; one Home-only 28 gap, and
// the same 28 between sections. Not a Foundations token.
assert.doesNotMatch(home, /feedDivider/, 'Home feed cards: the 1px divider between cards is gone');
assert.match(home, /const HOME_SECTION_GAP = 28;/, 'Home-only section/card rhythm 28 (1279:9867)');
assert.match(home, /feedGap: \{ height: HOME_SECTION_GAP \}/, 'Home feed cards: one 28 gap, no border line');
assert.match(home, /ItemSeparatorComponent=\{feedGap\}/, 'The gap is the feed separator');
assert.match(home, /earlyStack: \{ gap: HOME_SECTION_GAP,/, 'Early-MVP sections: 28 between sections');
assert.match(home, /fixedHeader: \{[^}]*paddingHorizontal: OnePickSpace\.gutter/, 'Header\/overlay surface keeps the global 16px gutter');
const fullFeed = src('app/feed.tsx');
assert.match(fullFeed, /content: \{[^}]*paddingHorizontal: OnePickSpace\.gutter/, '/feed keeps the global 16px gutter; Home-only 20px must not leak here');

const header = src('components/home-header.tsx');
// #762 (user decision; supersedes #747): the header has no theme selector button or theme popup.
// Logo and search stay (Figma 1203:8496 / 1212:9543).
assert.doesNotMatch(header, /테마|맛집|themeButton|themeText|themeOption|chevronDown|'theme'/, 'Home header has no theme selector or theme popup');
assert.match(header, /<View style=\{styles\.side\}><OnePickBrand \/><\/View>/, 'Logo (OnePickBrand) stays at the start of the header');
assert.match(header, /accessibilityLabel="메뉴 검색" onPress=\{\(\) => setDialog\('search'\)\}/, 'Search button stays and opens the search popup');
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

console.log('Home Figma parity checks passed: v3 feed card, Home-only gutter, menu tile, sections, no theme selector, logo/search, store badge, popups and icons.');

