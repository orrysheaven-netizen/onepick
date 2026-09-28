const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const explore = fs.readFileSync(path.join(__dirname, '../src/app/(tabs)/explore.tsx'), 'utf8');

assert.match(explore, /paddingHorizontal: OnePickSpace\.gutter/);
assert.match(explore, /title: \{ \.\.\.OnePickType\.pageTitle/);
assert.match(explore, /menuName: \{ \.\.\.OnePickType\.headline/);
assert.match(explore, /borderRadius: OnePickRadius\.lg/);
assert.match(explore, /backgroundColor: OnePick\.bgPlaceholder/);
assert.match(explore, /borderColor: OnePick\.borderDefault/);
assert.doesNotMatch(explore, /fontWeight: ['"](?:800|900)['"]/);
assert.doesNotMatch(explore, /paddingHorizontal: 20/);
assert.match(explore, /dishChannels=\{\{ userId: user\?\.id, onRegister: registerDish \}\}/, 'registration wiring stays intact');
assert.match(explore, /showRankingDetail = OnePickFeatures\.exploreRankingDetail/, 'ranking exposure contract stays intact');

console.log('Explore Foundations checks passed: visual tokens changed without search/registration/ranking contract drift.');
