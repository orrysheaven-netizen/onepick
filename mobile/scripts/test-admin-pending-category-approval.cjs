const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const panel = fs.readFileSync(
  path.join(__dirname, '../src/components/admin/data/pending-panel.tsx'),
  'utf8',
);

assert.match(panel, /getCategories/,'Pending review loads current categories');
assert.ok(panel.includes('selectableCategories(categories.map(toDomainCategory))'),'Pending review uses the same full-tree eligibility rules as pick selection');
assert.match(panel, /selected\?\.categories\?\.slug === 'pending-product'/,'The staging category is recognized as unclassified');
assert.match(panel, /status === 'active' && !reviewCategoryId/,'Approval is blocked until a real category is chosen');
assert.match(panel, /updatePendingItem\(selected\.id, status, status === 'active' \? reviewCategoryId : undefined\)/,'The reviewed category is sent to admin_review_pending_item');
assert.match(panel, /const categoryId = reviewCategoryId \|\| \(!isUnclassified \? selected\.category_id : ''\)/,'Duplicate search uses the reviewed category');
assert.match(panel, /disabled=\{processing \|\| !!mergingId \|\| !reviewCategoryId\}/,'Approve button is disabled without a category');

console.log('Admin pending category approval regression passed.');
