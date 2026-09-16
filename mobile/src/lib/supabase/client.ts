import 'react-native-url-polyfill/auto';

import { createClient } from '@supabase/supabase-js';

import type { AppDatabase } from './database.overrides';
import { getSupabaseEnv } from './env';
import { authStorage } from './storage';

const { url, publishableKey } = getSupabaseEnv();

export const supabase = createClient<AppDatabase>(url, publishableKey, {
  auth: {
    storage: authStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});

export type AppSupabaseClient = typeof supabase;
