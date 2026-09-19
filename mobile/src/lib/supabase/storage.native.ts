import { deleteItemAsync, getItemAsync, setItemAsync } from 'expo-secure-store';

// Store Supabase access/refresh tokens in the platform Keychain/Keystore on native builds.
export const authStorage = {
  getItem: (key: string) => getItemAsync(key),
  setItem: (key: string, value: string) => {
    if (value.length > 2048) {
      console.warn('Supabase auth session exceeds 2048 bytes; verify SecureStore persistence on target devices.');
    }
    return setItemAsync(key, value);
  },
  removeItem: (key: string) => deleteItemAsync(key),
};
