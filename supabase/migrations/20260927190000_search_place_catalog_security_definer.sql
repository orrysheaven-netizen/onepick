-- Guests (anon) still waited 1.5–3 s for place search after the bigram index
-- (20260927180000), and some calls hit the 3 s statement_timeout. Under RLS the
-- planner may not evaluate non-leakproof quals (the bigram `@>`, trigram `%`)
-- before the policy filter, so it could not use either index and scanned all
-- ~368k rows. The same query takes ~5 ms for the table owner.
--
-- search_place_catalog already applies every read policy it relies on:
--   place_catalog  business_status = 'open'
--   places         is_visible
--   items          status in ('active','discontinued')
--   item_places    item active/discontinued and place visible (implied by the joins)
-- so running it as the owner returns exactly what a guest may see (checked on
-- 85 queries against the real Seoul/Gyeonggi/Incheon data), with index plans.

begin;

alter function public.search_place_catalog(uuid,text,integer) security definer;

commit;
