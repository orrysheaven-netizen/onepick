import { supabase } from '@/lib/supabase/client';

import { SupabaseCategoryRepository } from './supabaseCategoryRepository';
import { SupabasePickRepository } from './supabasePickRepository';
import { SupabaseProductRepository } from './supabaseProductRepository';
import { SupabaseProfileRepository } from './supabaseProfileRepository';

export const categoryRepository = new SupabaseCategoryRepository(supabase);
export const productRepository = new SupabaseProductRepository(supabase);
export const pickRepository = new SupabasePickRepository(supabase);
export const profileRepository = new SupabaseProfileRepository(supabase);

export {
  SupabaseCategoryRepository,
  SupabasePickRepository,
  SupabaseProductRepository,
  SupabaseProfileRepository,
};
