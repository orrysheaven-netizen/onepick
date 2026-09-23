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
    flowType: 'pkce',
  },
});

export type AppSupabaseClient = typeof supabase;

// Public aggregate reads use the existing anonymous read policy, without a user session.
export const publicCountClient = createClient<AppDatabase>(url, publishableKey, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey: 'onepick-public-counts' },
});
