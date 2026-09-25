import { publicCountClient, supabase } from '@/lib/supabase/client';
import { SupabaseCategoryRepository } from '@/repositories/supabase/supabaseCategoryRepository';
import { SupabaseFollowRepository } from '@/repositories/supabase/supabaseFollowRepository';
import { SupabaseItemRepository } from '@/repositories/supabase/supabaseItemRepository';
import { SupabasePickRepository } from '@/repositories/supabase/supabasePickRepository';
import { SupabaseReadRepository } from '@/repositories/supabase/supabaseReadRepository';

import { ExploreService } from './exploreService';
import { FollowService } from './followService';
import { HomeService } from './homeService';
import { ItemService } from './itemService';

// Home is latency-sensitive on web. Keep its initial dependency graph away from
// the broad services/repository barrels, which eagerly construct every external
// catalog service (movie/music/game/book/youtube/pokemon/place) even though Home
// does not use them before navigation.
const readRepository = new SupabaseReadRepository(supabase, publicCountClient);
const categoryRepository = new SupabaseCategoryRepository(supabase);
const followRepository = new SupabaseFollowRepository(supabase);
const itemRepository = new SupabaseItemRepository(supabase);
const pickRepository = new SupabasePickRepository(supabase);

export const homeService = new HomeService(readRepository);
export const exploreService = new ExploreService(categoryRepository, readRepository);
export const followService = new FollowService(followRepository, readRepository);
export const itemService = new ItemService(
  itemRepository,
  pickRepository,
  categoryRepository,
  readRepository,
);
