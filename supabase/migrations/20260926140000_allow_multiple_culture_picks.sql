-- 문화예술 카테고리(영화·드라마·음악·게임·책·유튜브)는 한 사람이 현재 원픽을
-- 최대 5개까지 가질 수 있다. 여러 작품을 모아야 AI 취향 분석의 근거가 늘어난다.
--
-- 규칙:
-- - categories.max_picks가 카테고리별 상한이다. 기본값 1이라 다른 카테고리는
--   지금과 똑같이 "카테고리당 하나"로 동작한다.
-- - picks.position이 카테고리 안의 순서다. 1번이 대표 원픽이다. 현재 원픽의
--   순번은 1부터 빈칸 없이 이어지고, 같은 순번은 둘일 수 없다. 순번이
--   max_picks를 넘을 수 없으므로 개수 상한도 이 두 조건으로 지켜진다.
-- - 같은 아이템을 동시에 두 번 원픽할 수 없다.
-- - 사람 수를 세는 집계(카테고리 순위, 홈 쇼케이스, 에디토리얼 픽 수)는 대표
--   원픽만 센다. 한 사람은 카테고리당 한 번만 집계된다.
-- - 피드와 AI 취향 분석은 현재 원픽 전체를 쓴다.

alter table public.categories
  add column max_picks smallint not null default 1
    constraint categories_max_picks_range check (max_picks between 1 and 5);

comment on column public.categories.max_picks is
  'How many current picks one person may hold in this category. 1 keeps the classic one-pick rule; culture categories allow up to 5.';

update public.categories
set max_picks = 5
where slug in ('movie', 'drama', 'music', 'game', 'book', 'youtube');

-- 기본값으로 채우므로 기존 행을 UPDATE하지 않는다. picks의 updated_at 트리거와
-- AI 무효화 트리거가 돌지 않아 기존 AI 코멘트 지문도 그대로 남는다.
alter table public.picks
  add column position smallint not null default 1
    constraint picks_position_range check (position between 1 and 5);

comment on column public.picks.position is
  'Order of this pick among the owner''s current picks in the category. 1 is the representative pick counted by rankings.';

-- anon/authenticated는 열 단위 SELECT 권한만 가진다. 새 열도 명시해서 연다.
grant select (max_picks) on public.categories to anon, authenticated;
grant select (position) on public.picks to anon, authenticated;

drop index public.picks_one_current_per_category;

-- 순번을 한 칸씩 당기거나 밀 때 한 UPDATE 문 안에서 같은 순번이 잠깐 겹친다.
-- 고유 인덱스는 행마다 검사해서 이를 막으므로, 문장이 끝날 때 검사하는
-- DEFERRABLE 배타 제약을 쓴다. INITIALLY IMMEDIATE라 트랜잭션 끝까지 미루지는
-- 않는다.
alter table public.picks
  add constraint picks_one_current_per_position
  exclude using btree (user_id with =, category_id with =, position with =)
  where (status in ('active', 'needs_review'))
  deferrable initially immediate;

create unique index picks_one_current_per_item
  on public.picks(user_id, item_id)
  where status in ('active', 'needs_review');

create index picks_active_representative_item_idx
  on public.picks(item_id)
  where status = 'active' and position = 1;

-- RPC가 아닌 경로로 순번이 상한을 넘지 않게 한다. 관리자가 max_picks를
-- 낮춰도 이미 있는 원픽은 지우지 않는다. 다음 쓰기부터 새 상한이 적용된다.
create or replace function private.check_pick_slot()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status in ('active', 'needs_review')
     and (
       tg_op = 'INSERT'
       or new.position is distinct from old.position
       or old.status not in ('active', 'needs_review')
     )
     and new.position > coalesce(
       (select c.max_picks from public.categories c where c.id = new.category_id), 1
     ) then
    raise exception 'PICK_LIMIT_REACHED' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

revoke all on function private.check_pick_slot() from public, anon, authenticated;

create trigger check_pick_slot
before insert or update of position, status on public.picks
for each row execute function private.check_pick_slot();

-- 남은 현재 원픽의 순번을 1부터 다시 매긴다. 호출자가 (user, category)
-- 자문 잠금을 이미 잡고 있어야 한다.
create or replace function private.compact_pick_positions(p_user_id uuid, p_category_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.picks p
  set position = ordered.next_position
  from (
    select id, row_number() over (order by position, started_at, id)::smallint as next_position
    from public.picks
    where user_id = p_user_id
      and category_id = p_category_id
      and status in ('active', 'needs_review')
  ) ordered
  where p.id = ordered.id
    and p.position <> ordered.next_position;
$$;

revoke all on function private.compact_pick_positions(uuid, uuid) from public, anon, authenticated;

-- change_pick에 바꿀 원픽을 고르는 인자를 더한다.
-- - 같은 아이템이 이미 현재 원픽이면 그 원픽의 한줄평·링크만 고친다.
-- - p_replace_pick_id가 있으면 그 원픽을 새 아이템으로 바꾸고 순번을 이어받는다.
-- - 없으면 빈 순번에 추가한다. 빈 순번이 없을 때 max_picks = 1이면 지금처럼
--   그 하나를 바꾸고, 여러 개를 허용하는 카테고리면 PICK_LIMIT_REACHED를 낸다.
--   어느 원픽을 내릴지는 사용자가 정해야 한다.
drop function if exists public.change_pick(uuid, uuid, text, text, text);
drop function if exists private.change_pick_impl(uuid, uuid, text, text, text);

create or replace function private.change_pick_impl(
  p_category_id uuid,
  p_item_id uuid,
  p_one_line_review text,
  p_purchase_url text,
  p_purchase_tip text,
  p_replace_pick_id uuid
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
  v_position smallint;
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

  perform pg_advisory_xact_lock(
    hashtextextended(v_user_id::text||':'||p_category_id::text,0)
  );

  perform 1
  from public.picks
  where user_id=v_user_id
    and category_id=p_category_id
    and status in ('active','needs_review')
  for update;

  select * into v_current
  from public.picks
  where user_id=v_user_id
    and category_id=p_category_id
    and item_id=p_item_id
    and status in ('active','needs_review');

  if found then
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

  -- 새 원픽이다. 상품이 달라졌으면 이전 구매처는 이 선택의 것이 아니다.
  v_url := v_fresh_url;
  v_tip := private.normalize_purchase_tip(p_purchase_tip, v_url);
  v_current := null;

  if p_replace_pick_id is not null then
    select * into v_current
    from public.picks
    where id=p_replace_pick_id
      and user_id=v_user_id
      and category_id=p_category_id
      and status in ('active','needs_review');
    if not found then raise exception 'PICK_NOT_FOUND' using errcode='P0001'; end if;
  else
    select min(slot)::smallint into v_position
    from generate_series(1, v_category.max_picks) as slot
    where not exists (
      select 1
      from public.picks
      where user_id=v_user_id
        and category_id=p_category_id
        and status in ('active','needs_review')
        and position=slot
    );

    if v_position is null then
      if v_category.max_picks > 1 then
        raise exception 'PICK_LIMIT_REACHED' using errcode='P0001';
      end if;
      select * into v_current
      from public.picks
      where user_id=v_user_id
        and category_id=p_category_id
        and status in ('active','needs_review')
      order by position, started_at, id
      limit 1;
    end if;
  end if;

  if v_current.id is not null then
    v_position := v_current.position;
    update public.picks
    set status='replaced',ended_at=now(),replaced_by_pick_id=v_new_pick_id,updated_at=now()
    where id=v_current.id;
  end if;

  insert into public.picks(
    id,user_id,category_id,item_id,one_line_review,purchase_url,purchase_tip,
    status,started_at,ended_at,replaced_by_pick_id,position
  ) values (
    v_new_pick_id,v_user_id,p_category_id,p_item_id,v_review,v_url,v_tip,
    'active',now(),null,null,v_position
  )
  returning * into v_result;

  return v_result;
end;
$$;

create or replace function public.change_pick(
  p_category_id uuid,
  p_item_id uuid,
  p_one_line_review text,
  p_purchase_url text default null,
  p_purchase_tip text default null,
  p_replace_pick_id uuid default null
)
returns public.picks
language sql
set search_path to ''
as $$
  select private.change_pick_impl(
    p_category_id,p_item_id,p_one_line_review,p_purchase_url,p_purchase_tip,p_replace_pick_id
  );
$$;

revoke all on function private.change_pick_impl(uuid,uuid,text,text,text,uuid) from public,anon;
revoke all on function public.change_pick(uuid,uuid,text,text,text,uuid) from public,anon;
grant execute on function private.change_pick_impl(uuid,uuid,text,text,text,uuid) to authenticated;
grant execute on function public.change_pick(uuid,uuid,text,text,text,uuid) to authenticated,service_role;

-- register_pick_impl은 5인자 change_pick_impl을 불렀다. 본문은 그대로 두고
-- 호출만 6인자로 옮긴다. 새 아이템 등록은 빈 순번에 추가한다.
create or replace function private.register_pick_impl(
  p_category_id uuid, p_item_id uuid, p_item_name text, p_one_line_review text,
  p_image_path text, p_thumbnail_path text, p_image_source_url text
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
  v_result := private.change_pick_impl(p_category_id,v_item.id,btrim(p_one_line_review),null,null,null);
  return v_result;
end;
$function$;

-- 원픽 해제는 어떤 원픽을 내릴지 pick id로 받는다. 카테고리만 넘기는 기존
-- 호출은 원픽이 하나일 때만 그대로 동작하고, 여럿이면 PICK_ID_REQUIRED를 낸다.
-- 내린 뒤 남은 순번을 당겨서 다음 원픽이 대표가 된다.
drop function if exists public.remove_pick(uuid);
drop function if exists private.remove_pick_impl(uuid);

create or replace function private.remove_pick_impl(p_category_id uuid, p_pick_id uuid)
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

  perform pg_advisory_xact_lock(
    hashtextextended(v_user_id::text || ':' || p_category_id::text, 0)
  );

  if p_pick_id is null then
    select count(*) into v_count
    from public.picks
    where user_id = v_user_id
      and category_id = p_category_id
      and status in ('active','needs_review');
    if v_count > 1 then
      raise exception 'PICK_ID_REQUIRED' using errcode = 'P0001';
    end if;
  end if;

  select * into v_current
  from public.picks
  where user_id = v_user_id
    and category_id = p_category_id
    and (p_pick_id is null or id = p_pick_id)
    and status in ('active','needs_review')
  for update;

  if not found then
    return false;
  end if;

  update public.picks
  set status = 'removed',
      ended_at = now(),
      replaced_by_pick_id = null,
      updated_at = now()
  where id = v_current.id;

  perform private.compact_pick_positions(v_user_id, p_category_id);

  return true;
end;
$$;

create or replace function public.remove_pick(
  p_category_id uuid,
  p_pick_id uuid default null
)
returns boolean
language sql
set search_path = ''
as $$
  select private.remove_pick_impl(p_category_id, p_pick_id);
$$;

revoke all on function private.remove_pick_impl(uuid, uuid) from public, anon;
revoke all on function public.remove_pick(uuid, uuid) from public, anon;
grant execute on function private.remove_pick_impl(uuid, uuid) to authenticated;
grant execute on function public.remove_pick(uuid, uuid) to authenticated, service_role;

-- 대표 원픽 지정: 고른 원픽을 1번으로 올리고 그 앞에 있던 원픽을 한 칸씩
-- 민다. started_at은 바꾸지 않으므로 피드 순서도 그대로다.
create or replace function private.set_representative_pick_impl(p_pick_id uuid)
returns public.picks
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_pick public.picks%rowtype;
  v_result public.picks%rowtype;
begin
  if v_user_id is null then
    raise exception 'AUTH_REQUIRED' using errcode = 'P0001';
  end if;

  select * into v_pick from public.picks where id = p_pick_id;
  if not found or v_pick.user_id <> v_user_id then
    raise exception 'PICK_NOT_FOUND' using errcode = 'P0001';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(v_user_id::text || ':' || v_pick.category_id::text, 0)
  );

  select * into v_pick from public.picks where id = p_pick_id for update;
  if not found
     or v_pick.user_id <> v_user_id
     or v_pick.status not in ('active','needs_review') then
    raise exception 'PICK_NOT_FOUND' using errcode = 'P0001';
  end if;

  if v_pick.position = 1 then
    return v_pick;
  end if;

  update public.picks
  set position = case when id = v_pick.id then 1 else position + 1 end
  where user_id = v_user_id
    and category_id = v_pick.category_id
    and status in ('active','needs_review')
    and (id = v_pick.id or position < v_pick.position);

  select * into v_result from public.picks where id = v_pick.id;
  return v_result;
end;
$$;

create or replace function public.set_representative_pick(p_pick_id uuid)
returns public.picks
language sql
set search_path = ''
as $$
  select private.set_representative_pick_impl(p_pick_id);
$$;

revoke all on function private.set_representative_pick_impl(uuid) from public, anon;
revoke all on function public.set_representative_pick(uuid) from public, anon;
grant execute on function private.set_representative_pick_impl(uuid) to authenticated;
grant execute on function public.set_representative_pick(uuid) to authenticated, service_role;

-- 사람 수를 세는 집계는 대표 원픽만 센다. 본문은 기존 정의와 같고
-- position = 1 조건만 더했다.
create or replace function public.category_top_items(p_category_id uuid)
returns table(item_id uuid, name text, thumbnail_path text, pick_count bigint, rank bigint, is_tied boolean, image_path text, image_source_url text)
language sql
stable
set search_path to ''
as $function$
  with totals as (
    select i.id, i.name, i.thumbnail_path, i.image_path, i.image_source_url, count(*) as pick_count
    from public.picks p
    join public.items i on i.id = p.item_id and i.category_id = p.category_id
    where p.category_id = p_category_id
      and p.status = 'active'
      and p.position = 1
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
$function$;

create or replace function public.category_top_items_v2(p_category_id uuid)
returns table(item_id uuid, name text, thumbnail_path text, pick_count bigint, rank bigint, is_tied boolean, image_path text, image_source_url text, official_url text, market_availability_status text)
language sql
stable
set search_path to ''
as $function$
  with totals as (
    select i.id, i.name, i.thumbnail_path, i.image_path, i.image_source_url,
      i.official_url, i.market_availability_status, count(*) as pick_count
    from public.picks p
    join public.items i on i.id=p.item_id and i.category_id=p.category_id
    where p.category_id=p_category_id
      and p.status='active'
      and p.position=1
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
$function$;

create or replace function public.home_showcase()
returns table(minimum_pick_count integer, items jsonb)
language sql
stable
set search_path to ''
as $function$
  with totals as (
    select i.id, i.name, i.image_path, i.thumbnail_path, i.image_source_url,
      i.official_url, i.market_availability_status,
      c.id as category_id, c.name as category_name,
      count(*) as pick_count, max(p.started_at) as last_picked_at
    from public.picks p
    join public.items i on i.id = p.item_id and i.category_id = p.category_id
    join public.categories c on c.id = p.category_id
    where p.status = 'active'
      and p.position = 1
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
$function$;

create or replace function public.home_showcase_page(p_before_time timestamp with time zone default null::timestamp with time zone, p_after_id uuid default null::uuid)
returns table(minimum_pick_count integer, items jsonb)
language sql
stable
set search_path to ''
as $function$
  with totals as (
    select i.id, i.name, i.image_path, i.thumbnail_path, i.image_source_url,
      i.official_url, i.market_availability_status,
      c.id as category_id, c.name as category_name,
      count(*) as pick_count, max(p.started_at) as last_picked_at
    from public.picks p
    join public.items i on i.id = p.item_id and i.category_id = p.category_id
    join public.categories c on c.id = p.category_id
    where p.status = 'active'
      and p.position = 1
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
        and p.position = 1
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
$function$;

create or replace function public.home_editorial_items(p_limit integer default 6)
returns table(item_id uuid, name text, category_id uuid, category_name text, category_path text, image_path text, thumbnail_path text, image_source_url text, editorial_note text, editorial_priority integer, pick_count bigint)
language sql
stable
set search_path to ''
as $function$
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
        and p.position = 1
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
$function$;

-- AI 취향 분석의 인기 비율: "이 카테고리에 원픽이 있는 사람 중 이 항목을 고른
-- 사람의 비율"이다. 원픽을 여러 개 가진 사람도 분모에서 한 번만 센다.
-- 같은 아이템은 한 사람이 한 번만 원픽할 수 있으므로 분자는 행 수 그대로다.
create or replace function public.profile_ai_pick_popularity(p_item_ids uuid[])
returns table (
  item_id uuid,
  category_id uuid,
  item_pick_count bigint,
  category_pick_count bigint,
  ranking_min_sample integer
)
language sql stable security invoker set search_path = ''
as $$
  with target_items as (
    select i.id as item_id, i.category_id, c.ranking_min_sample
    from public.items i
    join public.categories c on c.id = i.category_id
    where i.id = any(p_item_ids)
  ),
  item_counts as (
    select p.item_id, count(*) as item_pick_count
    from public.picks p
    where p.status = 'active' and p.item_id = any(p_item_ids)
    group by p.item_id
  ),
  category_counts as (
    select p.category_id, count(distinct p.user_id) as category_pick_count
    from public.picks p
    where p.status = 'active'
      and p.category_id in (select category_id from target_items)
    group by p.category_id
  )
  select ti.item_id, ti.category_id,
    coalesce(ic.item_pick_count, 0) as item_pick_count,
    coalesce(cc.category_pick_count, 0) as category_pick_count,
    ti.ranking_min_sample
  from target_items ti
  left join item_counts ic on ic.item_id = ti.item_id
  left join category_counts cc on cc.category_id = ti.category_id;
$$;

-- 취향 구성 비율은 카테고리 단위로 센다. 영화를 5개 고른 사람의 '문화' 비중이
-- 영화 1개를 고른 사람보다 다섯 배로 부풀지 않게, 한 카테고리의 원픽들은 합쳐서
-- 1로 친다. pick_count는 화면 표시용 실제 원픽 수로 남긴다. 원픽이 카테고리당
-- 하나인 사람의 결과는 이전과 같다.
create or replace function public.profile_taste_composition(p_profile_id uuid)
returns jsonb
language sql
stable
set search_path to ''
as $function$
  with visible_picks as (
    select
      p.id as pick_id,
      p.category_id,
      c.name as category_name,
      c.slug as category_slug
    from public.picks p
    join public.categories c on c.id = p.category_id
    join public.items i on i.id = p.item_id and i.category_id = p.category_id
    where p.user_id = p_profile_id
      and p.status = 'active'
      and i.status in ('active','discontinued')
      and c.status = 'open'
      and c.is_visible = true
      and c.is_pickable = true
  ),
  mapped as (
    select
      vp.pick_id,
      vp.category_id,
      vp.category_name,
      vp.category_slug,
      td.dimension_code,
      d.name as dimension_name,
      d.display_order
    from visible_picks vp
    join public.category_taste_dimensions td
      on td.category_id = vp.category_id
     and td.is_primary = true
    join public.taste_dimensions d
      on d.code = td.dimension_code
  ),
  dimension_totals as (
    select
      m.dimension_code,
      m.dimension_name,
      min(m.display_order) as display_order,
      count(*)::int as pick_count,
      count(distinct m.category_id)::int as category_count
    from mapped m
    group by m.dimension_code, m.dimension_name
  ),
  category_totals as (
    select
      m.dimension_code,
      m.category_id,
      m.category_name,
      m.category_slug,
      count(*)::int as pick_count
    from mapped m
    group by
      m.dimension_code,
      m.category_id,
      m.category_name,
      m.category_slug
  ),
  denominator as (
    select count(distinct category_id)::numeric as mapped_category_count
    from mapped
  )
  select jsonb_build_object(
    'profile_id', p_profile_id,
    'total_pick_count', (select count(*)::int from visible_picks),
    'mapped_pick_count', (select count(*)::int from mapped),
    'unmapped_pick_count',
      (select count(*)::int from visible_picks)
      - (select count(*)::int from mapped),
    'dimensions',
    coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'code', dt.dimension_code,
          'name', dt.dimension_name,
          'pick_count', dt.pick_count,
          'category_count', dt.category_count,
          'percentage',
            case
              when den.mapped_category_count <= 0 then 0
              else round((dt.category_count::numeric / den.mapped_category_count) * 100, 1)
            end,
          'categories',
            coalesce((
              select jsonb_agg(
                jsonb_build_object(
                  'category_id', ct.category_id,
                  'category_name', ct.category_name,
                  'category_slug', ct.category_slug,
                  'pick_count', ct.pick_count
                )
                order by ct.pick_count desc, ct.category_name, ct.category_id
              )
              from category_totals ct
              where ct.dimension_code = dt.dimension_code
            ), '[]'::jsonb)
        )
        order by dt.category_count desc, dt.pick_count desc, dt.display_order, dt.dimension_code
      )
      from dimension_totals dt
      cross join denominator den
    ), '[]'::jsonb)
  );
$function$;

-- 교체 쿼터: 원픽이 하나인 카테고리는 기존 규칙 그대로다. 여러 개를 허용하는
-- 카테고리에서는 빈 순번에 추가하는 것은 교체가 아니므로 쿼터를 쓰지 않고,
-- 기존 원픽을 실제로 바꾼 경우(replaced_by_pick_id가 새 원픽을 가리킴)만 센다.
create or replace function private.limit_pick_change()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_user uuid := auth.uid();
  v_now timestamptz := clock_timestamp();
  v_count integer;
  v_max_picks smallint;
begin
  -- Initial Picks are part of onboarding and do not consume replacement quota.
  -- change_pick_impl marks the previous Pick as replaced before inserting the new
  -- active row, so a prior replaced row in this category means this is a change.
  if new.status <> 'active' or v_user is null or new.user_id is distinct from v_user then
    return null;
  end if;

  select c.max_picks into v_max_picks from public.categories c where c.id = new.category_id;

  if coalesce(v_max_picks, 1) > 1 then
    if not exists (
      select 1 from public.picks prior where prior.replaced_by_pick_id = new.id
    ) then
      return null;
    end if;
  elsif not exists (
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
