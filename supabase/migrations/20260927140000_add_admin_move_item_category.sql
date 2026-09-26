-- Admin "카테고리 이동": move a misclassified item to another category and take
-- every Pick (current and past) with it.
--
-- picks, item_places and item_providers reference items(id, category_id), so an
-- item's category could never change once anyone had picked it. Those three
-- foreign keys become DEFERRABLE (still INITIALLY IMMEDIATE, so every other
-- write is checked exactly as before); only the move RPC defers them while it
-- rewrites the item and its dependent rows in one transaction, then checks them
-- again before returning.
--
-- The move is all-or-nothing. It refuses instead of guessing when:
--   * the target is not an open, pickable leaf category,
--   * the item's category is owned by an external catalog (movies, books, …),
--   * a 매장 item would land in a category without the place catalog,
--   * the same place / online store already has an item in the target,
--   * an item with the same name already exists in the target (merge instead),
--   * one of its search aliases would collide with the target's names/aliases,
--   * a user who picked the item already has a current Pick in the target
--     under the same channel (one current Pick per category and food channel;
--     nobody's Pick is replaced silently).

begin;

alter table public.picks
  alter constraint picks_item_category_fk deferrable initially immediate;
alter table public.item_places
  alter constraint item_places_item_category_fk deferrable initially immediate;
alter table public.item_providers
  alter constraint item_providers_item_category_fk deferrable initially immediate;

-- Unchanged except for the row lock on the item: an alias write now waits for
-- a category move holding the item FOR UPDATE and then checks the category
-- the item ended up in (and a move waits for an alias write in flight, then
-- sees the new alias). KEY SHARE does not block ordinary item edits.
create or replace function private.prepare_item_alias()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_category_id uuid;
  v_alias text;
  v_normalized text;
begin
  v_alias := regexp_replace(btrim(new.alias),'[[:space:]]+',' ','g');
  v_normalized := lower(regexp_replace(v_alias,'[[:space:]]+','','g'));

  if char_length(v_alias) not between 1 and 100
     or char_length(v_normalized) not between 1 and 100 then
    raise exception 'ALIAS_INVALID' using errcode='P0001';
  end if;

  select category_id into v_category_id from public.items where id=new.item_id for key share;
  if not found then raise exception 'ITEM_NOT_FOUND' using errcode='P0001'; end if;

  perform pg_advisory_xact_lock(
    hashtextextended('item-alias:'||v_category_id::text||':'||v_normalized,0)
  );

  if exists(
    select 1 from public.items i
    where i.id=new.item_id and i.normalized_name=v_normalized
  ) then
    raise exception 'ALIAS_REDUNDANT' using errcode='P0001';
  end if;

  if exists(
    select 1 from public.items i
    where i.id<>new.item_id
      and i.category_id=v_category_id
      and i.status not in ('merged','rejected')
      and i.normalized_name=v_normalized
  ) then
    raise exception 'ALIAS_CONFLICT' using errcode='P0001';
  end if;

  if exists(
    select 1
    from public.item_aliases ia
    join public.items i on i.id=ia.item_id
    where ia.id<>new.id
      and ia.item_id<>new.item_id
      and i.category_id=v_category_id
      and i.status not in ('merged','rejected')
      and ia.normalized_alias=v_normalized
  ) then
    raise exception 'ALIAS_CONFLICT' using errcode='P0001';
  end if;

  new.alias := v_alias;
  new.normalized_alias := v_normalized;
  return new;
end;
$$;

revoke all on function private.prepare_item_alias() from public,anon,authenticated;

-- The channel a current Pick of p_item_id gets when it moves into
-- p_target_category_id: the same steps as the UPDATE branch of
-- private.prepare_pick_channel, which is what actually rewrites it.
create or replace function private.moved_pick_channel(
  p_target_category_id uuid,
  p_item_id uuid,
  p_channel text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.category_is_food(p_target_category_id) then
    return null;
  end if;
  begin
    return private.resolve_pick_channel(p_target_category_id, p_item_id, p_channel);
  exception when sqlstate 'P0001' then
    if sqlerrm not in ('PICK_CHANNEL_INVALID','PICK_CHANNEL_MISMATCH') then
      raise;
    end if;
    return private.resolve_pick_channel(p_target_category_id, p_item_id, null);
  end;
end;
$$;

revoke all on function private.moved_pick_channel(uuid,uuid,text)
  from public, anon, authenticated;

-- Shared by the preview and the move. The caller decides whether rows are
-- locked; the result reports the first blocking reason, or null when the move
-- can proceed.
create or replace function private.item_category_move_check(
  p_item public.items,
  p_target_category_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_place_id uuid;
  v_provider_id uuid;
  v_active_picks integer;
  v_all_picks integer;
  v_conflicts integer;
  v_reason text;
begin
  select ip.place_id into v_place_id
  from public.item_places ip where ip.item_id=p_item.id;
  select ipr.provider_id into v_provider_id
  from public.item_providers ipr where ipr.item_id=p_item.id;

  select count(*) filter (where p.status in ('active','needs_review')), count(*)
  into v_active_picks, v_all_picks
  from public.picks p
  where p.item_id=p_item.id;

  -- One current Pick per (user, category, channel): compare against the channel
  -- each Pick will have after the move.
  select count(*) into v_conflicts
  from public.picks p
  cross join lateral (
    select private.moved_pick_channel(p_target_category_id, p.item_id, p.channel) as channel
  ) moved
  where p.item_id=p_item.id
    and p.status in ('active','needs_review')
    and exists (
      select 1 from public.picks other
      where other.user_id=p.user_id
        and other.category_id=p_target_category_id
        and other.status in ('active','needs_review')
        and coalesce(other.channel,'')=coalesce(moved.channel,'')
    );

  v_reason := case
    when p_target_category_id is null or p_target_category_id=p_item.category_id
      then 'CATEGORY_UNCHANGED'
    when not public.category_is_open_leaf(p_target_category_id)
      then 'CATEGORY_NOT_PICKABLE'
    when p_item.external_source is not null
         and p_item.external_source not in ('onepick_place','onepick_provider')
      then 'ITEM_CATEGORY_LOCKED'
    when v_place_id is not null
         and not public.category_uses_place_catalog(p_target_category_id)
      then 'PLACE_CATEGORY_REQUIRED'
    when v_place_id is not null and exists (
           select 1 from public.item_places ip
           where ip.place_id=v_place_id and ip.category_id=p_target_category_id
         )
      then 'PLACE_ALREADY_LINKED'
    when v_provider_id is not null and exists (
           select 1 from public.item_providers ipr
           where ipr.provider_id=v_provider_id and ipr.category_id=p_target_category_id
         )
      then 'PROVIDER_ALREADY_LINKED'
    when exists (
           select 1 from public.items i
           where i.category_id=p_target_category_id
             and i.normalized_name=p_item.normalized_name
             and i.status in ('pending','active','discontinued')
             and i.id<>p_item.id
         )
      then 'ITEM_DUPLICATE'
    -- Same rule as item_aliases' validation: within a category a search alias
    -- never equals another live item's name or alias, in either direction.
    when exists (
           select 1
           from public.item_aliases mine
           join public.items other
             on other.category_id=p_target_category_id
            and other.id<>p_item.id
            and other.status not in ('merged','rejected')
           where mine.item_id=p_item.id
             and (other.normalized_name=mine.normalized_alias
                  or exists (select 1 from public.item_aliases theirs
                             where theirs.item_id=other.id
                               and theirs.normalized_alias=mine.normalized_alias))
         )
         or exists (
           select 1
           from public.item_aliases theirs
           join public.items other on other.id=theirs.item_id
           where other.category_id=p_target_category_id
             and other.id<>p_item.id
             and other.status not in ('merged','rejected')
             and theirs.normalized_alias=p_item.normalized_name
         )
      then 'ALIAS_CONFLICT'
    when v_conflicts>0
      then 'PICK_CONFLICT'
    else null
  end;

  return jsonb_build_object(
    'item_id', p_item.id,
    'from_category_id', p_item.category_id,
    'to_category_id', p_target_category_id,
    'active_pick_count', v_active_picks,
    'pick_count', v_all_picks,
    'conflict_count', v_conflicts,
    'blocked_reason', v_reason
  );
end;
$$;

revoke all on function private.item_category_move_check(public.items,uuid)
  from public, anon, authenticated;

create or replace function public.admin_preview_item_category_move(
  p_item_id uuid,
  p_target_category_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_item public.items%rowtype;
begin
  if not private.is_admin_mfa() then
    raise exception 'ADMIN_REQUIRED' using errcode='42501';
  end if;

  select * into v_item from public.items where id=p_item_id;
  if not found or v_item.status='merged' then
    raise exception 'ITEM_NOT_FOUND' using errcode='P0001';
  end if;

  return private.item_category_move_check(v_item,p_target_category_id);
end;
$$;

revoke all on function public.admin_preview_item_category_move(uuid,uuid) from public, anon;
grant execute on function public.admin_preview_item_category_move(uuid,uuid) to authenticated;

create or replace function private.admin_move_item_category_impl(
  p_item_id uuid,
  p_target_category_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item public.items%rowtype;
  v_check jsonb;
  v_reason text;
  v_place_id uuid;
  v_provider_id uuid;
  v_normalized text;
begin
  if not private.is_admin_mfa() then
    raise exception 'ADMIN_REQUIRED' using errcode='42501';
  end if;

  select * into v_item from public.items where id=p_item_id for update;
  if not found or v_item.status='merged' then
    raise exception 'ITEM_NOT_FOUND' using errcode='P0001';
  end if;

  -- Freeze this item's Picks so the conflict check stays true until commit.
  perform 1 from public.picks where item_id=v_item.id for update;

  -- Take the same per-category name/alias locks as private.prepare_item_alias
  -- for every name the item brings into the target, in a fixed order, so a
  -- concurrent alias write in the target cannot pass its check against the
  -- pre-move state.
  if p_target_category_id is not null then
    for v_normalized in
      select k from (
        select v_item.normalized_name as k
        union
        select ia.normalized_alias from public.item_aliases ia where ia.item_id=v_item.id
      ) keys
      order by k
    loop
      perform pg_advisory_xact_lock(
        hashtextextended('item-alias:'||p_target_category_id::text||':'||v_normalized,0)
      );
    end loop;
  end if;

  v_check := private.item_category_move_check(v_item,p_target_category_id);
  v_reason := v_check->>'blocked_reason';
  if v_reason is not null then
    raise exception '%', v_reason using errcode='P0001',
      detail=format('conflict_count=%s', v_check->>'conflict_count');
  end if;

  select place_id into v_place_id from public.item_places where item_id=v_item.id;
  select provider_id into v_provider_id from public.item_providers where item_id=v_item.id;

  set constraints public.picks_item_category_fk,
                  public.item_places_item_category_fk,
                  public.item_providers_item_category_fk deferred;

  update public.items
  set category_id=p_target_category_id,
      external_id=case external_source
        when 'onepick_place' then v_place_id::text||':'||p_target_category_id::text
        when 'onepick_provider' then v_provider_id::text||':'||p_target_category_id::text
        else external_id
      end
  where id=v_item.id;

  update public.item_places set category_id=p_target_category_id where item_id=v_item.id;
  update public.item_providers set category_id=p_target_category_id where item_id=v_item.id;
  update public.picks set category_id=p_target_category_id where item_id=v_item.id;

  -- Check the deferred keys now so a mistake fails here, not at commit.
  set constraints public.picks_item_category_fk,
                  public.item_places_item_category_fk,
                  public.item_providers_item_category_fk immediate;

  return v_check;
end;
$$;

revoke all on function private.admin_move_item_category_impl(uuid,uuid)
  from public, anon, authenticated;

create or replace function public.admin_move_item_category(
  p_item_id uuid,
  p_target_category_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.is_admin_mfa() then
    raise exception 'ADMIN_REQUIRED' using errcode='42501';
  end if;
  return private.admin_move_item_category_impl(p_item_id,p_target_category_id);
end;
$$;

revoke all on function public.admin_move_item_category(uuid,uuid) from public, anon;
grant execute on function public.admin_move_item_category(uuid,uuid) to authenticated;

commit;
