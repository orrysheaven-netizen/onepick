import 'react-native-url-polyfill/auto';
import 'expo-sqlite/localStorage/install';

import { createClient } from '@supabase/supabase-js';

import type { Database } from './database.types';
import { getSupabaseEnv } from './env';

const { url, publishableKey } = getSupabaseEnv();

export const supabase = createClient<Database>(url, publishableKey, {
  auth: {
    storage: localStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});

export type AppSupabaseClient = typeof supabase;
