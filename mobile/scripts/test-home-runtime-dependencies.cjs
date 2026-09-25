const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

const hooks = [
  ['useHomeData', read('src/hooks/useHomeData.ts'), '@/services/homeServiceInstance'],
  ['useExploreData', read('src/hooks/useExploreData.ts'), '@/services/exploreServiceInstance'],
  ['useFollow', read('src/hooks/useFollow.ts'), '@/services/followServiceInstance'],
  ['useItemSearch', read('src/hooks/useItemSearch.ts'), '@/services/itemServiceInstance'],
];

for (const [name, source, instancePath] of hooks) {
  assert.doesNotMatch(source, /from ['\"]@\/services['\"]/, name + ' must not pull the broad services barrel into initial routes');
  assert.ok(source.includes(`from '${instancePath}'`) || source.includes(`from \"${instancePath}\"`), name + ' uses its narrow service singleton');
}

const instanceFiles = [
  'src/services/homeServiceInstance.ts',
  'src/services/exploreServiceInstance.ts',
  'src/services/followServiceInstance.ts',
  'src/services/itemServiceInstance.ts',
];

for (const file of instanceFiles) {
  const source = read(file);
  assert.doesNotMatch(source, /@\/repositories\/supabase['\"]/, file + ' must not pull the broad repository barrel');
  for (const forbidden of [
    'SupabaseMovieCatalogRepository',
    'SupabaseMusicCatalogRepository',
    'SupabaseGameCatalogRepository',
    'SupabaseBookCatalogRepository',
    'SupabaseYouTubeCatalogRepository',
    'SupabasePokemonCatalogRepository',
    'SupabasePlaceCatalogRepository',
  ]) {
    assert.doesNotMatch(source, new RegExp(forbidden), file + ' excludes external catalog repository: ' + forbidden);
  }
}

assert.match(read('src/services/homeServiceInstance.ts'), /SupabaseReadRepository/);
assert.match(read('src/services/exploreServiceInstance.ts'), /SupabaseCategoryRepository/);
assert.match(read('src/services/followServiceInstance.ts'), /SupabaseFollowRepository/);
assert.match(read('src/services/itemServiceInstance.ts'), /SupabaseItemRepository/);

console.log('Runtime dependency checks passed: latency-sensitive hooks avoid broad service/catalog barrels.');
