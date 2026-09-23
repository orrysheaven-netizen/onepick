-- Security QA #225 item 5: bound rapid Pick changes and follower notification fan-out.
alter table private.community_write_limits
  drop constraint if exists community_write_limits_action_check;
alter table private.community_write_limits
  add constraint community_write_limits_action_check
    check (action in ('comment','report','pick'));

create or replace function private.limit_pick_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user uuid := auth.uid();
  v_now timestamptz := clock_timestamp();
  v_count integer;
begin
  -- Initial Picks are part of onboarding and do not consume replacement quota.
  -- change_pick_impl marks the previous Pick as replaced before inserting the new
  -- active row, so a prior replaced row in this category means this is a change.
  if new.status <> 'active' or v_user is null or new.user_id is distinct from v_user then
    return null;
  end if;
  if not exists (
    select 1
    from public.picks prior
    where prior.user_id=v_user
      and prior.category_id=new.category_id
      and prior.status='replaced'
  ) then
    return null;
  end if;

  insert into private.community_write_limits as quota(user_id,action,window_start,requests)
    values(v_user,'pick',v_now,1)
  on conflict(user_id,action) do update
    set requests = case
          when quota.window_start <= v_now-interval '1 hour' then 1
          else quota.requests+1
        end,
        window_start = case
          when quota.window_start <= v_now-interval '1 hour' then v_now
          else quota.window_start
        end
    where quota.window_start <= v_now-interval '1 hour'
       or quota.requests < 10
  returning requests into v_count;

  if not found then
    raise exception 'RATE_LIMITED' using errcode='P0001';
  end if;
  return null;
end;
$function$;

revoke all on function private.limit_pick_change() from public,anon,authenticated;

drop trigger if exists picks_limit_changes on public.picks;
create trigger picks_limit_changes
after insert on public.picks
for each row execute function private.limit_pick_change();

create index if not exists pick_change_notifications_recipient_created_idx
  on public.pick_change_notifications(recipient_id,created_at desc);

create or replace function private.notify_followers_on_pick_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if new.status <> 'active' then
    return new;
  end if;
  if tg_op = 'INSERT' and new.user_id is distinct from (select auth.uid()) then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.status = 'active' then
    return new;
  end if;

  insert into public.pick_change_notifications(pick_id,recipient_id)
  select new.id,f.follower_id
  from public.user_follows f
  left join public.notification_preferences np on np.user_id=f.follower_id
  where f.followee_id=new.user_id
    and coalesce(np.followee_pick_change,true)
    and not private.users_blocked(f.follower_id,new.user_id)
    and not private.user_is_suspended(f.follower_id)
    and not exists (
      select 1
      from public.pick_change_notifications recent
      join public.picks prior on prior.id=recent.pick_id
      where recent.recipient_id=f.follower_id
        and prior.user_id=new.user_id
        and prior.category_id=new.category_id
        and recent.created_at >= clock_timestamp()-interval '15 minutes'
    )
  order by f.created_at
  limit 1000
  on conflict(pick_id,recipient_id) do nothing;

  return new;
end;
$function$;

revoke all on function private.notify_followers_on_pick_change() from public,anon,authenticated;
