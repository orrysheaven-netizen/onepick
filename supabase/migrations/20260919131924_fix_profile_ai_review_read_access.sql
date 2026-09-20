drop policy if exists profile_ai_reviews_profile_access
         on public.profile_ai_reviews;

         grant select on table public.system_actors to anon, authenticated;
         grant select on table public.profile_ai_reviews to anon, authenticated;
         grant update (is_visible) on table public.profile_ai_reviews to authenticated;
