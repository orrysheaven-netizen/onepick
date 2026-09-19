create table if not exists private.user_moderation (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  reason text not null check (char_length(btrim(reason)) between 1 and 500),
  suspended_at timestamptz not null default now(),
  suspended_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table private.user_moderation enable row level security;
revoke all on table private.user_moderation from public, anon, authenticated;

drop trigger if exists set_user_moderation_updated_at on private.user_moderation;
create trigger set_user_moderation_updated_at
before update on private.user_moderation
for each row execute function private.set_updated_at();

create or replace function private.is_user_suspended(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from private.user_moderation m where m.user_id = p_user_id
  );
$$;
revoke all on function private.is_user_suspended(uuid) from public, anon, authenticated;

create or replace function public.user_is_suspended(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_user_suspended(p_user_id);
$$;
revoke all on function public.user_is_suspended(uuid) from public;
revoke all on function public.user_is_suspended(uuid) from anon;
revoke all on function public.user_is_suspended(uuid) from authenticated;
grant execute on function public.user_is_suspended(uuid) to anon, authenticated;

create or replace function public.admin_users(p_query text default '')
returns table(
  id uuid,
  username text,
  onboarding_completed boolean,
  created_at timestamptz,
  updated_at timestamptz,
  moderation_status text,
  suspension_reason text,
  suspended_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.is_admin((select auth.uid())) then
    raise exception 'ADMIN_REQUIRED' using errcode = '42501';
  end if;

  return query
  select p.id,
         p.username,
         p.onboarding_completed,
         p.created_at,
         p.updated_at,
         case when m.user_id is null then 'active'::text else 'suspended'::text end,
         m.reason,
         m.suspended_at
  from public.profiles p
  left join private.user_moderation m on m.user_id = p.id
  where coalesce(btrim(p_query), '') = ''
     or p.username ilike '%' || btrim(p_query) || '%'
  order by p.created_at desc
  limit 100;
end;
$$;
revoke all on function public.admin_users(text) from public, anon;
grant execute on function public.admin_users(text) to authenticated;

create or replace function public.admin_user_moderation(p_user_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_row private.user_moderation%rowtype;
begin
  if not private.is_admin((select auth.uid())) then
    raise exception 'ADMIN_REQUIRED' using errcode = '42501';
  end if;

  if not exists (select 1 from public.profiles where id = p_user_id) then
    raise exception 'USER_NOT_FOUND' using errcode = 'P0001';
  end if;

  select * into v_row from private.user_moderation where user_id = p_user_id;
  if found then
    return jsonb_build_object(
      'user_id', p_user_id,
      'status', 'suspended',
      'reason', v_row.reason,
      'suspended_at', v_row.suspended_at
    );
  end if;

  return jsonb_build_object(
    'user_id', p_user_id,
    'status', 'active',
    'reason', null,
    'suspended_at', null
  );
end;
$$;
revoke all on function public.admin_user_moderation(uuid) from public, anon;
grant execute on function public.admin_user_moderation(uuid) to authenticated;

alter table public.admin_audit_logs
  drop constraint if exists admin_audit_logs_entity_type_check;
alter table public.admin_audit_logs
  add constraint admin_audit_logs_entity_type_check
  check (entity_type = any (array['category'::text,'brand'::text,'item'::text,'content_report'::text,'user_moderation'::text]));

create or replace function public.admin_set_user_suspension(
  p_user_id uuid,
  p_suspended boolean,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_reason text := nullif(btrim(p_reason), '');
  v_row private.user_moderation%rowtype;
begin
  if not private.is_admin(v_actor) then
    raise exception 'ADMIN_REQUIRED' using errcode = '42501';
  end if;

  if not exists (select 1 from public.profiles where id = p_user_id) then
    raise exception 'USER_NOT_FOUND' using errcode = 'P0001';
  end if;

  if private.is_admin(p_user_id) then
    raise exception 'ADMIN_CANNOT_BE_SUSPENDED' using errcode = 'P0001';
  end if;

  if p_suspended then
    if v_reason is null or char_length(v_reason) > 500 then
      raise exception 'SUSPENSION_REASON_REQUIRED' using errcode = 'P0001';
    end if;

    insert into private.user_moderation(user_id, reason, suspended_at, suspended_by)
    values (p_user_id, v_reason, now(), v_actor)
    on conflict (user_id) do update
      set reason = excluded.reason,
          suspended_at = excluded.suspended_at,
          suspended_by = excluded.suspended_by,
          updated_at = now();
  else
    delete from private.user_moderation where user_id = p_user_id;
  end if;

  insert into public.admin_audit_logs(actor_user_id, entity_type, entity_id, action, summary)
  values (
    v_actor,
    'user_moderation',
    p_user_id,
    'update',
    jsonb_build_object(
      'user_id', p_user_id,
      'status', case when p_suspended then 'suspended' else 'active' end,
      'reason', case when p_suspended then v_reason else null end
    )
  );

  select * into v_row from private.user_moderation where user_id = p_user_id;
  if found then
    return jsonb_build_object(
      'user_id', p_user_id,
      'status', 'suspended',
      'reason', v_row.reason,
      'suspended_at', v_row.suspended_at
    );
  end if;

  return jsonb_build_object(
    'user_id', p_user_id,
    'status', 'active',
    'reason', null,
    'suspended_at', null
  );
end;
$$;
revoke all on function public.admin_set_user_suspension(uuid,boolean,text) from public, anon;
grant execute on function public.admin_set_user_suspension(uuid,boolean,text) to authenticated;

create or replace function private.prevent_suspended_content_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
begin
  if v_actor is not null
     and new.user_id = v_actor
     and private.is_user_suspended(v_actor) then
    if tg_table_name = 'picks' and tg_op = 'UPDATE' and new.status = 'removed' then
      return new;
    end if;
    raise exception 'USER_SUSPENDED' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function private.prevent_suspended_content_write() from public, anon, authenticated;

drop trigger if exists prevent_suspended_pick_write on public.picks;
create trigger prevent_suspended_pick_write
before insert or update on public.picks
for each row execute function private.prevent_suspended_content_write();

drop trigger if exists prevent_suspended_comment_write on public.comments;
create trigger prevent_suspended_comment_write
before insert or update on public.comments
for each row execute function private.prevent_suspended_content_write();

drop policy if exists profiles_anon_read on public.profiles;
create policy profiles_anon_read on public.profiles
for select to anon
using (not public.user_is_suspended(id));

drop policy if exists profiles_authenticated_read on public.profiles;
create policy profiles_authenticated_read on public.profiles
for select to authenticated
using (
  id = (select auth.uid())
  or (select private.is_admin((select auth.uid())))
  or (
    not public.user_is_suspended(id)
    and not (select private.users_blocked((select auth.uid()), profiles.id))
  )
);

drop policy if exists picks_anon_active_read on public.picks;
create policy picks_anon_active_read on public.picks
for select to anon
using (
  status = 'active'
  and not public.user_is_suspended(user_id)
);

drop policy if exists picks_authenticated_read on public.picks;
create policy picks_authenticated_read on public.picks
for select to authenticated
using (
  (select private.is_admin((select auth.uid())))
  or user_id = (select auth.uid())
  or (
    status = 'active'
    and not public.user_is_suspended(user_id)
    and not (select private.users_blocked((select auth.uid()), picks.user_id))
  )
);

drop policy if exists comments_anon_read_visible_pick on public.comments;
create policy comments_anon_read_visible_pick on public.comments
for select to anon
using (
  not public.user_is_suspended(user_id)
  and exists (
    select 1 from public.picks p
    where p.id = comments.pick_id
      and p.status = 'active'
      and not public.user_is_suspended(p.user_id)
  )
);

drop policy if exists comments_authenticated_read_visible_pick on public.comments;
create policy comments_authenticated_read_visible_pick on public.comments
for select to authenticated
using (
  (select private.is_admin((select auth.uid())))
  or user_id = (select auth.uid())
  or (
    not public.user_is_suspended(user_id)
    and not (select private.users_blocked((select auth.uid()), comments.user_id))
    and exists (
      select 1 from public.picks p
      where p.id = comments.pick_id
        and (
          p.user_id = (select auth.uid())
          or (
            p.status = 'active'
            and not public.user_is_suspended(p.user_id)
            and not (select private.users_blocked((select auth.uid()), p.user_id))
          )
        )
    )
  )
);

create or replace function public.category_top_items(p_category_id uuid)
returns table(item_id uuid, name text, thumbnail_path text, pick_count bigint, rank bigint, is_tied boolean)
language sql
stable
set search_path = ''
as $$
  with totals as (
    select i.id, i.name, i.thumbnail_path, count(*) as pick_count
    from public.picks p
    join public.items i on i.id = p.item_id and i.category_id = p.category_id
    join public.categories c on c.id = p.category_id
    left join public.categories parent on parent.id = c.parent_id
    where p.category_id = p_category_id and p.status = 'active'
      and not public.user_is_suspended(p.user_id)
      and i.status in ('active', 'discontinued')
      and c.status = 'open' and c.is_visible and c.is_pickable
      and not exists (select 1 from public.categories child where child.parent_id = c.id)
      and (c.parent_id is null or (
        parent.parent_id is null and parent.status = 'open'
        and parent.is_visible and not parent.is_pickable
      ))
    group by i.id
  )
  select t.id, t.name, t.thumbnail_path, t.pick_count,
    rank() over (order by t.pick_count desc),
    count(*) over (partition by t.pick_count) > 1
  from totals t
  order by t.pick_count desc, t.name, t.id
  limit 3;
$$;

create or replace function public.home_showcase()
returns table(minimum_pick_count integer, items jsonb)
language sql
stable
set search_path = ''
as $$
  with totals as (
    select i.id, i.name, i.image_path, i.thumbnail_path,
      c.id as category_id, c.name as category_name,
      count(*) as pick_count, max(p.started_at) as last_picked_at
    from public.picks p
    join public.items i on i.id = p.item_id and i.category_id = p.category_id
    join public.categories c on c.id = p.category_id
    left join public.categories parent on parent.id = c.parent_id
    where p.status = 'active'
      and not public.user_is_suspended(p.user_id)
      and i.status in ('active', 'discontinued')
      and c.status = 'open' and c.is_visible and c.is_pickable
      and not exists (select 1 from public.categories child where child.parent_id = c.id)
      and (c.parent_id is null or (parent.parent_id is null and parent.status = 'open'
        and parent.is_visible and not parent.is_pickable))
    group by i.id, c.id
  ), qualified as (
    select t.* from totals t
    where t.pick_count >= (select s.minimum_pick_count from public.home_settings s where s.id)
    order by t.last_picked_at desc, t.id
    limit 20
  )
  select s.minimum_pick_count, coalesce((
    select jsonb_agg(jsonb_build_object(
      'item_id', q.id, 'name', q.name, 'category_id', q.category_id,
      'category_name', q.category_name, 'image_path', q.image_path,
      'thumbnail_path', q.thumbnail_path, 'pick_count', q.pick_count
    ) order by q.last_picked_at desc, q.id)
    from qualified q
  ), '[]'::jsonb)
  from public.home_settings s where s.id;
$$;

create or replace function public.home_showcase_page(
  p_before_time timestamptz default null,
  p_after_id uuid default null
)
returns table(minimum_pick_count integer, items jsonb)
language sql
stable
set search_path = ''
as $$
  with totals as (
    select i.id, i.name, i.image_path, i.thumbnail_path,
      c.id as category_id, c.name as category_name,
      count(*) as pick_count, max(p.started_at) as last_picked_at
    from public.picks p
    join public.items i on i.id = p.item_id and i.category_id = p.category_id
    join public.categories c on c.id = p.category_id
    left join public.categories parent on parent.id = c.parent_id
    where p.status = 'active'
      and not public.user_is_suspended(p.user_id)
      and i.status in ('active', 'discontinued')
      and c.status = 'open' and c.is_visible and c.is_pickable
      and not exists (select 1 from public.categories child where child.parent_id = c.id)
      and (c.parent_id is null or (parent.parent_id is null and parent.status = 'open'
        and parent.is_visible and not parent.is_pickable))
    group by i.id, c.id
  ), qualified as (
    select t.* from totals t
    where t.pick_count >= (select s.minimum_pick_count from public.home_settings s where s.id)
      and (p_before_time is null or t.last_picked_at < p_before_time
        or (t.last_picked_at = p_before_time and t.id > p_after_id))
    order by t.last_picked_at desc, t.id
    limit 21
  )
  select s.minimum_pick_count, coalesce((
    select jsonb_agg(jsonb_build_object(
      'item_id', q.id, 'name', q.name, 'category_id', q.category_id,
      'category_name', q.category_name, 'image_path', q.image_path,
      'thumbnail_path', q.thumbnail_path, 'pick_count', q.pick_count,
      'last_picked_at', q.last_picked_at
    ) order by q.last_picked_at desc, q.id)
    from qualified q
  ), '[]'::jsonb)
  from public.home_settings s where s.id;
$$;