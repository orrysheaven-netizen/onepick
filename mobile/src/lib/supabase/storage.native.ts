import AsyncStorage from '@react-native-async-storage/async-storage';
import { AESEncryptionKey, AESSealedData, aesDecryptAsync, aesEncryptAsync } from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';

// expo-secure-store (iOS Keychain / Android Keystore) has historically rejected values over
// roughly 2048 bytes, and a Supabase session (JWT access token + refresh token + user
// metadata) routinely exceeds that. So only a fresh AES-256 key lives in SecureStore; the
// session itself, AES-GCM encrypted with that key, lives in AsyncStorage -- unreadable to
// anything that only has the AsyncStorage half.
//
// encodeURIComponent/decodeURIComponent (not TextEncoder or btoa, whose availability is less
// certain across Hermes versions) do the UTF-8 <-> byte conversion, since the session JSON can
// contain non-ASCII profile fields (e.g. a Korean display name from Kakao login).
function utf8ToBytes(text: string): Uint8Array {
  const binary = unescape(encodeURIComponent(text));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function bytesToUtf8(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
  return decodeURIComponent(escape(binary));
}

class LargeSecureStore {
  private async encrypt(key: string, value: string): Promise<string> {
    const encryptionKey = await AESEncryptionKey.generate(256);
    const sealed = await aesEncryptAsync(utf8ToBytes(value), encryptionKey as AESEncryptionKey);
    await SecureStore.setItemAsync(key, await (encryptionKey as AESEncryptionKey).encoded('hex'));
    return sealed.combined('base64');
  }

  private async decrypt(key: string, value: string): Promise<string> {
    const keyHex = await SecureStore.getItemAsync(key);
    if (!keyHex) throw new Error('Missing encryption key for a stored value');
    const encryptionKey = await AESEncryptionKey.import(keyHex, 'hex');
    const sealed = AESSealedData.fromCombined(value);
    const plaintextBytes = await aesDecryptAsync(sealed, encryptionKey as AESEncryptionKey);
    return bytesToUtf8(plaintextBytes);
  }

  async getItem(key: string) {
    const encrypted = await AsyncStorage.getItem(key);
    if (!encrypted) return encrypted;
    try {
      return await this.decrypt(key, encrypted);
    } catch (err) {
      // The SecureStore key half and the AsyncStorage ciphertext half got out of sync -- a
      // Keychain reset, a restore from backup, a partially completed write. A blob without
      // its key is unrecoverable, so this is treated the same as no session (signing the
      // user out) rather than thrown, instead of failing the same way on every launch.
      console.warn('[LargeSecureStore] getItem failed, clearing both halves', err);
      await this.removeItem(key);
      return null;
    }
  }

  async removeItem(key: string) {
    await AsyncStorage.removeItem(key);
    await SecureStore.deleteItemAsync(key);
  }

  async setItem(key: string, value: string) {
    const encrypted = await this.encrypt(key, value);
    await AsyncStorage.setItem(key, encrypted);
  }
}

// Persist the Supabase session so Kakao login survives an app restart.
export const authStorage = new LargeSecureStore();
