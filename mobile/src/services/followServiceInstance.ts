import { publicCountClient, supabase } from '@/lib/supabase/client';
import { SupabaseFollowRepository } from '@/repositories/supabase/supabaseFollowRepository';
import { SupabaseReadRepository } from '@/repositories/supabase/supabaseReadRepository';
import { FollowService } from './followService';

const followRepository = new SupabaseFollowRepository(supabase);
const readRepository = new SupabaseReadRepository(supabase, publicCountClient);
export const followService = new FollowService(followRepository, readRepository);
