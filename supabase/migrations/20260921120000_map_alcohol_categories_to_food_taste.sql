-- 맥주·소주를 food 취향 차원에 매핑한다.
--
-- 두 카테고리는 20260916221838에서 열리고 선택 가능해졌지만,
-- taste_dimensions가 20260919153415에서 뒤늦게 추가될 때 매핑 목록에서
-- 빠졌다. 같은 목록에 아직 없는 카테고리(ice-cream, book, notebook,
-- ballpoint-pen)까지 들어 있으므로 정책이 아니라 누락이다.
--
-- 그 결과 같은 픽이 두 곳에서 다르게 취급된다.
--   profile_taste_composition은 category_taste_dimensions를 is_primary로
--   inner join하므로 맥주·소주 원픽이 취향 구성에서 빠지고
--   unmapped_pick_count로만 남는다.
--   analyze-profile-taste는 같은 조건이 없어 AI 평가 재료로는 넣는다.
--
-- 주류는 food 차원의 취향이므로 매핑하는 쪽으로 맞춘다. 이 마이그레이션은
-- 취향 구성에서 빠져 있던 주류 원픽을 다시 세게 만드는 변경이다.
-- AI 평가 결과는 이미 주류를 재료로 써왔으므로 달라지지 않는다.
--
-- docs/dangol-entry-direction.md 참조.

insert into public.category_taste_dimensions(
  category_id, dimension_code, weight, is_primary
)
select c.id, 'food', 100, true
from public.categories c
where c.slug in ('beer', 'soju')
on conflict (category_id, dimension_code) do update
set
  weight = excluded.weight,
  is_primary = true,
  updated_at = now();
