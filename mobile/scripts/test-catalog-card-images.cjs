const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

function load(file, imports = {}) {
  const exports = {};
  const source = fs.readFileSync(path.join(__dirname, '../src', file), 'utf8');
  vm.runInNewContext(ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, { exports, require: (name) => {
    if (name === '@/constants/onepick') return require('./design-tokens.cjs');
    if (name in imports) return imports[name];
    if (name === 'react' || name === 'react/jsx-runtime') return require(name);
    assert.fail(`Unexpected dependency: ${name}`);
  } });
  return exports;
}

async function main() {
  const { AppError } = load('errors/appError.ts');
  const { mapSupabaseError } = load('errors/mapSupabaseError.ts', { './appError': { AppError } });
  const imports = { '@/errors/appError': { AppError }, '@/errors/mapSupabaseError': { mapSupabaseError },
    '@/repositories/supabase/itemChannels': { fetchItemChannels: async () => new Map() },
    '@/repositories/supabase/itemProviders': { fetchItemProviderIds: async () => new Map() } };
  for (const name of ['category', 'comment', 'pick', 'item', 'profile']) {
    imports[`@/repositories/mappers/${name}Mapper`] = load(`repositories/mappers/${name}Mapper.ts`);
  }
  imports['@/lib/home/channelFeedMerge'] = load('lib/home/channelFeedMerge.ts');
  const { SupabaseReadRepository } = load('repositories/supabase/supabaseReadRepository.ts', imports);
  const poster = 'https://image.tmdb.org/t/p/w342/u1L4qxIu5sC2P082uMHYt7Ifvnj.jpg';
  const storagePaths = [], calls = [];
  let rows = [], failure = null;
  const countClient = { rpc: (name, args) => {
    calls.push({ name, args });
    if (name === 'home_showcase_page') return { single: async () => ({ data: { minimum_pick_count: 1, items: rows }, error: failure }) };
    assert.equal(name, 'category_top_items');
    return Promise.resolve({ data: rows, error: failure });
  } };
  const client = { rpc: () => assert.fail('Keep public count client for aggregate reads'), storage: { from: (bucket) => {
    assert.equal(bucket, 'item-photos');
    return { getPublicUrl: (file) => {
      assert.ok(!file.startsWith('https://'), 'Catalog URLs are not Storage object paths');
      storagePaths.push(file);
      return { data: { publicUrl: `https://storage.test/${file}` } };
    } };
  } } };
  const repository = new SupabaseReadRepository(client, countClient);
  const base = { item_id: 'movie', name: '센과 치히로의 행방불명', category_id: 'movies', category_name: '영화',
    pick_count: 1, rank: 1, is_tied: false, last_picked_at: '2026-09-17T13:39:17.960862Z',
    latest_pick_id: 'pick', latest_picker_username: 'viewer', latest_picker_profile_image_url: null, latest_pick_review: 'favorite' };
  const cases = [
    [{ thumbnail_path: null, image_path: null, image_source_url: poster }, poster, null],
    [{ thumbnail_path: 'u/thumb.jpg', image_path: 'u/original.jpg', image_source_url: poster }, 'https://storage.test/u/thumb.jpg', 'u/thumb.jpg'],
    // Defensive support for older/partial read models; the live items table pairs uploads.
    [{ thumbnail_path: null, image_path: 'u/original.jpg', image_source_url: poster }, 'https://storage.test/u/original.jpg', 'u/original.jpg'],
    [{ thumbnail_path: null, image_path: null, image_source_url: null }, null, null],
    [{ thumbnail_path: null, image_path: null }, null, null],
  ];
  for (const [images, expected, expectedPath] of cases) {
    rows = [{ ...base, ...images }]; storagePaths.length = 0;
    const ranked = await repository.getCategoryTopItems('movies');
    const home = await repository.getHomeShowcase();
    assert.equal(ranked[0].thumbnailUrl, expected);
    assert.equal(home.items[0].thumbnailUrl, expected);
    assert.equal(ranked[0].pickCount, 1); assert.equal(ranked[0].rank, 1);
    assert.equal(home.items[0].latestPickerUsername, 'viewer');
    assert.equal(home.items[0].latestPickReview, 'favorite');
    assert.equal(storagePaths.length, expectedPath ? 2 : 0);
    if (expectedPath) assert.ok(storagePaths.every((value) => value === expectedPath));
  }
  rows = Array.from({ length: 21 }, (_, i) => ({ ...base, item_id: `movie-${i}`, image_source_url: poster }));
  const page = await repository.getHomeShowcase();
  assert.equal(page.items.length, 20);
  assert.equal(page.nextCursor.id, 'movie-19');
  assert.equal(page.nextCursor.timestamp, base.last_picked_at, 'Keep microsecond pagination cursor');
  assert.ok(page.items.every((item) => item.thumbnailUrl === poster));
  assert.ok(calls.filter((call) => call.name === 'category_top_items').every((call) => call.args.p_category_id === 'movies'));
  failure = { message: 'offline' };
  await assert.rejects(() => repository.getCategoryTopItems('movies'));
  await assert.rejects(() => repository.getHomeShowcase());

  const { mapItemRow } = imports['@/repositories/mappers/itemMapper'];
  const item = { image_source_url: poster };
  assert.equal(mapItemRow(item).thumbnailUrl, poster);
  assert.equal(mapItemRow(item, 'https://storage.test/original').thumbnailUrl, 'https://storage.test/original');
  assert.equal(mapItemRow(item, 'https://storage.test/original', 'https://storage.test/thumb').thumbnailUrl, 'https://storage.test/thumb');

  let renderedImage;
  const part = (tag) => ({ children }) => React.createElement(tag, null, children);
  const { PickPhoto } = load('components/pick-photo.tsx', {
    'expo-image': { Image: (props) => { renderedImage = props; return React.createElement('img', { src: props.source.uri, alt: props.accessibilityLabel }); } },
    'expo-router': { useRouter: () => ({ push: () => assert.fail('No upload route for existing image') }) },
    'react-native': { View: part('div'), Text: part('span'), StyleSheet: { create: (styles) => styles } },
  });
  const markup = renderToStaticMarkup(React.createElement(PickPhoto, { uri: poster, label: base.name }));
  assert.equal(renderedImage.source.uri, poster);
  assert.doesNotMatch(markup, /사진 준비 중/);
  assert.match(renderToStaticMarkup(React.createElement(PickPhoto, { uri: null, label: 'No image' })), /사진 준비 중/);
  console.log('Catalog card images: external posters, upload priority, defensive original fallback, missing images, public reads, pagination, errors and rendered Image source passed.');
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
