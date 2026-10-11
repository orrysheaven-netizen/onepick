const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

const constants = require('./design-tokens.cjs');
assert.equal(constants.OnePickMvp.publicPickChannel, 'offline');
assert.equal(constants.OnePickFeatures.foodChannelPicker, false);

const pickRoute = read('src/app/pick/[pickId].tsx');
assert.match(pickRoute, /hiddenFutureChannel = needsPickLookup && Boolean\(/);
assert.match(pickRoute, /!OnePickFeatures\.foodChannelPicker/);
assert.match(pickRoute, /pickQuery\.data\.pick\.channel !== OnePickMvp\.publicPickChannel/);
assert.match(pickRoute, /: hiddenFutureChannel \? <View style=\{styles\.state\}>/);
assert.match(pickRoute, /지금은 매장에서 고른 음식 원픽만 공개하고 있어요/);
assert.match(pickRoute, /hiddenPhotoLessPick = Boolean\(/);
assert.match(pickRoute, /focused\.pick\.userId !== user\?\.id/);
assert.match(pickRoute, /사진이 있는 원픽만 공개하고 있어요/);

const itemRoute = read('src/app/item/[itemId].tsx');
assert.match(itemRoute, /publicFoodChannel = OnePickFeatures\.foodChannelPicker \? undefined : OnePickMvp\.publicPickChannel/);
assert.match(itemRoute, /useItemDetail\(itemId, user\?\.id, focusPickId, true, !isSessionLoading && !sessionError, publicFoodChannel\)/);
assert.match(itemRoute, /mvpFoodScope = isRestaurant && !OnePickFeatures\.foodChannelPicker/);
assert.match(itemRoute, /item\.channels\?\.includes\(OnePickMvp\.publicPickChannel\)/);
assert.match(itemRoute, /item\.externalSource === 'onepick_place'/);
assert.match(itemRoute, /hasCurrentPick = allPicks\.some/);
assert.match(itemRoute, /hasOwnCurrentPick = Boolean\(user && allPicks\.some/);
assert.match(itemRoute, /!hasPhoto && hasCurrentPick && !hasOwnCurrentPick/);
assert.match(itemRoute, /hasPublicCurrentPick = allPicks\.some/);
assert.match(itemRoute, /\|\| hasPublicCurrentPick/);
assert.match(itemRoute, /allPicks\.filter\(\(\{ pick \}\) => pick\.channel === OnePickMvp\.publicPickChannel/);
assert.match(itemRoute, /!pick\.channel && itemSupportsPublicChannel/);
assert.match(itemRoute, /focusAvailable = !focusPickId \|\| picks\.some/);
assert.match(itemRoute, /displayChannels = mvpFoodScope \? \[OnePickMvp\.publicPickChannel\] : item\.channels/);
assert.match(itemRoute, /<ItemPickCount itemId=\{item\.id\} channelScope=\{publicCountScope\} \/>/);
assert.match(itemRoute, /hasOwnPendingPick \? <Text style=\{styles\.pendingPickNotice\}>/);
assert.match(itemRoute, /!mvpFoodScope \? <ItemChannelLinks itemId=\{item\.id\} \/> : null/);
assert.match(itemRoute, /현재 공개 범위에 없어요/);

const scopeExports = {};
vm.runInNewContext(ts.transpileModule(read('functions/_lib/mvp-scope.ts'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, { exports: scopeExports });
const food = { category_taste_dimensions: [{ dimension_code: 'food', is_primary: true }] };
const culture = { category_taste_dimensions: [{ dimension_code: 'culture', is_primary: true }] };
const unmapped = { category_taste_dimensions: [] };
const photo = { image_source_url: 'https://onepick.test/item.jpg' };
const offlineItem = { ...photo, item_channels: [{ channel: 'offline' }] };
const onlineItem = { ...photo, item_channels: [{ channel: 'online' }] };
const legacyPlace = { ...photo, item_channels: [], external_source: 'onepick_place' };

assert.equal(scopeExports.isMvpPublicPick({ channel: 'offline' }, food, offlineItem), true);
assert.equal(scopeExports.isMvpPublicPick({ channel: 'online' }, food, onlineItem), false);
assert.equal(scopeExports.isMvpPublicPick({ channel: null }, food, offlineItem), true, 'legacy FOOD Pick inherits an offline-capable item');
assert.equal(scopeExports.isMvpPublicPick({ channel: null }, food, onlineItem), false);
assert.equal(scopeExports.isMvpPublicPick({ channel: null }, culture, photo), true, 'direct non-food Pick links stay available when photographed');
assert.equal(scopeExports.isMvpPublicPick({ channel: null }, culture, {}), false, 'photo-less direct Pick links are not publicly exposed');
assert.equal(scopeExports.isMvpProfilePick({ channel: null }, culture, photo), false, 'lab themes stay out of profile OG');
assert.equal(scopeExports.isMvpProfilePick({ channel: null }, unmapped, photo), true, 'photographed unmapped legacy Picks stay on the main profile');
assert.equal(scopeExports.isMvpProfilePick({ channel: null }, unmapped, {}), false, 'photo-less legacy Picks stay out of profile OG');
assert.equal(scopeExports.isMvpPublicItem(food, legacyPlace), true, 'legacy place item is treated as offline');
assert.equal(scopeExports.isMvpPublicItem(food, onlineItem), false);
assert.equal(scopeExports.isMvpPublicItem(food, {}, true), true, 'a public offline Pick keeps a legacy no-channel food item reachable');
assert.equal(scopeExports.isMvpPublicItem(food, {}, false), false, 'a no-channel food item without a public offline Pick stays hidden');
assert.equal(scopeExports.isMvpPublicItem(culture, onlineItem), true, 'non-food item detail is unaffected');

const pickOg = read('functions/pick/[pickId].ts');
assert.match(pickOg, /isMvpPublicPick\(row, category, item\)/);
assert.match(pickOg, /status,channel/);
const itemOg = read('functions/item/[itemId].ts');
assert.match(itemOg, /isMvpPublicItem\(category, row, hasPublicOfflinePick\)/);
assert.match(itemOg, /item_channels\(channel\)/);
assert.ok(itemOg.includes("picksQuery.searchParams.set('status', 'eq.active')"));
assert.ok(itemOg.includes("picksQuery.searchParams.set('channel', `eq.\${MVP_PUBLIC_PICK_CHANNEL}`)"));
const profileOg = read('functions/u/[username].ts');
assert.match(profileOg, /isMvpProfilePick/);
assert.match(profileOg, /pickCount: publicPicks\.length/);
assert.match(profileOg, /category_taste_dimensions\(dimension_code,is_primary\)/);

console.log('MVP detail scope checks passed: SPA and dynamic OG hide future FOOD channels while preserving non-food and legacy-safe public content.');
