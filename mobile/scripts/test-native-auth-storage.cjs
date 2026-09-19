const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const nativeStorage = fs.readFileSync(
  path.join(__dirname, '../src/lib/supabase/storage.native.ts'),
  'utf8',
);
const packageJson = JSON.parse(fs.readFileSync(path.join(__dirname, '../package.json'), 'utf8'));
const packageLock = JSON.parse(fs.readFileSync(path.join(__dirname, '../package-lock.json'), 'utf8'));

assert.match(nativeStorage, /class LargeSecureStore/,
  'Native auth storage must use the large encrypted session adapter');
assert.match(nativeStorage, /SecureStore\.setItemAsync\(key, aesjs\.utils\.hex\.fromBytes\(encryptionKey\)\)/,
  'Only the random AES key is stored in Keychain\/Keystore');
assert.match(nativeStorage, /AsyncStorage\.setItem\(key, encrypted\)/,
  'AsyncStorage may contain only encrypted session bytes');
assert.doesNotMatch(nativeStorage, /AsyncStorage\.setItem\(key, value\)/,
  'Supabase session plaintext must never be written to AsyncStorage');
assert.match(nativeStorage, /crypto\.getRandomValues\(new Uint8Array\(256 \/ 8\)\)/);
assert.match(nativeStorage, /new aesjs\.ModeOfOperation\.ctr/);
assert.match(nativeStorage, /SecureStore\.deleteItemAsync\(key\)/);

assert.equal(packageJson.dependencies['aes-js'], '^3.1.2');
assert.equal(packageJson.dependencies['expo-secure-store'], '~56.0.4');
assert.equal(packageJson.dependencies['react-native-get-random-values'], '~1.11.0');
assert.equal(packageJson.devDependencies['@types/aes-js'], '^3.1.4');
assert.equal(packageLock.packages['node_modules/aes-js'].version, '3.1.2');
assert.equal(packageLock.packages['node_modules/expo-secure-store'].version, '56.0.4');
assert.equal(packageLock.packages['node_modules/react-native-get-random-values'].version, '1.11.0');

console.log('Native auth storage checks passed: Supabase sessions are encrypted at rest with a SecureStore-held key.');
