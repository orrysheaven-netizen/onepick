// Shared 오프라인/온라인 channel badge (docs/channel-badge.md, Figma 810:4516).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

const { loadUi } = require('./ui-components.cjs');

const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

const styleOf = (s) => (Array.isArray(s) ? Object.assign({}, ...s.filter(Boolean).map(styleOf)) : s || {});
const native = {
  StyleSheet: { create: (s) => s },
  View: ({ style, children, ...rest }) => React.createElement('div', { 'data-style': JSON.stringify(styleOf(style)), ...rest }, children),
  Text: ({ style, children }) => React.createElement('span', { 'data-style': JSON.stringify(styleOf(style)) }, children),
  Pressable: ({ children }) => React.createElement('button', null, typeof children === 'function' ? children({ pressed: false }) : children),
  Image: () => null,
};
const ui = loadUi({ 'react-native': native, '@/components/pick-photo': { PickPhoto: () => null } });
const tokens = require('./design-tokens.cjs');

assert.deepEqual({ ...ui.CHANNEL_BADGE_LABELS }, { offline: '오프라인', online: '온라인', recipe: '레시피' }, 'symmetric 오프라인/온라인 copy');

for (const channel of ['offline', 'online']) {
  const html = renderToStaticMarkup(React.createElement(ui.ChannelBadge, { channel }));
  assert.match(html, new RegExp(`>${ui.CHANNEL_BADGE_LABELS[channel]}<`));
  assert.doesNotMatch(html, /<button/, 'the badge is information, never a control');
  const badge = JSON.parse(html.match(/data-style="([^"]*)"/)[1].replace(/&quot;/g, '"'));
  assert.equal(badge.height, 24);
  assert.equal(badge.backgroundColor, tokens.OnePick.bgDefault, 'white fill (2026-10-05)');
  assert.equal(badge.borderColor, tokens.OnePick.borderStrong);
  assert.equal(badge.borderWidth, 1);
  assert.equal(badge.borderRadius, tokens.OnePickRadius.md);
  assert.equal(badge.paddingHorizontal, tokens.OnePickSpace.sm);
  assert.equal(badge.gap, tokens.OnePickSpace.xs);
}

// Web draws 매장 외관 / 장바구니 at 10px; recipe stays text only until an icon is decided.
const glyph = read('src/components/ui/channel-glyph.web.tsx');
assert.match(glyph, /channel === 'offline'[\s\S]*?width="10" height="10" viewBox="2 3 20 18"/);
assert.match(glyph, /channel === 'online'[\s\S]*?width="10" height="10" viewBox="1 2 21 21"/);
assert.match(glyph, /aria-hidden="true"/);

// Every channel badge in the app goes through the shared component.
for (const file of [
  'src/components/ui/pick-card.tsx',
  'src/components/home-pick-row.tsx',
  'src/components/menu-detail-pick-card.tsx',
  'src/components/profile-pick-card.tsx',
  'src/app/provider/[providerId].tsx',
  'src/app/(tabs)/(profile)/profile.tsx',
  'src/app/(tabs)/(profile)/u/[username].tsx',
]) {
  const source = read(file);
  assert.match(source, /<ChannelBadge channel=/, `${file} uses ChannelBadge`);
  assert.doesNotMatch(source, /channelBadge(Text)?:|storeChannel(Badge|Text):|\bbadgeText:|PickBadge(Offline|Online|Recipe|Text)?:/, `${file} has no per-screen badge styles`);
}

console.log('channel badge checks passed');
