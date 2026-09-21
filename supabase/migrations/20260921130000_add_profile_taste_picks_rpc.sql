-- 취향 평가가 쓰는 원픽 한 벌을 한 곳에 정의한다.
--
-- 지금 이 조건은 두 Edge Function에 각각 PostgREST 질의로 적혀 있다.
--   profile-ai-status      자격 개수(5개/10개)와 재평가 변경 건수를 같은 행에서 센다.
--   analyze-profile-taste  AI가 읽는 재료를 만든다.
--
-- 두 곳의 조건이 갈리면 조용히 깨진다. 재료 쪽에만 취향 조건을 넣으면 자격
-- 판정은 "5/5 완료"를 주는데 생성이 재료 부족으로 실패하고, 자격 쪽에만
-- 넣으면 취향이 아닌 원픽이 계속 AI 재료로 들어간다. 그래서 조건을 문장
-- 두 개로 두지 않고 함수 하나로 둔다. 분모가 같다는 것이 규칙이 아니라
-- 구조가 되어야 한다.
--
-- 기존 두 질의의 조건(본인, active 픽, 보이는 카테고리, active/discontinued
-- 아이템, 상한 50)은 그대로 두고 취향 차원 매핑 조건만 더한다. 카테고리의
-- status나 is_pickable은 기존 질의도 보지 않으므로 여기서도 보지 않는다.
--
-- 매핑이 없는 카테고리는 취향 평가에서 빠진다. 이것이 온라인·오프라인 생활
-- 서비스를 취향 평가 대상에서 제외하는 스위치이며, 관리자만 쓸 수 있는
-- category_taste_dimensions가 그 스위치다. 화면이나 함수에 카테고리를
-- 하드코딩하지 않는다. docs/life-service-entry-direction.md 참조.
--
-- security invoker를 유지해 analyze-profile-taste의 현재 동작을 보존한다.
-- 그쪽은 anon 키 클라이언트로 읽으며 공개 프로필 여부를 따로 확인한다.

create or replace function public.profile_taste_picks(p_profile_id uuid)
returns table(
  pick_id uuid,
  category_id uuid,
  category_name text,
  item_id uuid,
  item_name text,
  item_original_name text,
  item_release_year smallint,
  item_creator_name text,
  item_collection_name text,
  one_line_review text,
  updated_at timestamptz
)
language sql
stable
security invoker
set search_path = ''
as $function$
  select
    p.id,
    p.category_id,
    c.name,
    i.id,
    i.name,
    i.original_name,
    i.release_year,
    i.creator_name,
    i.collection_name,
    p.one_line_review,
    p.updated_at
  from public.picks p
  join public.categories c on c.id = p.category_id
  join public.items i on i.id = p.item_id and i.category_id = p.category_id
  where p.user_id = p_profile_id
    and p.status = 'active'
    and c.is_visible = true
    and i.status in ('active', 'discontinued')
    and exists (
      select 1
      from public.category_taste_dimensions td
      where td.category_id = c.id
        and td.is_primary
    )
  order by p.id
  limit 50;
$function$;

revoke all on function public.profile_taste_picks(uuid) from public;
grant execute on function public.profile_taste_picks(uuid) to anon, authenticated, service_role;

comment on function public.profile_taste_picks(uuid) is
  'Picks that feed the AI taste review: active picks in visible, taste-mapped categories. One definition for both the eligibility gate and the generation material.';
