const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const nodeCrypto = require('node:crypto');

function createFakeAsyncStorage() {
  const store = new Map();
  return {
    store,
    getItem: async (key) => (store.has(key) ? store.get(key) : null),
    setItem: async (key, value) => { store.set(key, value); },
    removeItem: async (key) => { store.delete(key); },
  };
}

function createFakeSecureStore() {
  const store = new Map();
  return {
    store,
    getItemAsync: async (key) => (store.has(key) ? store.get(key) : null),
    setItemAsync: async (key, value) => { store.set(key, value); },
    deleteItemAsync: async (key) => { store.delete(key); },
  };
}

// A byte-XOR stand-in for expo-crypto's real AES-GCM. It exercises this module's own
// orchestration -- the key/ciphertext split across SecureStore and AsyncStorage, the
// combined-blob round trip, and the self-heal path -- without depending on expo-crypto's
// native implementation, which only runs on a real device.
function createFakeExpoCrypto() {
  function xor(bytes, key) {
    const out = new Uint8Array(bytes.length);
    for (let i = 0; i < bytes.length; i += 1) out[i] = bytes[i] ^ key[i % key.length];
    return out;
  }

  class FakeSealedData {
    constructor(bytes) { this.bytes = bytes; }
    async combined(encoding) {
      return encoding === 'base64' ? Buffer.from(this.bytes).toString('base64') : this.bytes;
    }
    static fromCombined(value) {
      const bytes = typeof value === 'string' ? new Uint8Array(Buffer.from(value, 'base64')) : value;
      return new FakeSealedData(bytes);
    }
  }

  class FakeEncryptionKey {
    constructor(bytes) { this.bytes_ = bytes; }
    static async generate() { return new FakeEncryptionKey(new Uint8Array(nodeCrypto.randomBytes(32))); }
    static async import(hex) { return new FakeEncryptionKey(new Uint8Array(Buffer.from(hex, 'hex'))); }
    async encoded() { return Buffer.from(this.bytes_).toString('hex'); }
  }

  return {
    AESEncryptionKey: FakeEncryptionKey,
    AESSealedData: FakeSealedData,
    aesEncryptAsync: async (bytes, key) => new FakeSealedData(xor(bytes, key.bytes_)),
    aesDecryptAsync: async (sealed, key) => xor(sealed.bytes, key.bytes_),
  };
}

function load(asyncStorage, secureStore, cryptoMock) {
  const source = fs.readFileSync(path.join(__dirname, '../src/lib/supabase/storage.native.ts'), 'utf8');
  const outputText = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exportsObject = {};
  const context = {
    exports: exportsObject,
    console,
    Buffer,
    require: (name) => {
      if (name === '@react-native-async-storage/async-storage') return { __esModule: true, default: asyncStorage };
      if (name === 'expo-secure-store') return secureStore;
      if (name === 'expo-crypto') return cryptoMock;
      assert.fail('Unexpected runtime dependency: ' + name);
    },
  };
  vm.runInNewContext(outputText, context);
  return exportsObject;
}

async function main() {
  // --- setItem/getItem round-trips a value, including non-ASCII profile data ---
  {
    const asyncStorage = createFakeAsyncStorage();
    const secureStore = createFakeSecureStore();
    const { authStorage } = load(asyncStorage, secureStore, createFakeExpoCrypto());

    const session = JSON.stringify({
      access_token: 'a'.repeat(400),
      refresh_token: 'b'.repeat(120),
      user: { user_metadata: { name: '정소연', bio: '취향 공유 앱 사용자 😀' } },
    });
    await authStorage.setItem('sb-session', session);
    assert.equal(await authStorage.getItem('sb-session'), session, 'Round trip must preserve the exact value, including Unicode');
  }

  // --- The AsyncStorage half is not the plaintext, and a key half exists in SecureStore ---
  {
    const asyncStorage = createFakeAsyncStorage();
    const secureStore = createFakeSecureStore();
    const { authStorage } = load(asyncStorage, secureStore, createFakeExpoCrypto());

    await authStorage.setItem('sb-session', 'super-secret-session-blob');
    assert.notEqual(asyncStorage.store.get('sb-session'), 'super-secret-session-blob', 'AsyncStorage must hold ciphertext, not the raw session');
    assert.ok(secureStore.store.get('sb-session'), 'SecureStore must hold a non-empty key half');
  }

  // --- getItem on a key that was never written returns null without touching SecureStore ---
  {
    const asyncStorage = createFakeAsyncStorage();
    const secureStore = createFakeSecureStore();
    let secureStoreReads = 0;
    const realGet = secureStore.getItemAsync;
    secureStore.getItemAsync = async (key) => { secureStoreReads += 1; return realGet(key); };
    const { authStorage } = load(asyncStorage, secureStore, createFakeExpoCrypto());

    assert.equal(await authStorage.getItem('never-written'), null);
    assert.equal(secureStoreReads, 0, 'A missing AsyncStorage half must short-circuit before checking SecureStore');
  }

  // --- removeItem clears both halves ---
  {
    const asyncStorage = createFakeAsyncStorage();
    const secureStore = createFakeSecureStore();
    const { authStorage } = load(asyncStorage, secureStore, createFakeExpoCrypto());

    await authStorage.setItem('sb-session', 'value');
    await authStorage.removeItem('sb-session');
    assert.equal(asyncStorage.store.has('sb-session'), false);
    assert.equal(secureStore.store.has('sb-session'), false);
  }

  // --- A desynced key half (Keychain reset, restore from backup) self-heals instead of throwing ---
  {
    const asyncStorage = createFakeAsyncStorage();
    const secureStore = createFakeSecureStore();
    const { authStorage } = load(asyncStorage, secureStore, createFakeExpoCrypto());

    await authStorage.setItem('sb-session', 'value');
    await secureStore.deleteItemAsync('sb-session'); // simulate the key half vanishing on its own
    assert.equal(await authStorage.getItem('sb-session'), null, 'A blob without its key must be treated as no session, not thrown');
    assert.equal(asyncStorage.store.has('sb-session'), false, 'The now-unrecoverable ciphertext half must be cleared too');
  }

  console.log('Secure storage checks passed: encrypted round trip, key/ciphertext split, missing-key short circuit, removeItem and desync self-heal.');
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
