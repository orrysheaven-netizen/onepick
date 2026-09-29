const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

function load(file, imports = {}) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src', file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, {
    exports, URL,
    require: (name) => {
      if (name === '@/constants/onepick') return require('./design-tokens.cjs');
      if (name in imports) return imports[name];
      if (name === 'react') return React;
      if (name === 'react/jsx-runtime') return require(name);
      assert.fail(`Unexpected import: ${name}`);
    },
  });
  return exports;
}

const plain = (value) => JSON.parse(JSON.stringify(value));

async function main() {
  const links = load('lib/items/itemChannelLinks.ts', { './pickChannel': {} });
  const kakao = 'https://place.map.kakao.com/12345';
  const shop = 'https://www.example-shop.co.kr/goods/1';

  assert.deepEqual(plain(links.parseItemChannelLinks([
    { channel: 'online', target_url: shop, is_primary: false },
    { channel: 'offline', target_url: kakao, is_primary: true },
  ])).map((link) => [link.channel, link.url, link.host]), [['offline', kakao, 'place.map.kakao.com'], ['online', shop, 'example-shop.co.kr']]);
  assert.deepEqual(plain(links.parseItemChannelLinks([
    { channel: 'offline', target_url: kakao, is_primary: false },
    { channel: 'online', target_url: shop, is_primary: true },
  ])).map((link) => link.channel), ['online', 'offline'], 'The primary channel comes first');
  assert.deepEqual(plain(links.parseItemChannelLinks([
    { channel: 'online', target_url: shop }, { channel: 'offline', target_url: kakao },
  ])).map((link) => link.channel), ['offline', 'online'], 'Without a primary, 매장 comes before 온라인');

  for (const bad of [null, '', 'http://place.map.kakao.com/1', 'javascript:alert(1)', 'https://', 'https://a b', `https://x.test/${'a'.repeat(2048)}`, 42]) {
    assert.deepEqual(plain(links.parseItemChannelLinks([{ channel: 'offline', target_url: bad, is_primary: true }])), [], `Unsafe URL is hidden: ${String(bad).slice(0, 40)}`);
  }
  assert.deepEqual(plain(links.parseItemChannelLinks([{ channel: 'delivery', target_url: kakao }])), [], 'Unknown channels are hidden');
  assert.deepEqual(plain(links.parseItemChannelLinks(null)), []);
  assert.equal(links.ITEM_CHANNEL_LINK_LABELS.offline, '매장 정보 보기');
  assert.equal(links.ITEM_CHANNEL_LINK_LABELS.online, '온라인몰에서 보기');

  const iphoneChrome = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/140.0 Mobile/15E148 Safari/604.1';
  const android = 'Mozilla/5.0 (Linux; Android 15; SM-S928N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Mobile Safari/537.36';
  const mac = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15';
  const windows = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36';
  assert.equal(links.opensLinkInSameTab({ userAgent: iphoneChrome, maxTouchPoints: 5 }), true, 'iPhone Chrome opens store links in the same tab (no blank tab left behind)');
  assert.equal(links.opensLinkInSameTab({ userAgent: android, maxTouchPoints: 5 }), true, 'Android browsers open in the same tab');
  assert.equal(links.opensLinkInSameTab({ userAgent: mac, maxTouchPoints: 5 }), true, 'iPadOS (Mac user agent with touch) opens in the same tab');
  assert.equal(links.opensLinkInSameTab({ userAgent: mac, maxTouchPoints: 0 }), false, 'Desktop Mac keeps a new tab');
  assert.equal(links.opensLinkInSameTab({ userAgent: windows, maxTouchPoints: 0 }), false, 'Desktop Windows keeps a new tab');
  assert.equal(links.opensLinkInSameTab(undefined), false, 'Without a navigator nothing changes');

  const { AppError } = load('errors/appError.ts');
  const { mapSupabaseError } = load('errors/mapSupabaseError.ts', { './appError': { AppError } });
  const calls = [];
  const client = (result) => ({
    from(table) {
      calls.push(['from', table]);
      return { select(columns) { calls.push(['select', columns]); return { eq: async (column, value) => { calls.push(['eq', column, value]); return result; } }; } };
    },
  });
  const serviceImports = (result) => ({
    '@/errors/mapSupabaseError': { mapSupabaseError },
    '@/lib/items/itemChannelLinks': links,
    '@/lib/supabase/client': { supabase: client(result) },
  });
  const { ItemChannelLinkService } = load('services/itemChannelLinkService.ts', serviceImports({ data: [], error: null }));
  const service = new ItemChannelLinkService(client({ data: [{ channel: 'offline', target_url: kakao, is_primary: true }], error: null }));
  assert.deepEqual(plain(await service.list('item-1')).map((link) => link.url), [kakao]);
  assert.deepEqual(calls, [['from', 'item_channels'], ['select', 'channel,target_url,is_primary'], ['eq', 'item_id', 'item-1']]);
  const failing = new ItemChannelLinkService(client({ data: null, error: { message: 'boom', code: 'XX000' } }));
  await assert.rejects(failing.list('item-1'));

  const component = (tag) => ({ children, style: _style, accessibilityRole, accessibilityLabel, onPress }) =>
    React.createElement(tag, { role: accessibilityRole, 'aria-label': accessibilityLabel, onClick: onPress }, children);
  const render = (data) => {
    const { ItemChannelLinks } = load('components/item-channel-links.tsx', {
      '@tanstack/react-query': { useQuery: ({ queryKey }) => { assert.deepEqual(plain(queryKey), ['items', 'channels', 'item-1']); return { data }; } },
      'react-native': { Linking: {}, Platform: { OS: 'web' }, Pressable: component('a'), StyleSheet: { create: (s) => s }, Text: component('span'), View: component('div') },
      '@/lib/items/itemChannelLinks': links,
      '@/lib/query/queryKeys': { queryKeys: { items: { channels: (id) => ['items', 'channels', id] } } },
      '@/services/itemChannelLinkService': { itemChannelLinkService: {} },
    });
    return renderToStaticMarkup(React.createElement(ItemChannelLinks, { itemId: 'item-1' }));
  };
  assert.equal(render(undefined), '', 'Loading or failed link reads render nothing');
  assert.equal(render([]), '', 'Items without links render nothing');
  const html = render(links.parseItemChannelLinks([{ channel: 'offline', target_url: kakao, is_primary: true }, { channel: 'online', target_url: shop }]));
  assert.ok(html.indexOf('매장 정보 보기') < html.indexOf('온라인몰에서 보기'));
  assert.match(html, /place\.map\.kakao\.com/);
  assert.match(html, /role="link"/);

  const detail = fs.readFileSync(path.join(__dirname, '../src/app/item/[itemId].tsx'), 'utf8');
  assert.match(detail, /<ItemChannelLinks itemId=\{item\.id\} \/>/, 'The item detail screen shows the channel links');

  console.log('Item channel links passed: https-only store/online links, primary-first order, optional rendering and detail placement.');
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
