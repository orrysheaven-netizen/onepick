-- Food Picks are per channel: a member may hold one current Pick per
-- (category, channel) where channel is offline (매장·배달), online (택배·온라인몰)
-- or recipe (a cooking video). Every other category keeps one current Pick per
-- category and stores no channel.
--
-- The channel belongs to the Pick because the member chooses it; item_channels
-- only says which channels an item can be picked under. Clients that do not send
-- a channel yet keep working: the item's own channel is used.
--
-- A member cannot hold the same item under two channels, so per-item counts
-- (rankings, popularity, showcases) still count people, not rows.

begin;

-- ---------------------------------------------------------------------------
-- Channel values
-- ---------------------------------------------------------------------------

alter table public.item_channels drop constraint if exists item_channels_channel_check;
alter table public.item_channels
  add constraint item_channels_channel_check
  check (channel in ('offline','online','recipe'));

alter table public.picks add column channel text;
alter table public.picks
  add constraint picks_channel_check
  check (channel is null or channel in ('offline','online','recipe'));

alter table public.pending_item_picks add column channel text;
alter table public.pending_item_picks
  add constraint pending_item_picks_channel_check
  check (channel is null or channel in ('offline','online','recipe'));

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

create or replace function private.category_is_food(p_category_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.categories c
    left join public.categories parent on parent.id = c.parent_id
    left join public.categories gp on gp.id = parent.parent_id
    where c.id = p_category_id
      and 'food' in (c.slug, parent.slug, gp.slug)
  );
$$;

-- The channel an item is picked under when the caller does not say: its
-- representative channel, then any channel it has, then recipe for a cooking
-- video, and online for a packaged product that never had a channel.
create or replace function private.default_pick_channel(p_item_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select ch.channel from public.item_channels ch
     where ch.item_id = p_item_id and ch.is_primary
     limit 1),
    (select ch.channel from public.item_channels ch
     where ch.item_id = p_item_id
     order by case ch.channel when 'offline' then 1 when 'online' then 2 else 3 end
     limit 1),
    (select 'recipe' from public.items i
     where i.id = p_item_id and i.external_source = 'youtube_video'),
    'online'
  );
$$;

-- Returns the channel a Pick of this item is stored under, or raises.
create or replace function private.resolve_pick_channel(
  p_category_id uuid,
  p_item_id uuid,
  p_channel text
)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_channel text;
begin
  if not private.category_is_food(p_category_id) then
    if p_channel is not null then
      raise exception 'PICK_CHANNEL_INVALID' using errcode = 'P0001';
    end if;
    return null;
  end if;

  v_channel := coalesce(p_channel, private.default_pick_channel(p_item_id));
  if v_channel not in ('offline','online','recipe') then
    raise exception 'PICK_CHANNEL_INVALID' using errcode = 'P0001';
  end if;

  -- An item that lists its channels can only be picked under one of them.
  -- Items without any channel row (older packaged products) accept any
  -- channel except recipe, which needs a cooking video.
  if exists (select 1 from public.item_channels ch where ch.item_id = p_item_id) then
    if not exists (
      select 1 from public.item_channels ch
      where ch.item_id = p_item_id and ch.channel = v_channel
    ) then
      raise exception 'PICK_CHANNEL_MISMATCH' using errcode = 'P0001';
    end if;
  elsif (v_channel = 'recipe') is distinct from exists (
    select 1 from public.items i
    where i.id = p_item_id and i.external_source = 'youtube_video'
  ) then
    raise exception 'PICK_CHANNEL_MISMATCH' using errcode = 'P0001';
  end if;

  return v_channel;
end;
$$;

revoke all on function private.category_is_food(uuid) from public, anon, authenticated;
revoke all on function private.default_pick_channel(uuid) from public, anon, authenticated;
revoke all on function private.resolve_pick_channel(uuid,uuid,text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Existing Picks
-- ---------------------------------------------------------------------------

update public.picks p
set channel = private.default_pick_channel(p.item_id)
where p.channel is null
  and private.category_is_food(p.category_id);

drop index if exists public.picks_one_current_per_category;

create unique index picks_one_current_per_category_channel
  on public.picks(user_id, category_id, coalesce(channel, ''))
  where status in ('active','needs_review');

create unique index picks_one_current_per_item
  on public.picks(user_id, item_id)
  where status in ('active','needs_review');

-- Every write path, including seeds and direct inserts, stores a valid channel.
-- New Picks are checked strictly. Updates come from moves the member did not
-- make (an item moved to another category), so they are corrected instead of
-- blocking the administrator.
create or replace function private.prepare_pick_channel()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.channel := private.resolve_pick_channel(new.category_id, new.item_id, new.channel);
    return new;
  end if;

  if not private.category_is_food(new.category_id) then
    new.channel := null;
    return new;
  end if;
  begin
    new.channel := private.resolve_pick_channel(new.category_id, new.item_id, new.channel);
  exception when others then
    new.channel := private.resolve_pick_channel(new.category_id, new.item_id, null);
  end;
  return new;
end;
$$;

revoke all on function private.prepare_pick_channel() from public, anon, authenticated;

drop trigger if exists picks_prepare_channel on public.picks;
create trigger picks_prepare_channel
before insert or update of channel, category_id, item_id on public.picks
for each row execute function private.prepare_pick_channel();

-- When an administrator links an item to a store or seller, current Picks whose
-- channel the item no longer offers move to the item's own channel (a packaged
-- product defaulted to online that turns out to be a restaurant). A Pick stays
-- where it is when the member already holds a Pick in the target channel.
create or replace function private.realign_pick_channels()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item uuid := coalesce(new.item_id, old.item_id);
  v_channel text;
begin
  if not exists (select 1 from public.item_channels ch where ch.item_id = v_item) then
    return null;
  end if;
  v_channel := private.default_pick_channel(v_item);

  update public.picks p
  set channel = v_channel, updated_at = now()
  where p.item_id = v_item
    and p.channel is not null
    and p.status in ('active','needs_review')
    and not exists (
      select 1 from public.item_channels ch
      where ch.item_id = v_item and ch.channel = p.channel
    )
    and not exists (
      select 1 from public.picks other
      where other.user_id = p.user_id
        and other.category_id = p.category_id
        and other.channel = v_channel
        and other.status in ('active','needs_review')
    );
  return null;
end;
$$;

revoke all on function private.realign_pick_channels() from public, anon, authenticated;

drop trigger if exists item_channels_realign_picks on public.item_channels;
create trigger item_channels_realign_picks
after insert or update or delete on public.item_channels
for each row execute function private.realign_pick_channels();

-- ---------------------------------------------------------------------------
-- change_pick / register_pick
-- ---------------------------------------------------------------------------

drop function if exists public.change_pick(uuid,uuid,text,text,text);
drop function if exists public.register_pick(uuid,uuid,text,text,text,text,text);
drop function if exists private.register_pick_impl(uuid,uuid,text,text,text,text,text);
drop function if exists private.change_pick_impl(uuid,uuid,text,text,text);

create function private.change_pick_impl(
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
  v_channel text;
  v_category public.categories%rowtype;
  v_item public.items%rowtype;
  v_current public.picks%rowtype;
  v_result public.picks%rowtype;
  v_new_pick_id uuid := gen_random_uuid();
begin
  if v_user_id is null then raise exception 'AUTH_REQUIRED' using errcode='P0001'; end if;
  if not exists(select 1 from public.profiles where id=v_user_id) then
    raise exception 'PROFILE_NOT_FOUND' using errcode='P0001';
  end if;
  if v_review is null or char_length(v_review)<1 or char_length(v_review)>100 then
    raise exception 'REVIEW_INVALID' using errcode='P0001';
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

  v_channel := private.resolve_pick_channel(p_category_id, p_item_id, p_channel);

  -- One lock per (member, category) covers every channel of the category.
  perform pg_advisory_xact_lock(
    hashtextextended(v_user_id::text||':'||p_category_id::text,0)
  );

  select * into v_current
  from public.picks
  where user_id=v_user_id
    and category_id=p_category_id
    and channel is not distinct from v_channel
    and status in ('active','needs_review')
  for update;

  if found and v_current.item_id=p_item_id then
    -- 같은 상품: 넘어오지 않은 값은 지금 저장된 값을 이어간다. 링크가 지워지면
    -- 팁도 함께 끝난다. 살 곳 없는 팁은 팁이 아니다.
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

  -- The same item cannot be a current Pick under another channel.
  if exists (
    select 1 from public.picks
    where user_id=v_user_id
      and item_id=p_item_id
      and status in ('active','needs_review')
  ) then
    raise exception 'ITEM_ALREADY_PICKED' using errcode='P0001';
  end if;

  -- 새 원픽이다. 상품이 달라졌으면 이전 구매처는 이 선택의 것이 아니다.
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

create function private.register_pick_impl(
  p_category_id uuid, p_item_id uuid, p_item_name text, p_one_line_review text,
  p_image_path text, p_thumbnail_path text, p_image_source_url text, p_channel text
)
returns public.picks language plpgsql security definer set search_path = ''
as $function$
declare
  v_user uuid := auth.uid();
  v_category public.categories%rowtype;
  v_item public.items%rowtype;
  v_result public.picks%rowtype;
begin
  if v_user is null then raise exception 'AUTH_REQUIRED' using errcode='P0001'; end if;
  if not exists(select 1 from public.profiles where id=v_user) then
    raise exception 'PROFILE_NOT_FOUND' using errcode='P0001';
  end if;
  if p_one_line_review is null or char_length(btrim(p_one_line_review)) not between 1 and 100 then
    raise exception 'REVIEW_INVALID' using errcode='P0001';
  end if;
  select * into v_category from public.categories where id=p_category_id;
  if not found or not v_category.is_visible or not v_category.is_pickable or v_category.status<>'open'
     or exists(select 1 from public.categories where parent_id=p_category_id) then
    raise exception 'CATEGORY_NOT_PICKABLE' using errcode='P0001';
  end if;
  if p_item_id is null then raise exception 'ITEM_SELECTION_REQUIRED' using errcode='P0001'; end if;
  select * into v_item from public.items where id=p_item_id for update;
  if not found then raise exception 'ITEM_NOT_FOUND' using errcode='P0001'; end if;
  if v_item.category_id<>p_category_id then raise exception 'ITEM_CATEGORY_MISMATCH' using errcode='P0001'; end if;
  if v_item.status not in ('active','discontinued') then raise exception 'ITEM_NOT_ELIGIBLE' using errcode='P0001'; end if;
  if v_item.image_path is null and v_item.thumbnail_path is null and v_item.image_source_url is null
     and (p_image_path is not null or p_thumbnail_path is not null) then
    if p_image_path is null or p_thumbnail_path is null or p_image_path=p_thumbnail_path
       or split_part(p_image_path,'/',1)<>v_user::text or split_part(p_thumbnail_path,'/',1)<>v_user::text then
      raise exception 'PHOTO_INVALID' using errcode='P0001';
    end if;
    perform 1 from storage.objects where bucket_id='item-photos' and name=p_image_path and owner_id=v_user::text
      and metadata->>'mimetype'='image/jpeg' and coalesce((metadata->>'size')::bigint,0) > 0 for share;
    if not found then raise exception 'PHOTO_INVALID' using errcode='P0001'; end if;
    perform 1 from storage.objects where bucket_id='item-photos' and name=p_thumbnail_path and owner_id=v_user::text
      and metadata->>'mimetype'='image/jpeg' and coalesce((metadata->>'size')::bigint,0) > 0 for share;
    if not found then raise exception 'PHOTO_INVALID' using errcode='P0001'; end if;
    if p_image_source_url is not null and (char_length(p_image_source_url)>2048 or p_image_source_url !~ '^https://') then
      raise exception 'PHOTO_INVALID' using errcode='P0001';
    end if;
    update public.items set image_path=p_image_path, thumbnail_path=p_thumbnail_path,
      image_source_url=p_image_source_url where id=v_item.id;
  end if;
  -- 이 경로는 아직 구매처 링크를 받지 않는다. 링크 인자를 명시적으로 비워
  -- 넘겨, 나중에 여기에도 붙일 자리를 드러내 둔다.
  v_result := private.change_pick_impl(
    p_category_id,v_item.id,btrim(p_one_line_review),null,null,p_channel
  );
  return v_result;
end;
$function$;

create function public.register_pick(
  p_category_id uuid,
  p_item_id uuid,
  p_item_name text,
  p_one_line_review text,
  p_image_path text default null,
  p_thumbnail_path text default null,
  p_image_source_url text default null,
  p_channel text default null
)
returns public.picks
language sql
set search_path to ''
as $$
  select private.register_pick_impl(
    p_category_id,p_item_id,p_item_name,p_one_line_review,
    p_image_path,p_thumbnail_path,p_image_source_url,p_channel
  );
$$;

revoke all on function private.change_pick_impl(uuid,uuid,text,text,text,text) from public,anon;
grant execute on function private.change_pick_impl(uuid,uuid,text,text,text,text) to authenticated;
revoke all on function public.change_pick(uuid,uuid,text,text,text,text) from public,anon;
grant execute on function public.change_pick(uuid,uuid,text,text,text,text) to authenticated,service_role;
revoke all on function private.register_pick_impl(uuid,uuid,text,text,text,text,text,text) from public,anon;
grant execute on function private.register_pick_impl(uuid,uuid,text,text,text,text,text,text) to authenticated;
revoke all on function public.register_pick(uuid,uuid,text,text,text,text,text,text) from public,anon;
grant execute on function public.register_pick(uuid,uuid,text,text,text,text,text,text) to authenticated,service_role;

-- ---------------------------------------------------------------------------
-- remove_pick
-- ---------------------------------------------------------------------------

drop function if exists public.remove_pick(uuid);
drop function if exists private.remove_pick_impl(uuid);

create function private.remove_pick_impl(
  p_category_id uuid,
  p_channel text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_current public.picks%rowtype;
  v_count integer;
begin
  if v_user_id is null then
    raise exception 'AUTH_REQUIRED' using errcode = 'P0001';
  end if;
  if p_channel is not null and p_channel not in ('offline','online','recipe') then
    raise exception 'PICK_CHANNEL_INVALID' using errcode = 'P0001';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(v_user_id::text || ':' || p_category_id::text, 0)
  );

  -- Without a channel the call is only unambiguous while the category holds a
  -- single current Pick (every category before per-channel food Picks).
  select count(*) into v_count
  from public.picks
  where user_id = v_user_id
    and category_id = p_category_id
    and (p_channel is null or channel = p_channel)
    and status in ('active','needs_review');

  if v_count = 0 then
    return false;
  end if;
  if v_count > 1 then
    raise exception 'PICK_CHANNEL_REQUIRED' using errcode = 'P0001';
  end if;

  select * into v_current
  from public.picks
  where user_id = v_user_id
    and category_id = p_category_id
    and (p_channel is null or channel = p_channel)
    and status in ('active','needs_review')
  for update;

  update public.picks
  set status = 'removed',
      ended_at = now(),
      replaced_by_pick_id = null,
      updated_at = now()
  where id = v_current.id;

  return true;
end;
$$;

create function public.remove_pick(
  p_category_id uuid,
  p_channel text default null
)
returns boolean
language sql
security invoker
set search_path = ''
as $$
  select private.remove_pick_impl(p_category_id, p_channel);
$$;

revoke execute on function private.remove_pick_impl(uuid,text) from public, anon;
grant execute on function private.remove_pick_impl(uuid,text) to authenticated;
revoke execute on function public.remove_pick(uuid,text) from public, anon;
grant execute on function public.remove_pick(uuid,text) to authenticated;

-- ---------------------------------------------------------------------------
-- Picks created when a product request is approved
-- ---------------------------------------------------------------------------

drop function if exists public.set_pending_item_pick_review(uuid,text);
drop function if exists private.set_pending_item_pick_review_impl(uuid,text);

create function private.set_pending_item_pick_review_impl(
  p_item_id uuid,
  p_review text,
  p_channel text
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
  if p_channel is not null and p_channel not in ('offline','online','recipe') then
    raise exception 'PICK_CHANNEL_INVALID' using errcode='P0001';
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

  insert into public.pending_item_picks(item_id,user_id,one_line_review,channel)
  values (v_item.id,v_user,v_review,p_channel)
  on conflict (item_id) do update
    set one_line_review=excluded.one_line_review,
        channel=excluded.channel,
        updated_at=now()
  returning * into v_result;

  return v_result;
end;
$$;

create function public.set_pending_item_pick_review(
  p_item_id uuid,
  p_review text,
  p_channel text default null
)
returns public.pending_item_picks
language sql
security invoker
set search_path = ''
as $$
  select private.set_pending_item_pick_review_impl(p_item_id,p_review,p_channel);
$$;

revoke all on function private.set_pending_item_pick_review_impl(uuid,text,text) from public, anon;
grant execute on function private.set_pending_item_pick_review_impl(uuid,text,text) to authenticated, service_role;
revoke all on function public.set_pending_item_pick_review(uuid,text,text) from public, anon;
grant execute on function public.set_pending_item_pick_review(uuid,text,text) to authenticated, service_role;

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
  v_channel text;
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
    -- Rejections are sent by admin_review_pending_item, which has the reason.
    return new;
  end if;

  -- The requested channel can no longer fit (for example the request was merged
  -- into an item sold elsewhere): fall back to the item's own channel rather than
  -- blocking the administrator's review.
  begin
    v_channel := private.resolve_pick_channel(v_target.category_id, v_target.id, v_intent.channel);
  exception when others then
    v_channel := private.resolve_pick_channel(v_target.category_id, v_target.id, null);
  end;

  perform pg_advisory_xact_lock(
    hashtextextended(new.created_by::text||':'||v_target.category_id::text,0)
  );
  select * into v_current
  from public.picks
  where user_id = new.created_by
    and category_id = v_target.category_id
    and channel is not distinct from v_channel
    and status in ('active','needs_review')
  for update;
  v_has_current := found;

  if v_has_current and v_current.item_id = v_target.id then
    return new;
  end if;

  if v_intent.item_id is not null
     and not exists (
       select 1 from public.picks
       where user_id = new.created_by
         and item_id = v_target.id
         and status in ('active','needs_review')
     ) then
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
    insert into public.picks(id,user_id,category_id,item_id,channel,one_line_review,status,started_at)
    values (v_pick_id,new.created_by,v_target.category_id,v_target.id,v_channel,v_intent.one_line_review,'needs_review',now());
    update public.picks set status='active' where id = v_pick_id;
  end if;

  -- The requester resolved it themselves (choosing a category that matched an
  -- existing product) and sees the result on screen already. An administrator
  -- approving their own request still gets the notification.
  if new.created_by = (select auth.uid()) and not private.is_admin(new.created_by) then
    return new;
  end if;

  -- A request resolved again with a different result (rejected, reopened, then
  -- approved) replaces its earlier notification and is unread again.
  insert into public.item_review_notifications(item_id, recipient_id, outcome, target_item_id, pick_id)
  values (new.id, new.created_by, v_outcome, v_target.id, v_pick_id)
  on conflict (item_id, recipient_id) do update
    set outcome = excluded.outcome,
        target_item_id = excluded.target_item_id,
        pick_id = excluded.pick_id,
        reason = null,
        created_at = now(),
        read_at = null
    where public.item_review_notifications.outcome is distinct from excluded.outcome;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Per-channel quota, follower notifications and AI invalidation
-- ---------------------------------------------------------------------------

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
  -- active row, so a prior replaced row in this category and channel means this
  -- is a change. A first Pick in another channel is not a change.
  if new.status <> 'active' or v_user is null or new.user_id is distinct from v_user then
    return null;
  end if;
  if not exists (
    select 1
    from public.picks prior
    where prior.user_id=v_user
      and prior.category_id=new.category_id
      and prior.channel is not distinct from new.channel
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

  -- Rapid changes in the same category and channel collapse into one
  -- notification; a Pick in another channel is its own news.
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
        and prior.channel is not distinct from new.channel
        and recent.created_at >= clock_timestamp()-interval '15 minutes'
    )
  order by f.created_at
  limit 1000
  on conflict(pick_id,recipient_id) do nothing;

  return new;
end;
$function$;

create or replace function private.invalidate_profile_ai_sources()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
declare
  affected uuid[] := '{}'::uuid[];
  affected_profile uuid;
begin
  if tg_table_schema <> 'public' then
    raise exception 'INVALID_AI_SOURCE_TRIGGER';
  end if;

  if tg_table_name = 'picks' then
    if tg_op = 'INSERT' then
      if new.status = 'active' then affected := array[new.user_id]; end if;
    elsif tg_op = 'DELETE' then
      if old.status = 'active' then affected := array[old.user_id]; end if;
    else
      if row(old.user_id, old.category_id, old.item_id, old.channel, old.status, old.one_line_review)
         is not distinct from
         row(new.user_id, new.category_id, new.item_id, new.channel, new.status, new.one_line_review) then
        return null;
      end if;
      if old.status = 'active' then affected := array_append(affected, old.user_id); end if;
      if new.status = 'active' then affected := array_append(affected, new.user_id); end if;
    end if;
  elsif tg_table_name = 'items' then
    if tg_op = 'UPDATE' and
       row(old.name, old.original_name, old.release_year, old.creator_name,
           old.collection_name, old.status, old.category_id)
       is not distinct from
       row(new.name, new.original_name, new.release_year, new.creator_name,
           new.collection_name, new.status, new.category_id) then
      return null;
    end if;
    select array_agg(distinct p.user_id) into affected
    from public.picks p
    where p.item_id = old.id and p.status = 'active';
  elsif tg_table_name = 'categories' then
    if tg_op = 'UPDATE' and
       row(old.name, old.status, old.is_visible)
       is not distinct from
       row(new.name, new.status, new.is_visible) then
      return null;
    end if;
    select array_agg(distinct p.user_id) into affected
    from public.picks p
    where p.category_id = old.id and p.status = 'active';
  else
    raise exception 'INVALID_AI_SOURCE_TRIGGER';
  end if;

  for affected_profile in
    select distinct value
    from unnest(coalesce(affected, '{}'::uuid[])) as ids(value)
    where value is not null
    order by value
  loop
    if not exists (select 1 from public.profiles where id = affected_profile) then
      continue;
    end if;

    insert into public.profile_ai_generation_limits as limits
      (profile_id, next_allowed_at, source_version)
    values (affected_profile, '-infinity'::timestamptz, 1)
    on conflict (profile_id) do update
      set source_version = limits.source_version + 1;

    -- Keep the last published comment visible until a paid refresh succeeds.
    update public.profile_ai_reviews
    set is_stale = true
    where profile_id = affected_profile and not is_stale;
  end loop;

  return null;
end;
$$;

-- ---------------------------------------------------------------------------
-- Home feed: the channel tab follows the Pick's channel
-- ---------------------------------------------------------------------------

create or replace function public.home_pick_feed_page(
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
  if p_channel is not null and p_channel not in ('offline', 'online', 'recipe') then
    raise exception 'INVALID_CHANNEL' using errcode = '22023';
  end if;

  return query
  with open_leaf_categories as materialized (
    select c.id, c.name, coalesce(gp.slug, parent.slug, c.slug) as root_slug
    from public.categories c
    left join public.categories parent on parent.id = c.parent_id
    left join public.categories gp on gp.id = parent.parent_id
    where public.category_is_open_leaf(c.id)
  )
  select p.id, p.user_id, pr.username, pr.profile_image_url,
    i.id, i.name, c.id, c.name, p.one_line_review,
    i.thumbnail_path, i.image_path, i.image_source_url, p.started_at,
    -- A food Pick shows the channel it was picked under; other Picks keep the
    -- item's channels (normally none).
    case
      when p.channel is not null then array[p.channel]
      else coalesce(
        array(
          select ch.channel
          from public.item_channels ch
          where ch.item_id = i.id
          order by ch.channel
        ),
        array[]::text[]
      )
    end
  from public.picks p
  join public.profiles pr on pr.id = p.user_id
  join public.items i on i.id = p.item_id and i.category_id = p.category_id
  join open_leaf_categories c on c.id = p.category_id
  where p.status = 'active'
    and p.user_id is distinct from (select auth.uid())
    and not private.user_is_suspended(p.user_id)
    and i.status in ('active', 'discontinued')
    and (p_root_slug is null or c.root_slug = p_root_slug)
    and (
      p_before_time is null
      or (p.started_at, p.id) < (p_before_time, p_before_id)
    )
    and (
      p_channel is null
      or p.channel = p_channel
      or (
        p.channel is null
        and exists (
          select 1
          from public.item_channels ch
          where ch.item_id = i.id
            and ch.channel = p_channel
        )
      )
    )
  order by p.started_at desc, p.id desc
  limit 21;
end;
$$;

comment on column public.picks.channel is
  'offline | online | recipe for food categories (one current Pick per category and channel); null elsewhere.';

commit;
