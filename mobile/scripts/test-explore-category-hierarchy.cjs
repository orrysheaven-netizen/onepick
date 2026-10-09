const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const explore = fs.readFileSync(path.join(root, 'src/app/(tabs)/explore.tsx'), 'utf8');
const tree = fs.readFileSync(path.join(root, 'src/lib/categories/categoryTree.ts'), 'utf8');
const profileGroups = fs.readFileSync(path.join(root, 'src/components/profile-pick-groups.tsx'), 'utf8');

assert.doesNotMatch(explore, /categoryLabel/, 'Explore shows leaf names, never the full category path');
assert.match(explore, /useLocalSearchParams<ExploreParams>/);
assert.match(explore, /incomingQuery/);
assert.match(explore, /scalar\(params\.search\) === '1' \|\| incomingQuery\.length > 0/);
assert.match(explore, /initialQuery=\{incomingQuery\}/);
assert.match(explore, /const selectedCategoryLabel = selectedCategory\?\.name \?\? null/);
assert.match(explore, /accessibilityLabel="전체 카테고리 보기"/);
assert.match(explore, /<Chip label="전체" accessibilityLabel="전체 카테고리 보기" selected=\{!parentId\}/, 'top-level filter is a kit Chip that exposes its selected state');
assert.match(explore, /상위 카테고리 보기/);
assert.match(explore, /카테고리 보기/);
assert.match(explore, /label=\{category\.name\}\s*accessibilityLabel=\{`\$\{category\.name\} 카테고리 보기`\}/);
assert.match(explore, /\$\{selectedCategoryLabel\}에서 검색/);
assert.match(explore, /<SectionHeader title=\{showRankingDetail \? `\$\{selectedCategoryLabel\} 원픽 TOP 3` : `\$\{selectedCategoryLabel\}의 원픽`\}/, 'ranking detail and neutral headers use the leaf category name');
assert.match(explore, /OnePickFeatures\.exploreRankingDetail &&\s*topPickCount >= OnePickThresholds\.exploreRankingMinPicks/);
assert.match(explore, /showRankingDetail && item\.rank === 1 && styles\.rankCardFirst/);
assert.match(explore, /하위 카테고리를 고르면 원픽을 볼 수 있어요/);
assert.doesNotMatch(explore, /외부 DB/);
assert.match(explore, /setParentId\(undefined\);\s*setChildId\(undefined\)/);
assert.match(explore, /if \(childId && group && !group\.children\.some/);

assert.doesNotMatch(explore, /1\. 관심 분야를 골라주세요/);
assert.doesNotMatch(explore, /2\. \{group\.category\.name\}에서 골라주세요/);
assert.doesNotMatch(explore, /parentCard:/);
assert.doesNotMatch(explore, /categoryGrid:/);

assert.match(explore, /<Chip key=\{category\.id\} label=\{category\.name\} accessibilityLabel=\{`\$\{category\.name\} 상위 카테고리 보기`\} selected=\{selected\}/);
assert.doesNotMatch(explore, /parentChipActive|chipActive/, 'chip styling belongs to the kit, not the screen');
assert.doesNotMatch(explore, /<ScrollView\s+horizontal[\s\S]*contentContainerStyle=\{styles\.parentRow\}/,
  'Explore must not nest a horizontal ScrollView for top-level category chips on web');
assert.match(explore, /parentRow:\s*\{[^}]*flexDirection: 'row'[^}]*flexWrap: 'wrap'/,
  'Explore top-level category chips should wrap in a normal View so web presses and following content stay reliable');
assert.match(explore, /childTitle/);
assert.match(explore, /selectionLabel/);
assert.match(tree, /export function categoryLabel/);
// Home search renders store + leaf menu names in HomeSearchDialog. Its runtime
// coverage lives in test-home-search-loading.cjs rather than unused Home data.
assert.match(profileGroups, /buildProfileThemeSections/);

console.log('Explore category hierarchy checks passed: taxonomy labels, query-hydrated search, pills, reset behavior, gated ranking detail and profile grouping.');

