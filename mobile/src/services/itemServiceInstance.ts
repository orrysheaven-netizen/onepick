import { publicCountClient, supabase } from '@/lib/supabase/client';
import { SupabaseCategoryRepository } from '@/repositories/supabase/supabaseCategoryRepository';
import { SupabaseItemRepository } from '@/repositories/supabase/supabaseItemRepository';
import { SupabasePickRepository } from '@/repositories/supabase/supabasePickRepository';
import { SupabaseReadRepository } from '@/repositories/supabase/supabaseReadRepository';
import { ItemService } from './itemService';

const itemRepository = new SupabaseItemRepository(supabase);
const pickRepository = new SupabasePickRepository(supabase);
const categoryRepository = new SupabaseCategoryRepository(supabase);
const readRepository = new SupabaseReadRepository(supabase, publicCountClient);

export const itemService = new ItemService(
  itemRepository,
  pickRepository,
  categoryRepository,
  readRepository,
);
