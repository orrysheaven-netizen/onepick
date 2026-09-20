const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const explore = fs.readFileSync(path.join(root, 'src/app/(tabs)/explore.tsx'), 'utf8');
const tree = fs.readFileSync(path.join(root, 'src/lib/categories/categoryTree.ts'), 'utf8');
const home = fs.readFileSync(path.join(root, 'src/app/(tabs)/index.tsx'), 'utf8');
const profileGroups = fs.readFileSync(path.join(root, 'src/components/profile-pick-groups.tsx'), 'utf8');

assert.match(explore, /browseCategoryGroups, categoryLabel/);
assert.match(explore, /useLocalSearchParams<ExploreParams>/);
assert.match(explore, /incomingQuery/);
assert.match(explore, /scalar\(params\.search\) === '1' \|\| incomingQuery\.length > 0/);
assert.match(explore, /initialQuery=\{incomingQuery\}/);
assert.match(explore, /const selectedCategoryLabel = selectedCategory \? categoryLabel\(selectedCategory, categoryCatalog\) : null/);
assert.match(explore, /accessibilityLabel="전체 카테고리 보기"/);
assert.match(explore, /accessibilityState=\{\{ selected: !parentId \}\}/);
assert.match(explore, /상위 카테고리 보기/);
assert.match(explore, /카테고리 보기/);
assert.match(explore, /\$\{group\.category\.name\} › \$\{category\.name\}/);
assert.match(explore, /\$\{selectedCategoryLabel\}에서 검색/);
assert.match(explore, />\{selectedCategoryLabel\} 원픽 TOP 3</);
assert.match(explore, /setParentId\(undefined\);\s*setChildId\(undefined\)/);
assert.match(explore, /if \(childId && group && !group\.children\.some/);

assert.doesNotMatch(explore, /1\. 관심 분야를 골라주세요/);
assert.doesNotMatch(explore, /2\. \{group\.category\.name\}에서 골라주세요/);
assert.doesNotMatch(explore, /parentCard:/);
assert.doesNotMatch(explore, /categoryGrid:/);

assert.match(explore, /parentChipActive/);
assert.doesNotMatch(explore, /<ScrollView\s+horizontal[\s\S]*contentContainerStyle=\{styles\.parentRow\}/,
  'Explore must not nest a horizontal ScrollView for top-level category chips on web');
assert.match(explore, /parentRow:\s*\{[^}]*flexDirection: 'row'[^}]*flexWrap: 'wrap'/,
  'Explore top-level category chips should wrap in a normal View so web presses and following content stay reliable');
assert.match(explore, /childTitle/);
assert.match(explore, /selectionLabel/);
assert.match(tree, /export function categoryLabel/);
assert.match(home, /categoryLabel\(category, categoryCatalog\)/);
assert.match(profileGroups, /buildProfilePickGroups/);

console.log('Explore category hierarchy checks passed: shared taxonomy labels, query-hydrated search, top-level pills, child selection, reset behavior, and consistent Home/Profile category language.');
