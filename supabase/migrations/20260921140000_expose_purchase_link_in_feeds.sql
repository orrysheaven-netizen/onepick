-- 홈·팔로잉 피드 카드에 구매처와 쇼핑꿀팁을 싣는다. docs/pick-purchase-link.md 참조.
--
-- returns table의 컬럼을 바꾸려면 drop이 필요하다. 컬럼을 더하기만 하므로
-- 배포 중인 클라이언트는 깨지지 않는다: 이 RPC를 부르는 쪽은 컬럼을 나열하지
-- 않고 받은 행에서 아는 필드만 읽는다.
--
-- 본문은 각각 20260920093018과 20260920150000의 정의를 그대로 두고 반환
-- 컬럼과 select 목록에 두 필드만 더했다. 공개 조건, 정렬, 커서 규칙, 자기
-- 원픽 제외와 차단·정지·비공개 제외는 바뀌지 않는다.
drop function if exists public.home_pick_feed_page(timestamptz, uuid);
drop function if exists public.home_following_feed_page(timestamptz, uuid);

create or replace function public.home_pick_feed_page(
  p_before_time timestamptz default null,
  p_before_id uuid default null
)
returns table(
  pick_id uuid, user_id uuid, username text, profile_image_url text,
  item_id uuid, item_name text, category_id uuid, category_name text,
  one_line_review text, thumbnail_path text, image_path text,
  image_source_url text, purchase_url text, purchase_tip text,
  started_at timestamptz
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
    i.thumbnail_path, i.image_path, i.image_source_url,
    p.purchase_url, p.purchase_tip, p.started_at
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

create or replace function public.home_following_feed_page(
  p_before_time timestamptz default null,
  p_before_id uuid default null
)
returns table(
  pick_id uuid, user_id uuid, username text, profile_image_url text,
  item_id uuid, item_name text, category_id uuid, category_name text,
  one_line_review text, thumbnail_path text, image_path text,
  image_source_url text, purchase_url text, purchase_tip text,
  started_at timestamptz
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
    i.thumbnail_path, i.image_path, i.image_source_url,
    p.purchase_url, p.purchase_tip, p.started_at
  from public.picks p
  join public.profiles pr on pr.id = p.user_id
  join public.items i on i.id = p.item_id and i.category_id = p.category_id
  join public.categories c on c.id = p.category_id
  where p.status = 'active'
    and exists (
      select 1 from public.user_follows f
      where f.follower_id = (select auth.uid()) and f.followee_id = p.user_id
    )
    and not private.user_is_suspended(p.user_id)
    and i.status in ('active', 'discontinued')
    and public.category_is_open_leaf(c.id)
    and (p_before_time is null or (p.started_at, p.id) < (p_before_time, p_before_id))
  order by p.started_at desc, p.id desc
  limit 21;
end;
$$;

revoke all on function public.home_pick_feed_page(timestamptz, uuid) from public;
revoke all on function public.home_following_feed_page(timestamptz, uuid) from public, anon;
grant execute on function public.home_pick_feed_page(timestamptz, uuid) to anon, authenticated;
grant execute on function public.home_following_feed_page(timestamptz, uuid) to authenticated;

comment on function public.home_following_feed_page(timestamptz, uuid) is
  'Home 팔로잉 tab: current public picks by people the caller follows, caller RLS, 20 rows + lookahead.';
