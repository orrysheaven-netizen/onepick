import AsyncStorage from '@react-native-async-storage/async-storage';

// Persist the Supabase session so Kakao login survives an app restart.
export const authStorage = AsyncStorage;
