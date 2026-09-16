import { supabase } from '@/lib/supabase/client';

import { SupabaseAuthRepository } from './supabaseAuthRepository';
import { SupabaseCategoryRepository } from './supabaseCategoryRepository';
import { SupabasePickRepository } from './supabasePickRepository';
import { SupabaseProductRepository } from './supabaseProductRepository';
import { SupabaseProfileRepository } from './supabaseProfileRepository';

export const authRepository = new SupabaseAuthRepository(supabase);
export const categoryRepository = new SupabaseCategoryRepository(supabase);
export const productRepository = new SupabaseProductRepository(supabase);
export const pickRepository = new SupabasePickRepository(supabase);
export const profileRepository = new SupabaseProfileRepository(supabase);

export {
  SupabaseAuthRepository,
  SupabaseCategoryRepository,
  SupabasePickRepository,
  SupabaseProductRepository,
  SupabaseProfileRepository,
};
