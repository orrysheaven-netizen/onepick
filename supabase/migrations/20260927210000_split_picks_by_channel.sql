begin;

-- Menu picks are channel-scoped. Non-menu/legacy categories keep channel=null and
-- retain the old one-current-pick-per-category rule.
alter table public.picks
  add column if not exists channel text;

alter table public.picks
  drop constraint if exists picks_channel_check;
alter table public.picks
  add constraint picks_channel_check
    check (channel is null or channel in ('offline','online','recipe'));

alter table public.item_channels
  drop constraint if exists item_channels_channel_check;
alter table public.item_channels
  add constraint item_channels_channel_check
    check (channel in ('offline','online','recipe'));

-- Existing YouTube recipe rows are preserved as legacy recipe picks. We cannot
-- infer a concrete menu (미역국/김치찌개/...) from old data without guessing.
insert into public.item_channels(item_id,channel,target_url,is_primary)
select i.id,'recipe',i.official_url,
       not exists(select 1 from public.item_channels c where c.item_id=i.id and c.is_primary)
from public.items i
where i.external_source='youtube_video'
on conflict(item_id,channel) do update
set target_url=excluded.target_url,
    updated_at=now();

-- Backfill every existing current/history row without deleting or rewriting IDs.
-- Recipe identity wins; otherwise use the item's primary channel, then a stable
-- offline->online fallback. Rows outside channelized items remain null.
update public.picks p
set channel = case
  when i.external_source='youtube_video' or c.slug='recipe' then 'recipe'
  else (
    select ch.channel
    from public.item_channels ch
    where ch.item_id=p.item_id
      and ch.channel in ('offline','online')
    order by ch.is_primary desc, case ch.channel when 'offline' then 0 else 1 end
    limit 1
  )
end
from public.items i
join public.categories c on c.id=i.category_id
where i.id=p.item_id
  and p.channel is null;

drop index if exists public.picks_one_current_per_category;

create unique index if not exists picks_one_current_per_category_channel
  on public.picks(user_id,category_id,channel)
  where status in ('active','needs_review') and channel is not null;

create unique index if not exists picks_one_current_per_category_legacy
  on public.picks(user_id,category_id)
  where status in ('active','needs_review') and channel is null;

-- New channel-aware implementation. p_channel=null intentionally preserves the
-- old behavior for categories/items that do not use item_channels.
create or replace function private.change_pick_impl(
  p_category_id uuid,
  p_item_id uuid,
  p_one_line_review text,
  p_purchase_url text,
  p_purchase_tip text,
  p_channel text
)
returns public.picks
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_review text := btrim(p_one_line_review);
  v_fresh_url text := case when p_purchase_url is null then null
                           else private.normalize_purchase_url(p_purchase_url) end;
  v_url text;
  v_tip text;
  v_category public.categories%rowtype;
  v_item public.items%rowtype;
  v_current public.picks%rowtype;
  v_result public.picks%rowtype;
  v_new_pick_id uuid := gen_random_uuid();
  v_channel text := nullif(lower(btrim(coalesce(p_channel,''))),'');
begin
  if v_user_id is null then raise exception 'AUTH_REQUIRED' using errcode='P0001'; end if;
  if not exists(select 1 from public.profiles where id=v_user_id) then
    raise exception 'PROFILE_NOT_FOUND' using errcode='P0001';
  end if;
  if v_review is null or char_length(v_review)<1 or char_length(v_review)>100 then
    raise exception 'REVIEW_INVALID' using errcode='P0001';
  end if;
  if v_channel is not null and v_channel not in ('offline','online','recipe') then
    raise exception 'CHANNEL_INVALID' using errcode='P0001';
  end if;

  select * into v_category from public.categories where id=p_category_id;
  if not found then raise exception 'CATEGORY_NOT_FOUND' using errcode='P0001'; end if;
  if v_category.status<>'open' or v_category.is_pickable is not true
     or exists(select 1 from public.categories where parent_id=p_category_id) then
    raise exception 'CATEGORY_NOT_PICKABLE' using errcode='P0001';
  end if;

  select * into v_item from public.items where id=p_item_id;
  if not found then raise exception 'ITEM_NOT_FOUND' using errcode='P0001'; end if;
  if v_item.category_id<>p_category_id then
    raise exception 'ITEM_CATEGORY_MISMATCH' using errcode='P0001';
  end if;
  if v_item.status not in ('active','discontinued') then
    raise exception 'ITEM_NOT_ELIGIBLE' using errcode='P0001';
  end if;

  -- DB is deployed before the app. Older clients do not send p_channel, so
  -- infer the item's primary/single channel during the rollout instead of
  -- creating a parallel null-channel Pick.
  if v_channel is null then
    select ch.channel into v_channel
    from public.item_channels ch
    where ch.item_id=p_item_id
    order by ch.is_primary desc,
      case ch.channel when 'offline' then 0 when 'online' then 1 when 'recipe' then 2 else 3 end
    limit 1;
  end if;

  if v_channel is not null and not exists (
    select 1 from public.item_channels ch
    where ch.item_id=p_item_id and ch.channel=v_channel
  ) then
    raise exception 'ITEM_CHANNEL_MISMATCH' using errcode='P0001';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(v_user_id::text||':'||p_category_id::text||':'||coalesce(v_channel,'legacy'),0)
  );

  select * into v_current
  from public.picks
  where user_id=v_user_id
    and category_id=p_category_id
    and channel is not distinct from v_channel
    and status in ('active','needs_review')
  for update;

  if found and v_current.item_id=p_item_id then
    v_url := case when p_purchase_url is null then v_current.purchase_url else v_fresh_url end;
    v_tip := case
      when p_purchase_tip is not null then private.normalize_purchase_tip(p_purchase_tip, v_url)
      when v_url is null then null
      else v_current.purchase_tip
    end;

    update public.picks
    set one_line_review=v_review,purchase_url=v_url,purchase_tip=v_tip,
        status='active',ended_at=null,updated_at=now()
    where id=v_current.id
    returning * into v_result;
    return v_result;
  end if;

  v_url := v_fresh_url;
  v_tip := private.normalize_purchase_tip(p_purchase_tip, v_url);

  if found then
    update public.picks
    set status='replaced',ended_at=now(),replaced_by_pick_id=v_new_pick_id,updated_at=now()
    where id=v_current.id;
  end if;

  insert into public.picks(
    id,user_id,category_id,item_id,channel,one_line_review,purchase_url,purchase_tip,
    status,started_at,ended_at,replaced_by_pick_id
  ) values (
    v_new_pick_id,v_user_id,p_category_id,p_item_id,v_channel,v_review,v_url,v_tip,
    'active',now(),null,null
  )
  returning * into v_result;

  return v_result;
end;
$$;

-- Compatibility for internal callers such as register_pick_impl.
create or replace function private.change_pick_impl(
  p_category_id uuid,
  p_item_id uuid,
  p_one_line_review text,
  p_purchase_url text,
  p_purchase_tip text
)
returns public.picks
language sql
security definer
set search_path to ''
as $$
  select private.change_pick_impl(
    p_category_id,p_item_id,p_one_line_review,p_purchase_url,p_purchase_tip,null
  );
$$;

drop function if exists public.change_pick(uuid,uuid,text,text,text);
create function public.change_pick(
  p_category_id uuid,
  p_item_id uuid,
  p_one_line_review text,
  p_purchase_url text default null,
  p_purchase_tip text default null,
  p_channel text default null
)
returns public.picks
language sql
set search_path to ''
as $$
  select private.change_pick_impl(
    p_category_id,p_item_id,p_one_line_review,p_purchase_url,p_purchase_tip,p_channel
  );
$$;

revoke all on function private.change_pick_impl(uuid,uuid,text,text,text,text) from public,anon;
revoke all on function private.change_pick_impl(uuid,uuid,text,text,text) from public,anon;
revoke all on function public.change_pick(uuid,uuid,text,text,text,text) from public,anon;
grant execute on function private.change_pick_impl(uuid,uuid,text,text,text,text) to authenticated;
grant execute on function private.change_pick_impl(uuid,uuid,text,text,text) to authenticated;
grant execute on function public.change_pick(uuid,uuid,text,text,text,text) to authenticated,service_role;

-- Home feed filtering and labels follow the Pick channel, not every channel an
-- item happens to support. This makes offline/online/recipe coexist visibly.
drop function if exists public.home_pick_feed_page(timestamptz, uuid, text, text);
create function public.home_pick_feed_page(
  p_before_time timestamptz default null,
  p_before_id uuid default null,
  p_channel text default null,
  p_root_slug text default null
)
returns table(
  pick_id uuid, user_id uuid, username text, profile_image_url text,
  item_id uuid, item_name text, category_id uuid, category_name text,
  one_line_review text, thumbnail_path text, image_path text,
  image_source_url text, started_at timestamptz, channels text[]
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  if (p_before_time is null) <> (p_before_id is null) then
    raise exception 'INVALID_PAGINATION_CURSOR' using errcode = '22023';
  end if;
  if p_channel is not null and p_channel not in ('offline','online','recipe') then
    raise exception 'INVALID_CHANNEL' using errcode = '22023';
  end if;

  return query
  with open_leaf_categories as materialized (
    select c.id, c.name, coalesce(gp.slug,parent.slug,c.slug) as root_slug
    from public.categories c
    left join public.categories parent on parent.id=c.parent_id
    left join public.categories gp on gp.id=parent.parent_id
    where public.category_is_open_leaf(c.id)
  )
  select p.id,p.user_id,pr.username,pr.profile_image_url,
    i.id,i.name,c.id,c.name,p.one_line_review,
    i.thumbnail_path,i.image_path,i.image_source_url,p.started_at,
    case when p.channel is null then array[]::text[] else array[p.channel] end
  from public.picks p
  join public.profiles pr on pr.id=p.user_id
  join public.items i on i.id=p.item_id and i.category_id=p.category_id
  join open_leaf_categories c on c.id=p.category_id
  where p.status='active'
    and p.user_id is distinct from (select auth.uid())
    and not private.user_is_suspended(p.user_id)
    and i.status in ('active','discontinued')
    and (p_root_slug is null or c.root_slug=p_root_slug)
    and (p_before_time is null or (p.started_at,p.id)<(p_before_time,p_before_id))
    and (p_channel is null or p.channel=p_channel)
  order by p.started_at desc,p.id desc
  limit 21;
end;
$$;

revoke all on function public.home_pick_feed_page(timestamptz,uuid,text,text) from public;
grant execute on function public.home_pick_feed_page(timestamptz,uuid,text,text) to anon,authenticated,service_role;

commit;
