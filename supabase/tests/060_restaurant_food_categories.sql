begin;
create extension if not exists pgtap with schema extensions;
select plan(1);
set local plpgsql.check_asserts = on;

select lives_ok($test$
do $flow$
declare
  v_expected text[] := array['daechang','makchang','yeomtong','special-yang','gopchang-jeongol','pork-neck','pork-jowl','pork-gabrisal','pork-ribs','beef-ribs','beef-short-rib-meat','hanwoo-grill','bossam','spicy-pork','dakgalbi','chicken-feet','duck-meat','lamb-skewers','pyeongyang-naengmyeon','hamheung-naengmyeon','milmyeon','kalguksu','sujebi','janchi-guksu','bibim-guksu','makguksu','soba','japanese-ramen','jjajangmyeon','jjamppong','tantanmen','malatang','mala-xiangguo','pork-gukbap','sundae-guk','seolleongtang','gomtang','galbitang','haejangguk','gamjatang','chueotang','yukgaejang','samgyetang','kimchi-jjigae','doenjang-jjigae','cheonggukjang','budae-jjigae','dakbokkeumtang','maeuntang','bibimbap','gimbap','omurice','curry','rice-bowl','sushi','sashimi','mulhoe','grilled-shellfish','steamed-shellfish','agujjim','nakji','jjukkumi','blue-crab','spicy-marinated-crab','grilled-fish','sundae','fried-snacks','hotdog','toast','burger','fried-chicken','donut','financier','madeleine','tart','pudding','bingsu'];
  v_slug text;
begin
  assert (
    select count(*) = cardinality(v_expected)
    from public.categories
    where slug = any(v_expected)
  ), 'Every restaurant MVP leaf is present exactly once';

  foreach v_slug in array v_expected loop
    assert (
      select status='open' and is_visible and is_pickable and public.category_is_open_leaf(id)
      from public.categories where slug=v_slug
    ), 'New restaurant category must be an open visible pickable leaf: '||v_slug;

    assert exists(
      select 1 from public.category_catalog_sources s
      join public.categories c on c.id=s.category_id
      where c.slug=v_slug and s.mode='internal' and s.is_enabled
    ), 'New restaurant category must use the internal catalog: '||v_slug;
  end loop;

  assert (
    select status='open' and is_visible and not is_pickable
    from public.categories where slug='food-soups-rice'
  ), 'Soup/rice group is a visible non-pickable parent';

  assert (
    select status='paused' and not is_visible and not is_pickable
    from public.categories where slug='naengmyeon'
  ), 'Unused broad 냉면 is replaced by detailed leaves';

  assert (
    select status='paused' and not is_visible and not is_pickable
    from public.categories where slug='soup-stew'
  ), 'Unused broad 국/탕 is replaced by detailed leaves';

  assert (
    select status='open' and is_visible and is_pickable
    from public.categories where slug='ramen'
  ), 'Existing ramen remains unchanged and pickable';

  assert exists(
    select 1 from public.search_pick_categories('평냉')
    where name='평양냉면' and matched_term='평냉' and match_kind='alias'
  ), '평냉 resolves to 평양냉면';

  assert exists(
    select 1 from public.search_pick_categories('스시')
    where name='초밥' and matched_term='스시' and match_kind='alias'
  ), '스시 resolves to 초밥';

  assert exists(
    select 1 from public.search_pick_categories('순댓국')
    where name='순대국' and matched_term='순댓국' and match_kind='alias'
  ), '순댓국 resolves to 순대국';

  assert exists(
    select 1 from public.search_pick_categories('버거')
    where name='햄버거' and matched_term='버거' and match_kind='alias'
  ), '버거 resolves to 햄버거';

  assert not exists(
    select 1 from public.search_pick_categories('냉면')
    where name='냉면'
  ), 'Paused broad 냉면 no longer appears as a pick category';

  assert exists(
    select 1 from public.search_pick_categories('냉면')
    where name in ('평양냉면','함흥냉면')
  ), 'Detailed 냉면 categories remain discoverable';
end;
$flow$;
$test$, 'Restaurant-first food taxonomy is detailed, searchable and data-safe');

select * from finish();
rollback;
