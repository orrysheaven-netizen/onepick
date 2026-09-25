const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

const runtime = read('src/services/homeRuntimeServices.ts');
const homeHook = read('src/hooks/useHomeData.ts');
const exploreHook = read('src/hooks/useExploreData.ts');
const followHook = read('src/hooks/useFollow.ts');
const searchHook = read('src/hooks/useItemSearch.ts');

for (const [name, source] of [
  ['useHomeData', homeHook],
  ['useExploreData', exploreHook],
  ['useFollow', followHook],
  ['useItemSearch', searchHook],
]) {
  assert.doesNotMatch(source, /from ['"]@\/services['"]/, name + ' must not pull the broad services barrel into Home');
  assert.match(source, /from ['"]@\/services\/homeRuntimeServices['"]/, name + ' uses the Home runtime service set');
}

for (const forbidden of [
  'SupabaseMovieCatalogRepository',
  'SupabaseMusicCatalogRepository',
  'SupabaseGameCatalogRepository',
  'SupabaseBookCatalogRepository',
  'SupabaseYouTubeCatalogRepository',
  'SupabasePokemonCatalogRepository',
  'SupabasePlaceCatalogRepository',
]) {
  assert.doesNotMatch(runtime, new RegExp(forbidden), 'Home runtime excludes external catalog repository: ' + forbidden);
}

for (const required of [
  'SupabaseReadRepository',
  'SupabaseCategoryRepository',
  'SupabaseFollowRepository',
  'SupabaseItemRepository',
  'SupabasePickRepository',
  'HomeService',
  'ExploreService',
  'FollowService',
  'ItemService',
]) {
  assert.match(runtime, new RegExp(required), 'Home runtime keeps required dependency: ' + required);
}

console.log('Home runtime dependency checks passed: initial Home hooks avoid broad service/catalog barrels.');
