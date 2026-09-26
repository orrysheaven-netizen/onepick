begin;

-- Recipes are the third channel of a dish (미역국 · 오프라인 맛집 / 온라인 맛집 /
-- 레시피) instead of one 레시피 category. A shared video is registered under the
-- dish the member confirms; its item carries a recipe channel pointing at the video.
-- Requires 20260927130000_add_pick_channel (picks.channel, item_channels recipe).

-- Dishes a video title mentions, longest match first: "초간단 미역국 끓이는 법" →
-- 미역국. Names and search terms are compared without spaces or punctuation.
create or replace function public.recipe_dish_suggestions(p_title text)
returns table(category_id uuid, name text, path text, matched_term text)
language sql
stable
security definer
set search_path = ''
as $$
  with title as (
    select regexp_replace(lower(coalesce(p_title,'')), '[[:space:][:punct:]]', '', 'g') as v
  ),
  dishes as (
    select c.id, c.name
    from public.categories c
    where public.category_is_open_leaf(c.id)
      and private.category_is_food(c.id)
      and c.slug <> 'recipe'
  ),
  terms as (
    select d.id, d.name, d.name as term from dishes d
    union all
    select d.id, d.name, t.term
    from dishes d
    join public.category_search_terms t on t.category_id = d.id
  ),
  matches as (
    select t.id, t.name, t.term,
      char_length(regexp_replace(lower(t.term), '[[:space:][:punct:]]', '', 'g')) as matched_length
    from terms t, title
    where char_length(regexp_replace(lower(t.term), '[[:space:][:punct:]]', '', 'g')) >= 2
      and position(regexp_replace(lower(t.term), '[[:space:][:punct:]]', '', 'g') in title.v) > 0
  ),
  best as (
    select distinct on (m.id) m.id, m.name, m.term, m.matched_length
    from matches m
    order by m.id, m.matched_length desc, m.term
  )
  select b.id, b.name, public.category_path(b.id), b.term
  from best b
  order by b.matched_length desc, b.name
  limit 5;
$$;

revoke all on function public.recipe_dish_suggestions(text) from public, anon;
grant execute on function public.recipe_dish_suggestions(text) to authenticated, service_role;

-- Whether a recipe video can be registered under this dish.
create or replace function public.category_accepts_recipe(p_category_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.category_is_open_leaf(p_category_id)
    and private.category_is_food(p_category_id)
    and not exists (
      select 1 from public.categories c
      where c.id = p_category_id and c.slug in ('recipe','pending-product')
    );
$$;

revoke all on function public.category_accepts_recipe(uuid) from public, anon;
grant execute on function public.category_accepts_recipe(uuid) to authenticated, service_role;

-- A recipe item's channel link is the video URL, so the stale-data scrub clears it
-- together with the rest of the video metadata.
create or replace function private.scrub_stale_youtube_api_data()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare v_count integer;
begin
  with scrubbed as (
    update public.items
    set
      name=case when external_source='youtube_video'
        then 'YouTube 영상 · 정보 갱신 필요' else 'YouTube 채널 · 정보 갱신 필요' end,
      normalized_name=case when external_source='youtube_video'
        then 'youtube영상정보갱신필요' else 'youtube채널정보갱신필요' end,
      official_url=null,
      image_source_url=null,
      external_source=null,
      external_id=null,
      original_name=null,
      release_year=null,
      creator_name=null,
      collection_name=null,
      external_refreshed_at=null,
      status='discontinued',
      updated_at=now()
    where external_source in ('youtube_channel','youtube_video')
      and (external_refreshed_at is null or external_refreshed_at < now()-interval '25 days')
    returning id
  ),
  links as (
    update public.item_channels ch
    set target_url=null, updated_at=now()
    from scrubbed
    where ch.item_id=scrubbed.id and ch.channel='recipe' and ch.target_url is not null
    returning ch.item_id
  )
  select count(*) into v_count from scrubbed;

  delete from public.external_catalog_cache
  where provider='youtube'
    and fetched_at < now()-interval '25 days';

  return v_count;
end;
$$;

revoke all on function private.scrub_stale_youtube_api_data() from public, anon, authenticated;

-- The single 레시피 category is retired. Its items and Picks stay in place (the
-- owner removes them); it no longer shows up or takes new Picks.
update public.categories
set status = 'paused', is_visible = false, is_pickable = false, updated_at = now()
where slug = 'recipe';

update public.category_catalog_sources s
set is_enabled = false, updated_at = now()
from public.categories c
where c.id = s.category_id and c.slug = 'recipe';

commit;
