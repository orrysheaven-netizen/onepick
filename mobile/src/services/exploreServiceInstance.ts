import { publicCountClient, supabase } from '@/lib/supabase/client';
import { fetchHomeRecentMenuRanking } from '@/lib/home/recentMenuRanking';
import { SupabaseCategoryRepository } from '@/repositories/supabase/supabaseCategoryRepository';
import { SupabaseReadRepository } from '@/repositories/supabase/supabaseReadRepository';
import { ExploreService } from './exploreService';

const categoryRepository=new SupabaseCategoryRepository(supabase);
const readRepository=new SupabaseReadRepository(supabase,publicCountClient);
export const exploreService=new ExploreService(categoryRepository,readRepository,fetchHomeRecentMenuRanking);
