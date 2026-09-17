import { supabase } from '@/lib/supabase/client';

import { SupabaseAdminRepository } from './supabaseAdminRepository';
import { SupabaseAuthRepository } from './supabaseAuthRepository';
import { SupabaseCategoryRepository } from './supabaseCategoryRepository';
import { SupabaseCommentRepository } from './supabaseCommentRepository';
import { SupabasePickRepository } from './supabasePickRepository';
import { SupabaseProductRepository } from './supabaseProductRepository';
import { SupabaseProfileRepository } from './supabaseProfileRepository';
import { SupabasePhotoRepository } from './supabasePhotoRepository';
import { SupabaseReadRepository } from './supabaseReadRepository';
import { SupabaseSafetyRepository } from './supabaseSafetyRepository';

export const adminRepository = new SupabaseAdminRepository(supabase);
export const authRepository = new SupabaseAuthRepository(supabase);
export const categoryRepository = new SupabaseCategoryRepository(supabase);
export const commentRepository = new SupabaseCommentRepository(supabase);
export const productRepository = new SupabaseProductRepository(supabase);
export const pickRepository = new SupabasePickRepository(supabase);
export const profileRepository = new SupabaseProfileRepository(supabase);
export const photoRepository = new SupabasePhotoRepository(supabase);
export const readRepository = new SupabaseReadRepository(supabase);
export const safetyRepository = new SupabaseSafetyRepository(supabase);

export {
  SupabaseAdminRepository,
  SupabaseAuthRepository,
  SupabaseCategoryRepository,
  SupabaseCommentRepository,
  SupabasePickRepository,
  SupabaseProductRepository,
  SupabaseProfileRepository,
  SupabaseReadRepository,
  SupabaseSafetyRepository,
};
