
create or replace function private.validate_category_tree()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_parent public.categories%rowtype;
  v_parent_depth integer := 0;
  v_descendant_span integer := 0;
begin
  perform pg_advisory_xact_lock(hashtextextended('category-tree', 0));

  if char_length(btrim(new.name)) not between 1 and 60
     or char_length(new.slug) > 80
     or new.slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$'
     or abs(new.sort_order::bigint) > 100000
     or new.ranking_min_sample < 1
  then
    raise exception 'CATEGORY_INVALID' using errcode='P0001';
  end if;

  if tg_op='UPDATE' and new.slug is distinct from old.slug then
    raise exception 'CATEGORY_INVALID' using errcode='P0001';
  end if;

  if new.parent_id = new.id then
    raise exception 'CATEGORY_INVALID' using errcode='P0001';
  end if;

  if new.parent_id is not null then
    select * into v_parent from public.categories where id = new.parent_id;
    if not found or v_parent.is_pickable then
      raise exception 'CATEGORY_INVALID' using errcode='P0001';
    end if;

    if tg_op='UPDATE' and exists (
      with recursive descendants as (
        select c.id from public.categories c where c.parent_id = new.id
        union all
        select c.id from public.categories c join descendants d on c.parent_id = d.id
      )
      select 1 from descendants where id = new.parent_id
    ) then
      raise exception 'CATEGORY_INVALID' using errcode='P0001';
    end if;

    with recursive ancestors as (
      select c.id, c.parent_id, 1 as depth
      from public.categories c where c.id = new.parent_id
      union all
      select p.id, p.parent_id, a.depth + 1
      from public.categories p
      join ancestors a on p.id = a.parent_id
      where a.depth < 4
    )
    select coalesce(max(depth), 0) into v_parent_depth from ancestors;

    if v_parent_depth >= 3 then
      raise exception 'CATEGORY_INVALID' using errcode='P0001';
    end if;
  end if;

  if tg_op='UPDATE' then
    with recursive descendants as (
      select c.id, 1 as depth from public.categories c where c.parent_id = new.id
      union all
      select c.id, d.depth + 1
      from public.categories c
      join descendants d on c.parent_id = d.id
      where d.depth < 3
    )
    select coalesce(max(depth), 0) into v_descendant_span from descendants;
  end if;

  if v_parent_depth + 1 + v_descendant_span > 3 then
    raise exception 'CATEGORY_INVALID' using errcode='P0001';
  end if;

  if new.is_pickable
     and exists(select 1 from public.categories where parent_id = new.id) then
    raise exception 'CATEGORY_INVALID' using errcode='P0001';
  end if;

  return new;
end;
$$;
revoke all on function private.validate_category_tree() from public, anon, authenticated;

create or replace function public.category_is_open_leaf(p_category_id uuid)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  with recursive lineage as (
    select c.id, c.parent_id, c.status, c.is_visible, c.is_pickable,
           1 as depth, array[c.id] as seen
    from public.categories c
    where c.id = p_category_id
    union all
    select p.id, p.parent_id, p.status, p.is_visible, p.is_pickable,
           l.depth + 1, l.seen || p.id
    from public.categories p
    join lineage l on p.id = l.parent_id
    where l.depth < 4 and not p.id = any(l.seen)
  )
  select coalesce(
    (
      select max(depth) <= 3
        and bool_or(parent_id is null)
        and bool_and(
          status = 'open'
          and is_visible
          and case when depth = 1 then is_pickable else not is_pickable end
        )
      from lineage
    )
    and not exists (
      select 1 from public.categories child where child.parent_id = p_category_id
    ),
    false
  );
$$;
revoke all on function public.category_is_open_leaf(uuid) from public;
grant execute on function public.category_is_open_leaf(uuid) to anon, authenticated, service_role;

create or replace function public.category_path(p_category_id uuid)
returns text
language sql
stable
security invoker
set search_path = ''
as $$
  with recursive lineage as (
    select c.id, c.parent_id, c.name, 1 as depth, array[c.id] as seen
    from public.categories c
    where c.id = p_category_id
    union all
    select p.id, p.parent_id, p.name, l.depth + 1, l.seen || p.id
    from public.categories p
    join lineage l on p.id = l.parent_id
    where l.depth < 4 and not p.id = any(l.seen)
  ),
  validity as (
    select max(depth) as max_depth, bool_or(parent_id is null) as reaches_root
    from lineage
  )
  select case
    when validity.max_depth <= 3 and validity.reaches_root
      then (select string_agg(name, ' › ' order by depth desc) from lineage)
    else null
  end
  from validity;
$$;
revoke all on function public.category_path(uuid) from public;
grant execute on function public.category_path(uuid) to anon, authenticated, service_role;

create or replace function private.category_accepts_picks(p_category_id uuid)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select public.category_is_open_leaf(p_category_id);
$$;
revoke all on function private.category_accepts_picks(uuid) from public, anon, authenticated;

drop policy if exists item_aliases_anon_read on public.item_aliases;
create policy item_aliases_anon_read
on public.item_aliases for select to anon
using (
  exists (
    select 1 from public.items i
    where i.id = item_id
      and i.status in ('active','discontinued')
      and public.category_is_open_leaf(i.category_id)
  )
);

drop policy if exists item_aliases_authenticated_read on public.item_aliases;
create policy item_aliases_authenticated_read
on public.item_aliases for select to authenticated
using (
  (select private.is_admin_mfa())
  or exists (
    select 1 from public.items i
    where i.id = item_id
      and i.status in ('active','discontinued')
      and public.category_is_open_leaf(i.category_id)
  )
);

create or replace function public.search_items(
  p_query text,
  p_category_ids uuid[] default null,
  p_limit integer default 20
)
returns setof public.items
language sql
stable
security invoker
set search_path = ''
as $$
  with params as (
    select
      lower(regexp_replace(btrim(coalesce(p_query,'')),'[[:space:]]+','','g')) as q,
      least(greatest(coalesce(p_limit,20),1),50) as safe_limit
  ),
  ranked as (
    select
      i.*,
      case
        when i.normalized_name=params.q then 0
        when coalesce(alias_match.exact_match,false) then 1
        when i.normalized_name like params.q||'%' then 2
        when coalesce(alias_match.prefix_match,false) then 3
        when i.normalized_name like '%'||params.q||'%' then 4
        when coalesce(alias_match.contains_match,false) then 5
        else 6
      end as match_rank,
      greatest(
        extensions.similarity(i.normalized_name,params.q),
        coalesce(alias_match.best_similarity,0)
      ) as similarity_score
    from public.items i
    join public.categories c on c.id=i.category_id
    cross join params
    left join lateral (
      select
        bool_or(ia.normalized_alias=params.q) as exact_match,
        bool_or(ia.normalized_alias like params.q||'%') as prefix_match,
        bool_or(ia.normalized_alias like '%'||params.q||'%') as contains_match,
        max(extensions.similarity(ia.normalized_alias,params.q)) as best_similarity
      from public.item_aliases ia
      where ia.item_id=i.id
        and (
          ia.normalized_alias like '%'||params.q||'%'
          or ia.normalized_alias operator(extensions.%) params.q
        )
    ) alias_match on true
    where params.q<>''
      and i.status in ('active','discontinued')
      and (p_category_ids is null or i.category_id=any(p_category_ids))
      and public.category_is_open_leaf(c.id)
      and (
        i.normalized_name like '%'||params.q||'%'
        or i.normalized_name operator(extensions.%) params.q
        or coalesce(alias_match.exact_match,false)
        or coalesce(alias_match.prefix_match,false)
        or coalesce(alias_match.contains_match,false)
        or coalesce(alias_match.best_similarity,0)>=0.2
      )
  )
  select
    id,category_id,brand_id,name,normalized_name,model_code,official_url,status,
    merged_into_item_id,created_by,created_at,updated_at,image_path,thumbnail_path,
    image_source_url,external_source,external_id,original_name,release_year,
    creator_name,collection_name,external_refreshed_at,market_availability_status
  from ranked
  order by match_rank,similarity_score desc,name
  limit (select safe_limit from params);
$$;

create or replace function public.category_top_items(p_category_id uuid)
returns table(
  item_id uuid, name text, thumbnail_path text, pick_count bigint,
  rank bigint, is_tied boolean, image_path text, image_source_url text
)
language sql stable security invoker set search_path = ''
as $$
  with totals as (
    select i.id, i.name, i.thumbnail_path, i.image_path, i.image_source_url, count(*) as pick_count
    from public.picks p
    join public.items i on i.id = p.item_id and i.category_id = p.category_id
    where p.category_id = p_category_id
      and p.status = 'active'
      and not private.user_is_suspended(p.user_id)
      and i.status in ('active', 'discontinued')
      and public.category_is_open_leaf(p.category_id)
    group by i.id
  )
  select t.id, t.name, t.thumbnail_path, t.pick_count,
    rank() over (order by t.pick_count desc),
    count(*) over (partition by t.pick_count) > 1,
    t.image_path, t.image_source_url
  from totals t
  order by t.pick_count desc, t.name, t.id
  limit 3;
$$;

create or replace function public.category_top_items_v2(p_category_id uuid)
returns table(
  item_id uuid, name text, thumbnail_path text, pick_count bigint,
  rank bigint, is_tied boolean, image_path text, image_source_url text,
  official_url text, market_availability_status text
)
language sql stable security invoker set search_path = ''
as $$
  with totals as (
    select i.id, i.name, i.thumbnail_path, i.image_path, i.image_source_url,
      i.official_url, i.market_availability_status, count(*) as pick_count
    from public.picks p
    join public.items i on i.id=p.item_id and i.category_id=p.category_id
    where p.category_id=p_category_id
      and p.status='active'
      and not private.user_is_suspended(p.user_id)
      and i.status in ('active','discontinued')
      and public.category_is_open_leaf(p.category_id)
    group by i.id
  )
  select t.id, t.name, t.thumbnail_path, t.pick_count,
    rank() over(order by t.pick_count desc),
    count(*) over(partition by t.pick_count)>1,
    t.image_path, t.image_source_url, t.official_url, t.market_availability_status
  from totals t
  order by t.pick_count desc,t.name,t.id
  limit 3;
$$;

create or replace function public.home_pick_feed_page(
  p_before_time timestamptz default null,
  p_before_id uuid default null
)
returns table(
  pick_id uuid, user_id uuid, username text, profile_image_url text,
  item_id uuid, item_name text, category_id uuid, category_name text,
  one_line_review text, thumbnail_path text, image_path text,
  image_source_url text, started_at timestamptz
)
language plpgsql stable security invoker set search_path = ''
as $$
begin
  if (p_before_time is null) <> (p_before_id is null) then
    raise exception 'INVALID_PAGINATION_CURSOR' using errcode = '22023';
  end if;
  return query
  select p.id, p.user_id, pr.username, pr.profile_image_url,
    i.id, i.name, c.id, c.name, p.one_line_review,
    i.thumbnail_path, i.image_path, i.image_source_url, p.started_at
  from public.picks p
  join public.profiles pr on pr.id = p.user_id
  join public.items i on i.id = p.item_id and i.category_id = p.category_id
  join public.categories c on c.id = p.category_id
  where p.status = 'active'
    and p.user_id is distinct from (select auth.uid())
    and not private.user_is_suspended(p.user_id)
    and i.status in ('active', 'discontinued')
    and public.category_is_open_leaf(c.id)
    and (p_before_time is null or (p.started_at, p.id) < (p_before_time, p_before_id))
  order by p.started_at desc, p.id desc
  limit 21;
end;
$$;

create or replace function public.home_pick_feed_page_v2(
  p_before_time timestamptz default null,
  p_before_id uuid default null
)
returns table(
  pick_id uuid, user_id uuid, username text, profile_image_url text,
  item_id uuid, item_name text, category_id uuid, category_name text,
  one_line_review text, thumbnail_path text, image_path text,
  image_source_url text, official_url text, market_availability_status text,
  started_at timestamptz
)
language plpgsql stable security invoker set search_path = ''
as $$
begin
  if (p_before_time is null) <> (p_before_id is null) then
    raise exception 'INVALID_PAGINATION_CURSOR' using errcode='22023';
  end if;
  return query
  select p.id, p.user_id, pr.username, pr.profile_image_url,
    i.id, i.name, c.id, c.name, p.one_line_review,
    i.thumbnail_path, i.image_path, i.image_source_url,
    i.official_url, i.market_availability_status, p.started_at
  from public.picks p
  join public.profiles pr on pr.id=p.user_id
  join public.items i on i.id=p.item_id and i.category_id=p.category_id
  join public.categories c on c.id=p.category_id
  where p.status='active'
    and p.user_id is distinct from (select auth.uid())
    and not private.user_is_suspended(p.user_id)
    and i.status in ('active','discontinued')
    and public.category_is_open_leaf(c.id)
    and (
      p_before_time is null
      or (p.started_at,p.id) < (p_before_time,p_before_id)
    )
  order by p.started_at desc,p.id desc
  limit 21;
end;
$$;

create or replace function public.home_showcase()
returns table(minimum_pick_count integer, items jsonb)
language sql stable security invoker set search_path = ''
as $$
  with totals as (
    select i.id, i.name, i.image_path, i.thumbnail_path, i.image_source_url,
      i.official_url, i.market_availability_status,
      c.id as category_id, c.name as category_name,
      count(*) as pick_count, max(p.started_at) as last_picked_at
    from public.picks p
    join public.items i on i.id = p.item_id and i.category_id = p.category_id
    join public.categories c on c.id = p.category_id
    where p.status = 'active'
      and not private.user_is_suspended(p.user_id)
      and i.status in ('active', 'discontinued')
      and public.category_is_open_leaf(c.id)
    group by i.id, c.id
  ),
  qualified as (
    select t.*
    from totals t
    where t.pick_count >= (select s.minimum_pick_count from public.home_settings s where s.id)
    order by t.last_picked_at desc, t.id
    limit 20
  )
  select s.minimum_pick_count,
    coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'item_id', q.id, 'name', q.name,
          'category_id', q.category_id, 'category_name', q.category_name,
          'image_path', q.image_path, 'thumbnail_path', q.thumbnail_path,
          'image_source_url', q.image_source_url, 'official_url', q.official_url,
          'market_availability_status', q.market_availability_status,
          'pick_count', q.pick_count
        )
        order by q.last_picked_at desc, q.id
      ) from qualified q
    ), '[]'::jsonb)
  from public.home_settings s where s.id;
$$;

create or replace function public.home_showcase_page(
  p_before_time timestamptz default null,
  p_after_id uuid default null
)
returns table(minimum_pick_count integer, items jsonb)
language sql stable security invoker set search_path = ''
as $$
  with totals as (
    select i.id, i.name, i.image_path, i.thumbnail_path, i.image_source_url,
      i.official_url, i.market_availability_status,
      c.id as category_id, c.name as category_name,
      count(*) as pick_count, max(p.started_at) as last_picked_at
    from public.picks p
    join public.items i on i.id = p.item_id and i.category_id = p.category_id
    join public.categories c on c.id = p.category_id
    where p.status = 'active'
      and not private.user_is_suspended(p.user_id)
      and i.status in ('active', 'discontinued')
      and public.category_is_open_leaf(c.id)
    group by i.id, c.id
  ),
  qualified as (
    select t.*
    from totals t
    where t.pick_count >= (select s.minimum_pick_count from public.home_settings s where s.id)
      and (
        p_before_time is null
        or t.last_picked_at < p_before_time
        or (t.last_picked_at = p_before_time and t.id > p_after_id)
      )
    order by t.last_picked_at desc, t.id
    limit 21
  ),
  decorated as (
    select q.*,
      latest.pick_id as latest_pick_id,
      latest.username as latest_picker_username,
      latest.profile_image_url as latest_picker_profile_image_url,
      latest.one_line_review as latest_pick_review
    from qualified q
    left join lateral (
      select p.id as pick_id, pr.username, pr.profile_image_url, p.one_line_review
      from public.picks p
      join public.profiles pr on pr.id = p.user_id
      where p.item_id = q.id
        and p.category_id = q.category_id
        and p.status = 'active'
        and not private.user_is_suspended(p.user_id)
      order by p.started_at desc, p.id desc
      limit 1
    ) latest on true
  )
  select s.minimum_pick_count,
    coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'item_id', d.id, 'name', d.name,
          'category_id', d.category_id, 'category_name', d.category_name,
          'image_path', d.image_path, 'thumbnail_path', d.thumbnail_path,
          'image_source_url', d.image_source_url, 'official_url', d.official_url,
          'market_availability_status', d.market_availability_status,
          'pick_count', d.pick_count, 'last_picked_at', d.last_picked_at,
          'latest_pick_id', d.latest_pick_id,
          'latest_picker_username', d.latest_picker_username,
          'latest_picker_profile_image_url', d.latest_picker_profile_image_url,
          'latest_pick_review', d.latest_pick_review
        )
        order by d.last_picked_at desc, d.id
      ) from decorated d
    ), '[]'::jsonb)
  from public.home_settings s where s.id;
$$;

create table public.item_editorial_features (
  item_id uuid primary key references public.items(id) on delete cascade,
  priority integer not null default 100 check (priority between 0 and 1000),
  note text,
  starts_at timestamptz not null default now(),
  ends_at timestamptz,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint item_editorial_features_note_length
    check (note is null or char_length(btrim(note)) between 1 and 200),
  constraint item_editorial_features_window
    check (ends_at is null or ends_at > starts_at)
);

comment on table public.item_editorial_features is
  'Editorial emphasis for early OnePick operation. Separate from user pick counts and ranking.';
comment on column public.item_editorial_features.priority is
  'Lower values appear first. Editorial ordering never changes user pick_count.';
comment on column public.item_editorial_features.note is
  'Short editorial recommendation reason shown on the home recommendation card.';

create index item_editorial_features_active_priority_idx
  on public.item_editorial_features(is_active, priority, starts_at, ends_at);

create trigger item_editorial_features_set_updated_at
before update on public.item_editorial_features
for each row execute function private.set_updated_at();

alter table public.item_editorial_features enable row level security;
revoke all on public.item_editorial_features from public, anon, authenticated;
grant select on public.item_editorial_features to anon, authenticated;
grant insert, update, delete on public.item_editorial_features to authenticated;
grant all on public.item_editorial_features to service_role;

create policy item_editorial_features_public_read
on public.item_editorial_features for select to anon, authenticated
using (
  is_active
  and starts_at <= now()
  and (ends_at is null or ends_at > now())
);

create policy item_editorial_features_admin_read
on public.item_editorial_features for select to authenticated
using ((select private.is_admin_mfa()));

create policy item_editorial_features_admin_insert
on public.item_editorial_features for insert to authenticated
with check ((select private.is_admin_mfa()));

create policy item_editorial_features_admin_update
on public.item_editorial_features for update to authenticated
using ((select private.is_admin_mfa()))
with check ((select private.is_admin_mfa()));

create policy item_editorial_features_admin_delete
on public.item_editorial_features for delete to authenticated
using ((select private.is_admin_mfa()));

create or replace function public.admin_set_item_editorial_feature(
  p_item_id uuid,
  p_is_active boolean default true,
  p_priority integer default 100,
  p_note text default null,
  p_starts_at timestamptz default now(),
  p_ends_at timestamptz default null
)
returns public.item_editorial_features
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_row public.item_editorial_features%rowtype;
  v_note text := nullif(btrim(p_note), '');
begin
  if not private.is_admin_mfa() then
    raise exception 'ADMIN_REQUIRED' using errcode='42501';
  end if;
  if not exists (
    select 1 from public.items i
    where i.id = p_item_id and i.status in ('active','discontinued')
  ) then
    raise exception 'ITEM_NOT_ELIGIBLE' using errcode='P0001';
  end if;
  if p_priority not between 0 and 1000
     or (v_note is not null and char_length(v_note) > 200)
     or (p_ends_at is not null and p_ends_at <= p_starts_at) then
    raise exception 'EDITORIAL_FEATURE_INVALID' using errcode='P0001';
  end if;

  insert into public.item_editorial_features(
    item_id, priority, note, starts_at, ends_at, is_active
  ) values (
    p_item_id, p_priority, v_note, p_starts_at, p_ends_at, p_is_active
  )
  on conflict (item_id) do update
    set priority = excluded.priority,
        note = excluded.note,
        starts_at = excluded.starts_at,
        ends_at = excluded.ends_at,
        is_active = excluded.is_active,
        updated_at = now()
  returning * into v_row;

  return v_row;
end;
$$;
revoke all on function public.admin_set_item_editorial_feature(uuid,boolean,integer,text,timestamptz,timestamptz)
  from public, anon;
grant execute on function public.admin_set_item_editorial_feature(uuid,boolean,integer,text,timestamptz,timestamptz)
  to authenticated, service_role;

create or replace function public.home_editorial_items(p_limit integer default 6)
returns table(
  item_id uuid,
  name text,
  category_id uuid,
  category_name text,
  category_path text,
  image_path text,
  thumbnail_path text,
  image_source_url text,
  editorial_note text,
  editorial_priority integer,
  pick_count bigint
)
language sql stable security invoker set search_path = ''
as $$
  select
    i.id, i.name, c.id, c.name, public.category_path(c.id),
    i.image_path, i.thumbnail_path, i.image_source_url,
    f.note, f.priority,
    (
      select count(*)
      from public.picks p
      where p.item_id = i.id
        and p.category_id = i.category_id
        and p.status = 'active'
        and not private.user_is_suspended(p.user_id)
    )
  from public.item_editorial_features f
  join public.items i on i.id = f.item_id
  join public.categories c on c.id = i.category_id
  where f.is_active
    and f.starts_at <= now()
    and (f.ends_at is null or f.ends_at > now())
    and i.status in ('active','discontinued')
    and public.category_is_open_leaf(c.id)
  order by f.priority asc, f.updated_at desc, i.name, i.id
  limit least(greatest(coalesce(p_limit,6),1),12);
$$;
revoke all on function public.home_editorial_items(integer) from public;
grant execute on function public.home_editorial_items(integer) to anon, authenticated, service_role;
