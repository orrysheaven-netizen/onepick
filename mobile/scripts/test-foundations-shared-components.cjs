const assert = require('node:assert/strict');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const { loadUi } = require('./ui-components.cjs');
const { OnePick } = require('./design-tokens.cjs');

const flat = (style) => Array.isArray(style) ? style.flatMap(flat) : style ? [style] : [];
const resolve = (style, pressed = false) => Object.assign({}, ...flat(typeof style === 'function' ? style({ pressed }) : style));
let pressables = [];
let views = [];
let texts = [];
let seq = 0;
const host = (tag) => (props) => React.createElement(tag, {}, props.children);
const native = {
  ActivityIndicator: () => React.createElement('i', null, 'spinner'),
  Pressable: (props) => { pressables.push({ ...props, resolved: resolve(props.style), order: seq++ }); return React.createElement('button', {}, props.children); },
  View: (props) => { views.push({ ...props, resolved: resolve(props.style), order: seq++ }); return host('div')(props); },
  Text: (props) => { texts.push({ ...props, resolved: resolve(props.style), order: seq++ }); return host('span')(props); },
  StyleSheet: { create: (s) => s },
};
const ui = loadUi({ 'react-native': native, '@/components/pick-photo': { PickPhoto: () => null } });
const render = (element) => { pressables=[]; views=[]; texts=[]; seq=0; return renderToStaticMarkup(element); };
const byLabel = (label) => pressables.find((p) => p.accessibilityLabel === label);
const textValue = (node) => Array.isArray(node.children) ? node.children.join('') : node.children;

render(React.createElement(ui.PickButton, { state: 'default' }));
assert.equal(views.find((v) => v.resolved.backgroundColor === OnePick.actionPrimary)?.resolved.backgroundColor, OnePick.actionPrimary);
render(React.createElement(ui.PickButton, { state: 'change' }));
assert.equal(views.find((v) => v.resolved.backgroundColor === OnePick.actionPrimary)?.resolved.backgroundColor, OnePick.actionPrimary);
render(React.createElement(ui.PickButton, { state: 'mine' }));
assert.equal(views.find((v) => v.resolved.backgroundColor === OnePick.bgAccent)?.resolved.backgroundColor, OnePick.bgAccent);
assert.equal(byLabel('내 원픽이에요').disabled, true);
assert.equal(byLabel('내 원픽이에요').resolved.opacity, undefined, 'Mine state is disabled without visual dimming');

render(React.createElement(ui.ReviewRow, {
  username: 'duck', review: '한줄평', currentPick: true, commentsLabel: '댓글 3',
  onComments() {}, onShare() {}, onReport() {},
}));
assert.ok(byLabel('댓글 3')); assert.ok(byLabel('공유')); assert.ok(byLabel('신고'));
assert.ok(texts.some((t) => textValue(t) === '@duck' && t.resolved.fontSize === 14), 'Review username uses Body Medium');
assert.ok(texts.some((t) => t.children === '원픽'), 'Review row exposes current-pick marker');

const interactiveReview = render(React.createElement(ui.ReviewRow, {
  username: 'duck', review: '눌러서 열기', onPress() {}, onComments() {}, onShare() {}, onReport() {},
}));
assert.doesNotMatch(
  interactiveReview,
  /<button\b[^>]*>(?:(?!<\/button>)[\s\S])*<button\b/,
  'Review summary pressable must not contain action buttons',
);

render(React.createElement(ui.ReviewRow, {
  mine: true, review: '내 한줄평', onEdit() {}, onRemovePick() {}, onDelete() {},
}));
assert.equal(byLabel('한줄평 삭제').resolved.minHeight, 44);
assert.ok(texts.some((t) => t.children === '한줄평 삭제' && t.resolved.color === OnePick.textDanger));

render(React.createElement(ui.CommentRow, {
  username: 'duck', body: '댓글', time: '3분 전', currentPick: true, onReply() {},
}));
assert.ok(texts.some((t) => textValue(t) === '@duck' && t.resolved.fontSize === 14), 'Comment username uses Body Medium');
assert.equal(byLabel('duck에게 답글').resolved.minHeight, 44);
assert.equal(byLabel('duck에게 답글').resolved.marginVertical, undefined, 'Reply touch area does not overlap adjacent rows');

render(React.createElement(ui.CommentRow, {
  username: 'duck', body: '답글 없음', time: '방금', showReply: false,
}));
assert.equal(views.some((v) => v.resolved.minHeight === 44), false, 'Time-only comment meta row does not reserve a 44px action slot');

render(React.createElement(ui.CurrentPickFlag));
const decorativeFlag = texts.find((t) => t.children === '⚑');
assert.equal(decorativeFlag.props.importantForAccessibility, 'no', 'Decorative current-pick glyph is hidden from TalkBack');

console.log('Shared Foundations components passed: PickButton states, ReviewRow actions, CommentRow hierarchy and safe touch targets.');
