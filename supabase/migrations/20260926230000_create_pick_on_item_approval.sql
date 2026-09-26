-- '원픽 등록' with a new product is the pick itself: the requester writes the
-- one-line review with the request, and approval (or a merge into an existing
-- product) makes that product their current pick. The inbox only reports the
-- result; nobody has to choose the product a second time.

-- The review waiting for approval. One per pending item; written only through
-- set_pending_item_pick_review, read by its author.
create table public.pending_item_picks (
  item_id uuid primary key references public.items(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  one_line_review text not null check (char_length(btrim(one_line_review)) between 1 and 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index pending_item_picks_user_idx on public.pending_item_picks(user_id);
alter table public.pending_item_picks enable row level security;
revoke all on public.pending_item_picks from public, anon, authenticated;
grant select on public.pending_item_picks to authenticated;
create policy pending_item_picks_read_own on public.pending_item_picks
for select to authenticated using (user_id = (select auth.uid()));
comment on table public.pending_item_picks is
  'One-line review written with a product request; becomes the requester''s pick when the item is approved or merged.';

create or replace function private.set_pending_item_pick_review_impl(
  p_item_id uuid,
  p_review text
)
returns public.pending_item_picks
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_review text := btrim(coalesce(p_review,''));
  v_item public.items%rowtype;
  v_result public.pending_item_picks%rowtype;
begin
  if v_user is null then
    raise exception 'AUTH_REQUIRED' using errcode='P0001';
  end if;
  if private.is_user_suspended(v_user) then
    raise exception 'USER_SUSPENDED' using errcode='42501';
  end if;
  if char_length(v_review) not between 1 and 100 then
    raise exception 'REVIEW_INVALID' using errcode='P0001';
  end if;

  select * into v_item
  from public.items
  where id=p_item_id
  for update;

  if not found or v_item.created_by is distinct from v_user then
    raise exception 'ITEM_NOT_FOUND' using errcode='P0001';
  end if;
  if v_item.status<>'pending' then
    raise exception 'ITEM_NOT_ELIGIBLE' using errcode='P0001';
  end if;

  insert into public.pending_item_picks(item_id,user_id,one_line_review)
  values (v_item.id,v_user,v_review)
  on conflict (item_id) do update
    set one_line_review=excluded.one_line_review, updated_at=now()
  returning * into v_result;

  return v_result;
end;
$$;

create or replace function public.set_pending_item_pick_review(
  p_item_id uuid,
  p_review text
)
returns public.pending_item_picks
language sql
security invoker
set search_path = ''
as $$
  select private.set_pending_item_pick_review_impl(p_item_id,p_review);
$$;

revoke all on function private.set_pending_item_pick_review_impl(uuid,text) from public, anon;
grant execute on function private.set_pending_item_pick_review_impl(uuid,text) to authenticated, service_role;
revoke all on function public.set_pending_item_pick_review(uuid,text) from public, anon;
grant execute on function public.set_pending_item_pick_review(uuid,text) to authenticated, service_role;

-- The notification points at the pick it created, when there is one.
alter table public.item_review_notifications
  add column pick_id uuid references public.picks(id) on delete set null;

-- Replaces the notify-only trigger from 20260926111000.
--
-- With a saved review: make the target the requester's pick, replacing their
-- current pick in that category, unless they picked something else in that
-- category after sending the request (the later choice wins, nothing is sent).
-- Without one (requests made before this change): notify so they can choose.
--
-- The pick is inserted as needs_review and then activated, so the existing
-- follower trigger treats it like any other approval into active (an insert by
-- someone other than the author does not fan out).
create or replace function private.notify_requester_on_item_review()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  v_outcome text;
  v_target public.items%rowtype;
  v_intent public.pending_item_picks%rowtype;
  v_current public.picks%rowtype;
  v_has_current boolean;
  v_pick_id uuid;
begin
  if old.status <> 'pending' or new.status = 'pending' then
    return new;
  end if;

  select * into v_intent from public.pending_item_picks where item_id = new.id;
  if found then
    delete from public.pending_item_picks where item_id = new.id;
  end if;

  if new.created_by is null then
    return new;
  end if;
  if new.status = 'active' then
    v_outcome := 'approved';
    v_target := new;
  elsif new.status = 'merged' and new.merged_into_item_id is not null then
    v_outcome := 'merged';
    select * into v_target from public.items where id = new.merged_into_item_id;
  else
    return new;
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(new.created_by::text||':'||v_target.category_id::text,0)
  );
  select * into v_current
  from public.picks
  where user_id = new.created_by
    and category_id = v_target.category_id
    and status in ('active','needs_review')
  for update;
  v_has_current := found;

  if v_has_current and v_current.item_id = v_target.id then
    return new;
  end if;

  if v_intent.item_id is not null then
    if (v_has_current and v_current.started_at > v_intent.created_at)
       or private.is_user_suspended(new.created_by) then
      return new;
    end if;

    v_pick_id := gen_random_uuid();
    if v_has_current then
      update public.picks
      set status='replaced', ended_at=now(), replaced_by_pick_id=v_pick_id, updated_at=now()
      where id = v_current.id;
    end if;
    insert into public.picks(id,user_id,category_id,item_id,one_line_review,status,started_at)
    values (v_pick_id,new.created_by,v_target.category_id,v_target.id,v_intent.one_line_review,'needs_review',now());
    update public.picks set status='active' where id = v_pick_id;
  end if;

  -- The requester resolved it themselves (choosing a category that matched an
  -- existing product) and sees the result on screen already.
  if new.created_by = (select auth.uid()) then
    return new;
  end if;

  insert into public.item_review_notifications(item_id, recipient_id, outcome, target_item_id, pick_id)
  values (new.id, new.created_by, v_outcome, v_target.id, v_pick_id)
  on conflict (item_id, recipient_id) do nothing;
  return new;
end;
$$;
revoke all on function private.notify_requester_on_item_review() from public, anon, authenticated;

create or replace function public.notification_page(p_before_time timestamptz default null, p_before_id uuid default null)
returns table(kind text, id uuid, pick_id uuid, username text, body text, item_name text, created_at timestamptz, read_at timestamptz, item_id uuid, outcome text)
language sql stable security invoker set search_path = ''
as $$
  select * from (
    select 'comment'::text, n.comment_id, c.pick_id, pr.username, c.body, i.name, n.created_at, n.read_at, null::uuid, null::text
    from public.comment_notifications n
    join public.comments c on c.id = n.comment_id
    join public.picks p on p.id = c.pick_id
    join public.profiles pr on pr.id = c.user_id
    join public.items i on i.id = p.item_id
    where n.recipient_id = (select auth.uid())
    union all
    select 'pick_change'::text, n.pick_id, n.pick_id, pr.username, p.one_line_review, i.name, n.created_at, n.read_at, null::uuid, null::text
    from public.pick_change_notifications n
    join public.picks p on p.id = n.pick_id
    join public.profiles pr on pr.id = p.user_id
    join public.items i on i.id = p.item_id
    where n.recipient_id = (select auth.uid())
    union all
    select 'item_review'::text, n.item_id, n.pick_id, null::text, null::text, i.name, n.created_at, n.read_at, n.target_item_id, n.outcome
    from public.item_review_notifications n
    join public.items i on i.id = n.target_item_id
    where n.recipient_id = (select auth.uid())
  ) rows(kind, id, pick_id, username, body, item_name, created_at, read_at, item_id, outcome)
  where (p_before_time is null or (created_at, id) < (p_before_time, p_before_id))
  order by created_at desc, id desc
  limit 21;
$$;
