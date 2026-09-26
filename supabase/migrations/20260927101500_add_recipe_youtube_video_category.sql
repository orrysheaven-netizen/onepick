begin;

-- 레시피: a food leaf whose Picks are YouTube recipe videos. A shared video link is
-- resolved by the youtube-catalog Edge Function (video_lookup / video_import) into one
-- item per video ID (external_source='youtube_video').

insert into public.categories(parent_id,name,slug,status,is_visible,is_pickable,sort_order)
select p.id,'레시피','recipe','open',true,true,200
from public.categories p
where p.slug='food'
on conflict(slug) do update set
  parent_id=excluded.parent_id,
  name=excluded.name,
  status='open',
  is_visible=true,
  is_pickable=true,
  sort_order=excluded.sort_order,
  updated_at=now();

do $$
begin
  if not exists(select 1 from public.categories where slug='recipe') then
    raise exception 'FOOD_CATEGORY_REQUIRED';
  end if;
end;
$$;

insert into public.category_catalog_sources(
  category_id,mode,provider,edge_function_slug,external_source,is_enabled,place_catalog_enabled,notes
)
select c.id,'external','youtube','youtube-catalog','youtube_video',true,false,
       'YouTube recipe videos, registered from a shared video link'
from public.categories c
where c.slug='recipe'
on conflict(category_id) do update set
  mode='external',
  provider='youtube',
  edge_function_slug='youtube-catalog',
  external_source='youtube_video',
  is_enabled=true,
  place_catalog_enabled=false,
  notes=excluded.notes,
  updated_at=now();

insert into public.category_taste_dimensions(category_id,dimension_code,weight)
select c.id,'food',100
from public.categories c
where c.slug='recipe'
on conflict do nothing;

with seed(category_slug,term,kind) as (
  values
  ('recipe','요리','tag'),
  ('recipe','집밥','tag'),
  ('recipe','요리 영상','tag'),
  ('recipe','레시피 영상','alias')
)
insert into public.category_search_terms(category_id,term,kind)
select c.id,s.term,s.kind
from seed s
join public.categories c on c.slug=s.category_slug
on conflict(category_id,lower(term)) do update set kind=excluded.kind;

-- Video metadata is Non-Authorized YouTube API Data, like channel metadata: refresh
-- it or remove it before the 30-day policy limit.
create or replace function private.scrub_stale_youtube_api_data()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare v_count integer;
begin
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
    and (external_refreshed_at is null or external_refreshed_at < now()-interval '25 days');
  get diagnostics v_count = row_count;

  delete from public.external_catalog_cache
  where provider='youtube'
    and fetched_at < now()-interval '25 days';

  return v_count;
end;
$$;

revoke all on function private.scrub_stale_youtube_api_data() from public,anon,authenticated;

commit;
