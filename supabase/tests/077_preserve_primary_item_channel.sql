begin;

create extension if not exists pgtap with schema extensions;
select no_plan();

insert into auth.users(id,aud,role,email,encrypted_password,created_at,updated_at)
values(
  'f9960000-0000-4000-8000-000000000001',
  'authenticated',
  'authenticated',
  'place-channel-user@example.invalid',
  '',
  now(),
  now()
);

insert into public.profiles(id,username,onboarding_completed)
values(
  'f9960000-0000-4000-8000-000000000001',
  'place_channel_user',
  true
);

insert into public.categories(id,name,slug,status,is_visible,is_pickable)
values(
  'f9961000-0000-4000-8000-000000000001',
  '대표 채널 테스트',
  'primary-channel-sec',
  'open',
  true,
  true
);

insert into public.category_catalog_sources(
  category_id,mode,is_enabled,place_catalog_enabled,notes
) values(
  'f9961000-0000-4000-8000-000000000001',
  'internal',
  true,
  true,
  'Security QA primary channel fixture'
);

insert into public.place_catalog(
  id,place_provider,provider_place_id,name,normalized_name,road_address,
  region_1,region_2,business_status,source_updated_at
) values(
  'f9962000-0000-4000-8000-000000000001',
  'securityqa',
  'primary-channel-place',
  '대표채널식당',
  '대표채널식당',
  '서울 테스트구 대표로 1',
  '서울',
  '테스트구',
  'open',
  now()
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub','f9960000-0000-4000-8000-000000000001',
    'role','authenticated',
    'aal','aal1'
  )::text,
  true
);
select set_config('request.jwt.claim.sub','f9960000-0000-4000-8000-000000000001',true);

create temporary table channel_item as
select id as item_id
from public.select_place_catalog_item(
  'f9961000-0000-4000-8000-000000000001',
  'f9962000-0000-4000-8000-000000000001'
);

reset role;

-- place_catalog intentionally has no map_url. The user-selection flow
-- materializes public.places first; then a trusted source/admin may enrich the
-- canonical place URL before a later reselection refreshes the offline channel.
update public.places
set map_url='https://maps.example/place'
where id=(
  select ip.place_id
  from public.item_places ip
  where ip.item_id=(select item_id from channel_item)
);

select ok(
  exists(
    select 1
    from public.item_channels
    where item_id=(select item_id from channel_item)
      and channel='offline'
      and is_primary
  ),
  'initial user selection creates the offline primary channel'
);

-- Model an administrator/system-curated representative channel. This setup runs
-- as the test owner, the same trusted context used by migrations/admin routines.
update public.item_channels
set is_primary=false
where item_id=(select item_id from channel_item)
  and channel='offline';

insert into public.item_channels(item_id,channel,target_url,is_primary)
select item_id,'online','https://official.example/store',true
from channel_item;

select ok(
  exists(
    select 1
    from public.item_channels
    where item_id=(select item_id from channel_item)
      and channel='online'
      and is_primary
  ),
  'trusted setup establishes a curated online primary channel'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub','f9960000-0000-4000-8000-000000000001',
    'role','authenticated',
    'aal','aal1'
  )::text,
  true
);
select set_config('request.jwt.claim.sub','f9960000-0000-4000-8000-000000000001',true);

select lives_ok(
  $$select public.select_place_catalog_item(
      'f9961000-0000-4000-8000-000000000001',
      'f9962000-0000-4000-8000-000000000001'
    )$$,
  'ordinary user may reselect the same catalog place'
);

reset role;

select ok(
  exists(
    select 1
    from public.item_channels
    where item_id=(select item_id from channel_item)
      and channel='online'
      and target_url='https://official.example/store'
      and is_primary
  ),
  'user reselection preserves the curated non-offline primary'
);

select ok(
  exists(
    select 1
    from public.item_channels
    where item_id=(select item_id from channel_item)
      and channel='offline'
      and target_url='https://maps.example/place'
      and not is_primary
  ),
  'offline channel is refreshed without taking over primary status'
);

select is(
  (
    select count(*)::int
    from public.item_channels
    where item_id=(select item_id from channel_item)
      and is_primary
  ),
  1,
  'exactly one representative channel remains primary'
);

select * from finish();
rollback;
