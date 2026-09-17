alter table public.profiles
  add constraint profiles_id_auth_user_fkey
  foreign key (id) references auth.users(id) on delete cascade;

alter table private.admin_users
  add constraint admin_users_user_id_auth_fkey
  foreign key (user_id) references auth.users(id) on delete cascade;

create table public.user_blocks (
  blocker_user_id uuid not null references public.profiles(id) on delete cascade,
  blocked_user_id uuid not null references public.profiles(id) on delete cascade,
  blocked_username_snapshot text not null,
  created_at timestamptz not null default now(),
  primary key (blocker_user_id, blocked_user_id),
  constraint user_blocks_not_self check (blocker_user_id <> blocked_user_id),
  constraint user_blocks_username_length check (char_length(blocked_username_snapshot) between 1 and 20)
);

create index user_blocks_blocked_user_idx on public.user_blocks(blocked_user_id, blocker_user_id);
alter table public.user_blocks enable row level security;
grant select, insert, delete on public.user_blocks to authenticated;

create or replace function private.prepare_user_block()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_username text;
begin
  if new.blocker_user_id is distinct from (select auth.uid()) then
    raise exception 'FORBIDDEN';
  end if;
  if new.blocker_user_id = new.blocked_user_id then
    raise exception 'BLOCK_SELF';
  end if;
  select username into v_username from public.profiles where id = new.blocked_user_id;
  if v_username is null then
    raise exception 'PROFILE_NOT_FOUND';
  end if;
  new.blocked_username_snapshot := v_username;
  return new;
end;
$$;
revoke all on function private.prepare_user_block() from public, anon, authenticated;
create trigger user_blocks_prepare_before_insert
before insert on public.user_blocks
for each row execute function private.prepare_user_block();

create or replace function private.users_blocked(p_user_a uuid, p_user_b uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select case
    when p_user_a is null or p_user_b is null or p_user_a = p_user_b then false
    else exists (
      select 1 from public.user_blocks b
      where (b.blocker_user_id = p_user_a and b.blocked_user_id = p_user_b)
         or (b.blocker_user_id = p_user_b and b.blocked_user_id = p_user_a)
    )
  end;
$$;
revoke all on function private.users_blocked(uuid, uuid) from public, anon;
grant execute on function private.users_blocked(uuid, uuid) to authenticated;

create policy user_blocks_read_own on public.user_blocks
for select to authenticated
using (blocker_user_id = (select auth.uid()));
create policy user_blocks_insert_own on public.user_blocks
for insert to authenticated
with check (blocker_user_id = (select auth.uid()));
create policy user_blocks_delete_own on public.user_blocks
for delete to authenticated
using (blocker_user_id = (select auth.uid()));

create table public.content_reports (
  id uuid primary key default gen_random_uuid(),
  reporter_user_id uuid references public.profiles(id) on delete set null,
  target_type text not null,
  target_id uuid not null,
  target_user_id uuid references public.profiles(id) on delete set null,
  reason text not null,
  details text,
  status text not null default 'open',
  resolved_by uuid references public.profiles(id) on delete set null,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint content_reports_target_type_check check (target_type in ('profile','pick','comment')),
  constraint content_reports_reason_check check (reason in ('spam','harassment','inappropriate','misleading','other')),
  constraint content_reports_status_check check (status in ('open','reviewing','resolved','dismissed')),
  constraint content_reports_details_length check (details is null or char_length(btrim(details)) between 1 and 500)
);

create unique index content_reports_open_unique
on public.content_reports(reporter_user_id, target_type, target_id)
where status in ('open','reviewing');
create index content_reports_status_created_idx on public.content_reports(status, created_at desc);
create index content_reports_target_user_idx on public.content_reports(target_user_id, created_at desc);
alter table public.content_reports enable row level security;
grant select, insert, update on public.content_reports to authenticated;

create or replace function private.prepare_content_report()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_target_user_id uuid;
begin
  if new.reporter_user_id is distinct from (select auth.uid()) then
    raise exception 'FORBIDDEN';
  end if;
  case new.target_type
    when 'profile' then
      select id into v_target_user_id from public.profiles where id = new.target_id;
    when 'pick' then
      select user_id into v_target_user_id from public.picks where id = new.target_id;
    when 'comment' then
      select user_id into v_target_user_id from public.comments where id = new.target_id;
    else
      raise exception 'REPORT_INVALID';
  end case;
  if v_target_user_id is null then
    raise exception 'REPORT_TARGET_NOT_FOUND';
  end if;
  if v_target_user_id = new.reporter_user_id then
    raise exception 'REPORT_SELF';
  end if;
  new.target_user_id := v_target_user_id;
  new.status := 'open';
  new.resolved_by := null;
  new.resolved_at := null;
  if new.details is not null then
    new.details := nullif(btrim(new.details), '');
  end if;
  return new;
end;
$$;
revoke all on function private.prepare_content_report() from public, anon, authenticated;
create trigger content_reports_prepare_before_insert
before insert on public.content_reports
for each row execute function private.prepare_content_report();

create or replace function private.prepare_content_report_update()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  new.updated_at := now();
  if new.status in ('resolved','dismissed') then
    new.resolved_by := (select auth.uid());
    new.resolved_at := coalesce(new.resolved_at, now());
  else
    new.resolved_by := null;
    new.resolved_at := null;
  end if;
  return new;
end;
$$;
revoke all on function private.prepare_content_report_update() from public, anon, authenticated;
create trigger content_reports_prepare_before_update
before update on public.content_reports
for each row execute function private.prepare_content_report_update();

create policy content_reports_read on public.content_reports
for select to authenticated
using (
  reporter_user_id = (select auth.uid())
  or (select private.is_admin((select auth.uid())))
);
create policy content_reports_insert_own on public.content_reports
for insert to authenticated
with check (reporter_user_id = (select auth.uid()));
create policy content_reports_admin_update on public.content_reports
for update to authenticated
using ((select private.is_admin((select auth.uid()))))
with check ((select private.is_admin((select auth.uid()))));

drop policy if exists profiles_public_read on public.profiles;
create policy profiles_anon_read on public.profiles
for select to anon using (true);
create policy profiles_authenticated_read on public.profiles
for select to authenticated
using (
  id = (select auth.uid())
  or (select private.is_admin((select auth.uid())))
  or not (select private.users_blocked((select auth.uid()), id))
);

drop policy if exists picks_authenticated_read on public.picks;
create policy picks_authenticated_read on public.picks
for select to authenticated
using (
  (select private.is_admin((select auth.uid())))
  or user_id = (select auth.uid())
  or (
    status = 'active'
    and not (select private.users_blocked((select auth.uid()), user_id))
  )
);

drop policy if exists comments_read_visible_pick on public.comments;
create policy comments_anon_read_visible_pick on public.comments
for select to anon
using (exists (select 1 from public.picks p where p.id = comments.pick_id and p.status = 'active'));
create policy comments_authenticated_read_visible_pick on public.comments
for select to authenticated
using (
  (select private.is_admin((select auth.uid())))
  or (
    not (select private.users_blocked((select auth.uid()), user_id))
    and exists (
      select 1 from public.picks p
      where p.id = comments.pick_id
        and (
          p.user_id = (select auth.uid())
          or (
            p.status = 'active'
            and not (select private.users_blocked((select auth.uid()), p.user_id))
          )
        )
    )
  )
);

drop policy if exists comments_insert_own_on_active_pick on public.comments;
create policy comments_insert_own_on_active_pick on public.comments
for insert to authenticated
with check (
  user_id = (select auth.uid())
  and exists (
    select 1 from public.picks p
    where p.id = comments.pick_id
      and p.status = 'active'
      and not (select private.users_blocked((select auth.uid()), p.user_id))
  )
);

drop policy if exists comments_update_own on public.comments;
create policy comments_update_own on public.comments
for update to authenticated
using (user_id = (select auth.uid()))
with check (
  user_id = (select auth.uid())
  and exists (
    select 1 from public.picks p
    where p.id = comments.pick_id
      and p.status = 'active'
      and not (select private.users_blocked((select auth.uid()), p.user_id))
  )
);