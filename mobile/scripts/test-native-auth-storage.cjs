const assert = require('node:assert/strict');
const crypto = require('node:crypto').webcrypto;
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const storagePath = path.join(__dirname, '../src/lib/supabase/storage.native.ts');
const nativeStorage = fs.readFileSync(storagePath, 'utf8');
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
assert.match(nativeStorage, /if \(!encryptionKeyHex\)[\s\S]*AsyncStorage\.removeItem\(key\)[\s\S]*return null/,
  'Legacy plaintext sessions must be removed when no SecureStore key exists');

assert.equal(packageJson.dependencies['aes-js'], '^3.1.2');
assert.equal(packageJson.dependencies['expo-secure-store'], '~56.0.4');
assert.equal(packageJson.dependencies['react-native-get-random-values'], '~1.11.0');
assert.equal(packageJson.devDependencies['@types/aes-js'], '^3.1.4');
assert.equal(packageLock.packages['node_modules/aes-js'].version, '3.1.2');
assert.equal(packageLock.packages['node_modules/expo-secure-store'].version, '56.0.4');
assert.equal(packageLock.packages['node_modules/react-native-get-random-values'].version, '1.11.0');

const asyncValues = new Map();
const secureValues = new Map();
const AsyncStorage = {
  getItem: async (key) => asyncValues.get(key) ?? null,
  setItem: async (key, value) => { asyncValues.set(key, value); },
  removeItem: async (key) => { asyncValues.delete(key); },
};
const SecureStore = {
  getItemAsync: async (key) => secureValues.get(key) ?? null,
  setItemAsync: async (key, value) => { secureValues.set(key, value); },
  deleteItemAsync: async (key) => { secureValues.delete(key); },
};

function loadStorage() {
  const exports = {};
  const compiled = ts.transpileModule(nativeStorage, {
    compilerOptions: {
      esModuleInterop: true,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;

  vm.runInNewContext(compiled, {
    console,
    crypto,
    exports,
    require: (name) => {
      if (name === '@react-native-async-storage/async-storage') return { default: AsyncStorage };
      if (name === 'aes-js') return require('aes-js');
      if (name === 'expo-secure-store') return SecureStore;
      if (name === 'react-native-get-random-values') return {};
      throw new Error(`Unexpected dependency: ${name}`);
    },
  });
  return exports.authStorage;
}

async function main() {
  const authStorage = loadStorage();
  const key = 'sb-test-auth-token';
  const session = JSON.stringify({ access_token: 'secret-access', refresh_token: 'secret-refresh' });

  await authStorage.setItem(key, session);
  assert.notEqual(asyncValues.get(key), session, 'AsyncStorage must not contain the plaintext session');
  assert.match(asyncValues.get(key), /^[0-9a-f]+$/, 'Encrypted session is stored as hex ciphertext');
  assert.match(secureValues.get(key), /^[0-9a-f]{64}$/, 'SecureStore contains only a 256-bit AES key');
  assert.equal(await authStorage.getItem(key), session, 'Encrypted session must round-trip');

  await authStorage.removeItem(key);
  assert.equal(asyncValues.has(key), false);
  assert.equal(secureValues.has(key), false);

  asyncValues.set(key, session);
  assert.equal(await authStorage.getItem(key), null, 'Legacy plaintext without a SecureStore key forces re-authentication');
  assert.equal(asyncValues.has(key), false, 'Legacy plaintext must be removed immediately');

  console.log('Native auth storage checks passed: Supabase sessions are encrypted at rest with a SecureStore-held key.');
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
