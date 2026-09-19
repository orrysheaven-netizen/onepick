const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const nativeStorage = fs.readFileSync(
  path.join(__dirname, '../src/lib/supabase/storage.native.ts'),
  'utf8',
);
const packageJson = JSON.parse(fs.readFileSync(path.join(__dirname, '../package.json'), 'utf8'));
const packageLock = JSON.parse(fs.readFileSync(path.join(__dirname, '../package-lock.json'), 'utf8'));

assert.match(nativeStorage, /from 'expo-secure-store'/,
  'Native auth storage must use the platform SecureStore');
assert.doesNotMatch(nativeStorage, /AsyncStorage|@react-native-async-storage\/async-storage/,
  'Supabase native sessions must not be persisted to unencrypted AsyncStorage');
assert.match(nativeStorage, /getItemAsync\(key\)/);
assert.match(nativeStorage, /setItemAsync\(key, value\)/);
assert.match(nativeStorage, /deleteItemAsync\(key\)/);
assert.equal(packageJson.dependencies['expo-secure-store'], '~56.0.4');
assert.equal(packageLock.packages[''].dependencies['expo-secure-store'], '~56.0.4');
assert.equal(packageLock.packages['node_modules/expo-secure-store'].version, '56.0.4');

console.log('Native auth storage checks passed: Supabase sessions use Expo SecureStore.');
