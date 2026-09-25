import { supabase } from '@/lib/supabase/client';
import { SupabaseLinkCategorySuggestionRepository } from '@/repositories/supabase/supabaseLinkCategorySuggestionRepository';
import { LinkCategorySuggestionService } from './linkCategorySuggestionService';

const repository = new SupabaseLinkCategorySuggestionRepository(supabase);
export const linkCategorySuggestionService = new LinkCategorySuggestionService(repository);
