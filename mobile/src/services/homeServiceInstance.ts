import { publicCountClient, supabase } from '@/lib/supabase/client';
import { SupabaseReadRepository } from '@/repositories/supabase/supabaseReadRepository';
import { HomeService } from './homeService';

const readRepository = new SupabaseReadRepository(supabase, publicCountClient);
export const homeService = new HomeService(readRepository);
