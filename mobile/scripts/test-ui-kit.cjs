const assert = require('node:assert/strict');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const { loadUi } = require('./ui-components.cjs');
const { OnePick } = require('./design-tokens.cjs');

// Minimal react-native stand-ins: record Pressable props so the checks can press and inspect state.
let pressables = [];
const flat = (style) => (Array.isArray(style) ? style.flatMap(flat) : style ? [style] : []);
const resolveStyle = (style) => Object.assign({}, ...flat(typeof style === 'function' ? style({ pressed: false }) : style));
const host = (tag) => ({ children, accessibilityLabel, accessibilityRole, style }) =>
  React.createElement(tag, { 'aria-label': accessibilityLabel, role: accessibilityRole, 'data-style': JSON.stringify(resolveStyle(style)) }, children);
let spinners = 0;
const native = {
  Text: host('span'), View: host('div'),
  Pressable: (props) => { pressables.push({ ...props, resolved: resolveStyle(props.style) }); return React.createElement('button', { 'aria-label': props.accessibilityLabel, disabled: props.disabled }, props.children); },
  ActivityIndicator: () => { spinners++; return React.createElement('i', null, 'spinner'); },
  StyleSheet: { create: (s) => s },
};
const ui = loadUi({ 'react-native': native, '@/components/pick-photo': { PickPhoto: ({ label, feed }) => React.createElement('img', { alt: label, 'data-feed': String(feed) }) } });
const render = (element) => { pressables = []; spinners = 0; return renderToStaticMarkup(element); };
const pressable = (label) => pressables.find((p) => p.accessibilityLabel === label);

// Button: one visual per variant, disabled/loading block presses, ghost stays a text link.
{
  let pressed = 0;
  const html = render(React.createElement(ui.Button, { label: '이 원픽으로 정하기', onPress: () => pressed++ }));
  assert.match(html, /이 원픽으로 정하기/);
  const primary = pressable('이 원픽으로 정하기');
  assert.equal(primary.resolved.backgroundColor, OnePick.brand);
  assert.equal(primary.resolved.minHeight, 48);
  assert.equal(primary.accessibilityRole, 'button');
  primary.onPress(); assert.equal(pressed, 1);

  render(React.createElement(ui.Button, { label: '공유', variant: 'secondary', size: 'sm' }));
  assert.equal(pressable('공유').resolved.borderColor, OnePick.border);
  assert.equal(pressable('공유').resolved.minHeight, 40);

  render(React.createElement(ui.Button, { label: '나도 이게 원픽', variant: 'soft' }));
  assert.equal(pressable('나도 이게 원픽').resolved.backgroundColor, OnePick.accentSoft);

  render(React.createElement(ui.Button, { label: '삭제', variant: 'danger' }));
  assert.equal(pressable('삭제').resolved.backgroundColor, 'transparent');

  render(React.createElement(ui.Button, { label: '저장', disabled: true, accessibilityLabel: '원픽 저장' }));
  assert.equal(pressable('원픽 저장').disabled, true);
  assert.equal(pressable('원픽 저장').accessibilityState.disabled, true);

  const loading = render(React.createElement(ui.Button, { label: '저장', loading: true }));
  assert.match(loading, /spinner/); assert.doesNotMatch(loading, />저장</, 'Loading replaces the label with a spinner');
  assert.equal(pressable('저장').disabled, true);
  assert.equal(pressable('저장').accessibilityState.busy, true);

  render(React.createElement(ui.Button, { label: '전체', fullWidth: true }));
  assert.equal(pressable('전체').resolved.alignSelf, 'stretch');
}

// Chip: selection is exposed to assistive tech and drawn with the accent pair; dashed marks an empty slot.
{
  render(React.createElement(ui.Chip, { label: '영화', selected: true, accessibilityLabel: '영화 카테고리 보기' }));
  const selected = pressable('영화 카테고리 보기');
  assert.equal(selected.accessibilityState.selected, true);
  assert.equal(selected.resolved.backgroundColor, OnePick.accentSoft);
  assert.equal(selected.resolved.borderColor, OnePick.accent);

  render(React.createElement(ui.Chip, { label: '드라마' }));
  assert.equal(pressable('드라마').accessibilityState.selected, false);
  assert.equal(pressable('드라마').resolved.backgroundColor, OnePick.surface);

  const dashed = render(React.createElement(ui.Chip, { label: '책', dashed: true, leading: React.createElement('b', null, '+') }));
  assert.match(dashed, /<b>\+<\/b>/);
  assert.equal(pressable('책').resolved.borderStyle, 'dashed');
}

// SectionHeader: title + accent count + description, optional ghost action.
{
  let managed = 0;
  const html = render(React.createElement(ui.SectionHeader, { title: '카테고리별 원픽', count: 7, description: '카테고리마다 하나', action: { label: '관리', onPress: () => managed++ } }));
  assert.match(html, /카테고리별 원픽/); assert.match(html, /7/); assert.match(html, /카테고리마다 하나/);
  pressable('관리').onPress(); assert.equal(managed, 1);
  assert.equal(pressable('관리').resolved.backgroundColor, 'transparent');

  const bare = render(React.createElement(ui.SectionHeader, { title: '댓글' }));
  assert.equal(pressables.length, 0); assert.match(bare, /댓글/);
}

// StateCard: empty, loading and error share one card; the action is a ghost button.
{
  let retried = 0;
  const empty = render(React.createElement(ui.StateCard, { title: '아직 고른 원픽이 없어요', text: '하나만 골라보세요.', action: { label: '원픽 고르기', onPress: () => retried++ } }));
  assert.match(empty, /아직 고른 원픽이 없어요/); assert.match(empty, /하나만 골라보세요/); assert.match(empty, />원픽</, 'Empty state carries the 원픽 brand tag');
  pressable('원픽 고르기').onPress(); assert.equal(retried, 1);

  const loading = render(React.createElement(ui.StateCard, { title: '불러오는 중', loading: true }));
  assert.equal(spinners, 1); assert.doesNotMatch(loading, />원픽</, 'Loading shows a spinner instead of the mark');

  const failed = render(React.createElement(ui.StateCard, { title: '불러오지 못했어요', tone: 'danger', accessibilityRole: 'alert', action: { label: '다시 불러오기', onPress() {}, disabled: true } }));
  assert.match(failed, /role="alert"/);
  assert.match(failed, new RegExp(`color&quot;:&quot;${OnePick.danger}`), 'Error title uses the danger tint');
  assert.equal(pressable('다시 불러오기').disabled, true);

  render(React.createElement(ui.StateCard, { title: '나의 원픽을 모아보세요', action: { label: '로그인하기', onPress() {}, variant: 'primary' } }));
  assert.equal(pressable('로그인하기').resolved.backgroundColor, OnePick.brand, 'Full-screen states can promote the action to primary');
  assert.equal(pressable('로그인하기').resolved.minHeight, 48);

  const compact = render(React.createElement(ui.StateCard, { text: '다음 제품을 불러오지 못했어요.', compact: true }));
  assert.doesNotMatch(compact, />원픽</); assert.equal(spinners, 0);
}

// BrandMark: the 원픽 tag on its own, solid or soft, three sizes.
{
  const solid = render(React.createElement(ui.BrandMark));
  assert.match(solid, />원픽</); assert.match(solid, new RegExp(`backgroundColor&quot;:&quot;${OnePick.accent}`));
  const soft = render(React.createElement(ui.BrandMark, { soft: true, size: 'lg' }));
  assert.match(soft, new RegExp(`backgroundColor&quot;:&quot;${OnePick.accentSoft}`)); assert.match(soft, /&quot;height&quot;:48/);
  assert.match(render(React.createElement(ui.BrandMark, { size: 'sm' })), /&quot;height&quot;:22/);
}

// Avatar: initial from the name; pressable only when a handler is given.
{
  const still = render(React.createElement(ui.Avatar, { name: 'minji_k' }));
  assert.match(still, />M</); assert.equal(pressables.length, 0);

  let opened = 0;
  render(React.createElement(ui.Avatar, { name: 'friend', size: 40, onPress: () => opened++ }));
  const link = pressable('@friend 프로필 보기');
  assert.ok(link, 'Pressable avatar gets a profile label by default');
  assert.equal(link.resolved.width, 40);
  link.onPress(); assert.equal(opened, 1);
}

// PickCard: person → channel/provider → menu → one-line reason, then low-noise actions.
{
  let opened = 0; let profile = 0;
  const html = render(React.createElement(ui.PickCard, {
    channelLabel: '매장', providerName: '서울집', itemName: '미역국', review: '국물이 진한데 부담스럽지 않음',
    photo: { uri: 'https://example.test/miyeokguk.jpg', itemId: 'soup', label: '서울집 미역국' },
    person: { username: 'friend', onPress: () => profile++ },
    onPress: () => opened++, accessibilityLabel: '서울집 상세 보기',
    footer: React.createElement('span', null, '✓ 내 원픽 · 댓글 · 공유'),
  }));
  assert.match(html, /“국물이 진한데 부담스럽지 않음”/);
  assert.match(html, /✓ 내 원픽/); assert.doesNotMatch(html, /새로 고름|9\/27/, 'Pick cards do not display selection time/status text');
  assert.ok(html.indexOf('@friend') < html.indexOf('서울집'), 'Person precedes the provider');
  assert.ok(html.indexOf('서울집') < html.indexOf('미역국'), 'A hierarchy keeps provider before the menu title');
  assert.match(html, />매장</);
  assert.match(html, /data-feed="true"/, 'A feed card with a real image uses the square feed photo frame');
  pressable('서울집 상세 보기').onPress(); assert.equal(opened, 1);
  pressable('@friend 프로필 보기').onPress(); assert.equal(profile, 1);

  let provider = 0;
  render(React.createElement(ui.PickCard, {
    channelLabel: '매장', providerName: '서울집', itemName: '미역국', review: '원픽 이유',
    photo: {}, onPress() {}, onPressProvider: () => provider++, accessibilityLabel: '서울집 미역국 상세 보기',
  }));
  const providerLink = pressable('서울집 제공처 프로필 보기');
  assert.ok(providerLink, 'Provider context is independently navigable when a provider profile exists');
  providerLink.onPress({ stopPropagation() {} }); assert.equal(provider, 1);

  const noPhoto = render(React.createElement(ui.PickCard, {
    providerName: '서울집', itemName: '미역국', fallbackText: '한줄평 준비 중', photo: {},
    onPress() {}, accessibilityLabel: '사진 없는 원픽 상세 보기',
  }));
  assert.match(noPhoto, /한줄평 준비 중/);
  assert.doesNotMatch(noPhoto, /data-feed="true"/, 'No image data means no empty image placeholder on the feed card');
  assert.equal(pressables.length, 1, 'No person row means no profile pressable');

  const menuContext = render(React.createElement(ui.PickCard, {
    channelLabel: '매장', providerName: '서울집', itemName: '미역국', menuContext: true, review: '원픽 이유',
    photo: {}, onPress() {}, accessibilityLabel: '메뉴 고정 화면 원픽 상세 보기',
  }));
  assert.match(menuContext, /서울집/);
  assert.doesNotMatch(menuContext, />미역국</, 'D hierarchy omits the menu title when the screen already names the menu');

  const recipeFallback = render(React.createElement(ui.PickCard, {
    channelLabel: '레시피', itemName: '미역국', menuContext: true, review: '레시피 이유',
    photo: {}, onPress() {}, accessibilityLabel: '출처 없는 레시피 원픽 상세 보기',
  }));
  assert.match(recipeFallback, />미역국</, 'D hierarchy keeps the menu title when no recipe provider/source is available');
}

console.log('UI kit passed: Button variants/states, Chip selection, SectionHeader, StateCard states, Avatar, PickCard order.');
