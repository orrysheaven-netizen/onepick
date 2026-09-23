-- Security QA #225 item 6: make photo upload quotas deletion-proof,
-- bound public object size, and schedule safe stale-object cleanup through Storage API.

create table private.item_photo_upload_limits (
  user_id uuid primary key references auth.users(id) on delete cascade,
  window_start timestamptz not null default clock_timestamp(),
  uploads integer not null default 0 check (uploads between 0 and 20)
);
alter table private.item_photo_upload_limits enable row level security;
revoke all on table private.item_photo_upload_limits from public, anon, authenticated;

create or replace function private.can_upload_item_photo()
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user uuid := auth.uid();
  v_allowed boolean;
begin
  if v_user is null
     or not exists(select 1 from public.profiles where id=v_user) then
    return false;
  end if;

  insert into private.item_photo_upload_limits as quota(user_id,window_start,uploads)
  values(v_user,clock_timestamp(),1)
  on conflict(user_id) do update
    set uploads = case
          when quota.window_start <= clock_timestamp()-interval '24 hours' then 1
          else quota.uploads+1
        end,
        window_start = case
          when quota.window_start <= clock_timestamp()-interval '24 hours'
            then clock_timestamp()
          else quota.window_start
        end
    where quota.window_start <= clock_timestamp()-interval '24 hours'
       or quota.uploads < 20
  returning true into v_allowed;

  return coalesce(v_allowed,false);
end;
$function$;

revoke all on function private.can_upload_item_photo() from public, anon;
grant execute on function private.can_upload_item_photo() to authenticated;

-- A public maintenance Edge Function invokes these RPCs with the service role.
-- The lease means arbitrary callers cannot turn the endpoint into an unbounded
-- Storage-list/delete workload.
create table private.item_photo_cleanup_state (
  singleton boolean primary key default true check (singleton),
  last_started_at timestamptz
);
alter table private.item_photo_cleanup_state enable row level security;
revoke all on table private.item_photo_cleanup_state from public, anon, authenticated;
insert into private.item_photo_cleanup_state(singleton,last_started_at)
values(true,null)
on conflict(singleton) do nothing;

create or replace function public.claim_item_photo_cleanup()
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_last timestamptz;
begin
  select last_started_at into v_last
  from private.item_photo_cleanup_state
  where singleton=true
  for update;

  if v_last is not null and v_last > clock_timestamp()-interval '23 hours' then
    return false;
  end if;

  update private.item_photo_cleanup_state
  set last_started_at=clock_timestamp()
  where singleton=true;

  return true;
end;
$function$;

create or replace function public.stale_item_photo_paths(p_limit integer default 100)
returns table(path text)
language sql
stable
security definer
set search_path = ''
as $function$
  select o.name
  from storage.objects o
  where o.bucket_id='item-photos'
    and o.created_at < clock_timestamp()-interval '24 hours'
    and not exists (
      select 1
      from public.items i
      where i.image_path=o.name or i.thumbnail_path=o.name
    )
  order by o.created_at,o.name
  limit least(greatest(coalesce(p_limit,100),1),100);
$function$;

revoke all on function public.claim_item_photo_cleanup() from public, anon, authenticated;
revoke all on function public.stale_item_photo_paths(integer) from public, anon, authenticated;
grant execute on function public.claim_item_photo_cleanup() to service_role;
grant execute on function public.stale_item_photo_paths(integer) to service_role;

create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron;

select cron.schedule(
  'onepick-item-photo-cleanup',
  '29 4 * * *',
  $cron$
    select net.http_post(
      url:='https://ygoipwzakzdnkaaxyrgb.supabase.co/functions/v1/cleanup-item-photos',
      headers:='{"Content-Type":"application/json"}'::jsonb,
      body:='{}'::jsonb,
      timeout_milliseconds:=10000
    );
  $cron$
);
