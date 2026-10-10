-- #879 Featured Pick data contract. Draft only: production deployment requires separate approval.
-- The original Pick, review, list and aggregate data never change for highlighting.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

create table private.profile_featured_picks (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  pick_id uuid references public.picks(id) on delete set null,
  revision bigint not null default 0 check (revision >= 0),
  updated_at timestamptz not null default now()
);
create index profile_featured_picks_pick_idx on private.profile_featured_picks(pick_id)
  where pick_id is not null;
alter table private.profile_featured_picks enable row level security;
revoke all on private.profile_featured_picks from public, anon, authenticated;
grant all on private.profile_featured_picks to service_role;
comment on table private.profile_featured_picks is
  'One optional featured Pick per owner. NULL clears only the highlight; revision survives resets. Access through narrow RPCs.';

-- Content eligibility is independent of MVP profile tabs and viewer relations.
-- Suspensions and mutual blocks hide on READ; they do not destroy this reference.
create function private.featured_pick_content_eligible(p public.picks)
returns boolean language sql stable security definer set search_path = '' as $$
  select p.id is not null
    and p.status = 'active'
    and p.ended_at is null
    and p.review_deleted_at is null
    and exists (
      select 1 from public.items i
      join public.categories c on c.id = i.category_id
      where i.id = p.item_id and i.category_id = p.category_id
        and i.status in ('active','discontinued')
        and c.is_visible
        and c.status in ('open','paused','closed')
        and coalesce(
          nullif(btrim(i.thumbnail_path),''),
          nullif(btrim(i.image_path),''),
          nullif(btrim(i.image_source_url),'')
        ) is not null
    );
$$;
revoke all on function private.featured_pick_content_eligible(public.picks)
  from public, anon, authenticated;

-- Only approved item metadata, not pending photo candidates or private history.
create function private.featured_pick_card(p public.picks)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'pick_id', p.id,
    'item_id', p.item_id,
    'category_id', p.category_id,
    'category_name', c.name,
    'item_name', i.name,
    'channel', p.channel,
    'one_line_review', p.one_line_review,
    'thumbnail_path', i.thumbnail_path,
    'image_path', i.image_path,
    'image_source_url', i.image_source_url
  )
  from public.items i join public.categories c on c.id = i.category_id
  where i.id = p.item_id and i.category_id = p.category_id;
$$;
revoke all on function private.featured_pick_card(public.picks)
  from public, anon, authenticated;

-- A visitor must not discover a suspended/blocked author's featured content.
-- Existing public Pick/profile RLS is mirrored explicitly because this is a definer RPC.
create function public.get_profile_featured_pick(p_profile_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_viewer uuid := auth.uid();
  v_owner boolean := v_viewer is not null and v_viewer = p_profile_id;
  v_row private.profile_featured_picks%rowtype;
  v_pick public.picks%rowtype;
  v_card jsonb := null;
  v_revision bigint := 0;
begin
  if p_profile_id is null then
    return jsonb_build_object('featured_pick', null);
  end if;
  select * into v_row from private.profile_featured_picks where user_id = p_profile_id;
  if v_owner then v_revision := coalesce(v_row.revision,0); end if;
  if not private.is_user_suspended(p_profile_id)
     and (v_owner or not coalesce(private.users_blocked(v_viewer,p_profile_id),false))
  then
    if v_row.pick_id is not null then
      select * into v_pick from public.picks
      where id = v_row.pick_id and user_id = p_profile_id;
      if found and private.featured_pick_content_eligible(v_pick) then
        v_card := private.featured_pick_card(v_pick);
      end if;
    end if;
  end if;
  if v_owner then
    return jsonb_build_object('featured_pick',v_card,'revision',v_revision);
  end if;
  return jsonb_build_object('featured_pick',v_card);
end;
$$;
revoke all on function public.get_profile_featured_pick(uuid) from public,anon,authenticated;
grant execute on function public.get_profile_featured_pick(uuid) to anon,authenticated;

-- Keyset pagination, total number of pages unbounded. Owner-only.
create function public.list_my_featured_pick_candidates(
  p_before_started_at timestamptz default null,
  p_before_id uuid default null,
  p_limit integer default 30
)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_user uuid := auth.uid();
  v_limit integer := least(greatest(coalesce(p_limit,30),1),50);
  v_items jsonb;
  v_last_started_at timestamptz;
  v_last_id uuid;
  v_has_more boolean;
begin
  if v_user is null then raise exception 'AUTH_REQUIRED' using errcode='P0001'; end if;
  if private.is_user_suspended(v_user) then
    raise exception 'USER_SUSPENDED' using errcode='P0001';
  end if;
  if (p_before_started_at is null) <> (p_before_id is null) then
    raise exception 'CURSOR_INVALID' using errcode='P0001';
  end if;

  with candidates as materialized (
    select p.id,p.started_at,private.featured_pick_card(p) as card
    from public.picks p
    where p.user_id = v_user
      and private.featured_pick_content_eligible(p)
      and (p_before_started_at is null
        or (p.started_at,p.id) < (p_before_started_at,p_before_id))
    order by p.started_at desc,p.id desc
    limit v_limit + 1
  ), page as (
    select * from candidates order by started_at desc,id desc limit v_limit
  )
  select
    coalesce((select jsonb_agg(card order by started_at desc,id desc) from page),'[]'::jsonb),
    (select count(*) > v_limit from candidates),
    (select started_at from page order by started_at,id limit 1),
    (select id from page order by started_at,id limit 1)
  into v_items,v_has_more,v_last_started_at,v_last_id;

  return jsonb_build_object('items',v_items,'next_cursor',
    case when v_has_more then
      jsonb_build_object('started_at',v_last_started_at,'id',v_last_id)
    else null end
  );
end;
$$;
revoke all on function public.list_my_featured_pick_candidates(timestamptz,uuid,integer)
  from public,anon,authenticated;
grant execute on function public.list_my_featured_pick_candidates(timestamptz,uuid,integer)
  to authenticated;

-- Revision CAS handles two devices, including the first write when no row exists.
-- Lock target category, item, Pick, then featured record. Concurrency/lock-order
-- must additionally be verified in a two-session fixture before deployment.
create function public.set_my_featured_pick(p_pick_id uuid, p_expected_revision bigint)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := auth.uid();
  v_pick public.picks%rowtype;
  v_pick_lookup public.picks%rowtype;
  v_row private.profile_featured_picks%rowtype;
begin
  if v_user is null then raise exception 'AUTH_REQUIRED' using errcode='P0001'; end if;
  if private.is_user_suspended(v_user) then
    raise exception 'USER_SUSPENDED' using errcode='P0001';
  end if;
  if not exists (select 1 from public.profiles where id = v_user) then
    raise exception 'PROFILE_NOT_FOUND' using errcode='P0001';
  end if;
  if p_expected_revision is null or p_expected_revision < 0 then
    raise exception 'FEATURED_PICK_CONFLICT' using errcode='P0001';
  end if;

  if p_pick_id is not null then
    -- Read identity only; refuse to reveal whether another member owns this ID.
    select * into v_pick_lookup from public.picks
    where id = p_pick_id and user_id = v_user;
    if not found then
      raise exception 'FEATURED_PICK_INELIGIBLE' using errcode='P0001';
    end if;
    -- Lock scope before Pick to avoid reading eligibility during publication changes.
    perform 1 from public.categories
      where id = v_pick_lookup.category_id for share;
    perform 1 from public.items
      where id = v_pick_lookup.item_id for share;
    select * into v_pick from public.picks
      where id = p_pick_id and user_id = v_user for update;
    if not found
       or v_pick.item_id is distinct from v_pick_lookup.item_id
       or v_pick.category_id is distinct from v_pick_lookup.category_id
       or not private.featured_pick_content_eligible(v_pick) then
      raise exception 'FEATURED_PICK_INELIGIBLE' using errcode='P0001';
    end if;
  end if;

  insert into private.profile_featured_picks(user_id,pick_id,revision)
  values (v_user,null,0) on conflict (user_id) do nothing;
  select * into v_row from private.profile_featured_picks
    where user_id = v_user for update;
  if v_row.revision <> p_expected_revision then
    raise exception 'FEATURED_PICK_CONFLICT' using errcode='P0001';
  end if;
  -- A NULL -> NULL on an unchanged account is a successful no-op.
  if v_row.pick_id is distinct from p_pick_id then
    update private.profile_featured_picks
    set pick_id = p_pick_id, revision = revision+1, updated_at = now()
    where user_id = v_user returning * into v_row;
  end if;
  return jsonb_build_object(
    'pick_id',v_row.pick_id,'revision',v_row.revision,'updated_at',v_row.updated_at);
end;
$$;
revoke all on function public.set_my_featured_pick(uuid,bigint)
  from public,anon,authenticated;
grant execute on function public.set_my_featured_pick(uuid,bigint) to authenticated;

-- Auto-unset only if the *currently selected* source loses content eligibility.
-- Conditional updates protect a new selection B against an old A's late event.
create function private.featured_pick_unset_if_invalid(p_pick_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_pick public.picks%rowtype;
begin
  select * into v_pick from public.picks where id = p_pick_id;
  if not found or not private.featured_pick_content_eligible(v_pick) then
    update private.profile_featured_picks
    set pick_id=null,revision=revision+1,updated_at=now()
    where pick_id=p_pick_id;
  end if;
end;
$$;
revoke all on function private.featured_pick_unset_if_invalid(uuid)
  from public,anon,authenticated;

create function private.featured_pick_after_pick_change()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    update private.profile_featured_picks
    set pick_id=null,revision=revision+1,updated_at=now()
    where pick_id=old.id;
    return old;
  end if;
  perform private.featured_pick_unset_if_invalid(new.id);
  return new;
end;
$$;
revoke all on function private.featured_pick_after_pick_change()
  from public,anon,authenticated;
create trigger picks_unset_invalid_featured
after update of status,ended_at,review_deleted_at,user_id,item_id,category_id,channel
on public.picks for each row execute function private.featured_pick_after_pick_change();
create trigger picks_unset_deleted_featured
before delete on public.picks for each row execute function private.featured_pick_after_pick_change();

create function private.featured_pick_after_item_change()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  for v_id in
    select f.pick_id from private.profile_featured_picks f
    join public.picks p on p.id=f.pick_id where p.item_id=new.id
  loop
    perform private.featured_pick_unset_if_invalid(v_id);
  end loop;
  return new;
end;
$$;
revoke all on function private.featured_pick_after_item_change()
  from public,anon,authenticated;
create trigger items_unset_invalid_featured
after update of status,image_path,thumbnail_path,image_source_url,category_id
on public.items for each row execute function private.featured_pick_after_item_change();

create function private.featured_pick_after_category_change()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  for v_id in
    select f.pick_id from private.profile_featured_picks f
    join public.picks p on p.id=f.pick_id where p.category_id=new.id
  loop
    perform private.featured_pick_unset_if_invalid(v_id);
  end loop;
  return new;
end;
$$;
revoke all on function private.featured_pick_after_category_change()
  from public,anon,authenticated;
create trigger categories_unset_invalid_featured
after update of status,is_visible
on public.categories for each row execute function private.featured_pick_after_category_change();

comment on function public.set_my_featured_pick(uuid,bigint) is
  'Owner-only revision-CAS highlight change. No mutation of public.picks. Production apply requires explicit approval.';
commit;
