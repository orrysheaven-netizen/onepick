const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Source-level guard: every text-entry form screen sits inside KeyboardAvoidingForm so the keyboard
// cannot cover the focused field or the submit button (Android is edge-to-edge; the window won't resize).
const read = (relative) => fs.readFileSync(path.join(__dirname, '../src', relative), 'utf8');

const component = read('components/keyboard-avoiding-form.tsx');
assert.match(component, /<KeyboardAvoidingView style=\{styles\.fill\} behavior="padding">/, 'Forms use padding behavior on every platform');
assert.match(component, /fill: \{ flex: 1 \}/);

const screens = { 'app/auth/username.tsx': 1, 'app/pick/choose.tsx': 1, 'app/pick/new.tsx': 1, 'app/pick/link.tsx': 1, 'app/pick/request.tsx': 2 };
for (const [file, forms] of Object.entries(screens)) {
  const source = read(file);
  assert.match(source, /import \{ KeyboardAvoidingForm \} from '@\/components\/keyboard-avoiding-form';/, `${file}: imports the wrapper`);
  const opens = source.match(/<KeyboardAvoidingForm>/g)?.length ?? 0;
  const closes = source.match(/<\/KeyboardAvoidingForm>/g)?.length ?? 0;
  assert.equal(opens, forms, `${file}: ${forms} form(s) wrapped`);
  assert.equal(closes, opens, `${file}: wrapper tags balanced`);
  // The wrapper sits directly inside the safe area so the keyboard offset is measured from the screen content.
  assert.match(source.replace(/\r/g, ''), /<SafeAreaView[^>]*>\n\s*<KeyboardAvoidingForm>/, `${file}: wrapper is the safe area's first child`);
}
console.log('Keyboard avoidance passed: text-entry forms are wrapped in KeyboardAvoidingForm with padding behavior.');
