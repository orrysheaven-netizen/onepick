-- 20260919135818_keep_profile_ai_review_visible_while_stale changed
-- private.invalidate_profile_ai_sources() to keep the last published review
-- visible (is_visible stays true) while marking it is_stale. The check
-- constraint from 20260919021257 (`not is_visible or not is_stale`) was left in
-- place, so the trigger's UPDATE failed for every profile with a visible review
-- and rolled back the pick write that fired it: those users could not register,
-- change or remove a pick ("원픽을 저장하지 못했어요"). The stale-but-visible
-- state is intended, so the constraint goes.
alter table public.profile_ai_reviews
  drop constraint if exists profile_ai_reviews_no_stale_publication;
