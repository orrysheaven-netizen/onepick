begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

select is(
  (select c.slug from public.recipe_dish_suggestions('백종원 김치찌개 황금레시피') r
   join public.categories c on c.id=r.category_id limit 1),
  'kimchi-jjigae',
  'the dish named in the title comes first'
);

select is(
  (select r.name from public.recipe_dish_suggestions('초간단 닭도리탕 만들기') r limit 1),
  '닭볶음탕',
  'search terms match too (닭도리탕 → 닭볶음탕)'
);

select ok(
  (select bool_and(public.category_accepts_recipe(r.category_id))
   from public.recipe_dish_suggestions('된장찌개 부대찌개 한 번에') r),
  'every suggestion is a dish that accepts recipes'
);

select ok(
  (select count(*) from public.recipe_dish_suggestions('된장찌개 부대찌개 한 번에')) >= 2,
  'a title naming two dishes suggests both'
);

select is(
  (select count(*)::int from public.recipe_dish_suggestions('오늘의 브이로그')),
  0,
  'a title without a dish suggests nothing'
);

select ok(
  not exists (select 1 from public.recipe_dish_suggestions('레시피 모음') r
              join public.categories c on c.id=r.category_id where c.slug='recipe'),
  'the retired 레시피 category is never suggested'
);

select ok(
  has_function_privilege('authenticated','public.recipe_dish_suggestions(text)','execute')
  and not has_function_privilege('anon','public.recipe_dish_suggestions(text)','execute'),
  'signed-in members can ask for suggestions'
);

-- A video request for a dish not in the catalog waits in pending-product with
-- its dish name and recipe channel. It carries no Pick intent, and approval only
-- publishes the item; the member chooses it explicitly later.
insert into auth.users(id,aud,role,email,encrypted_password,created_at,updated_at)
values ('f9d00000-0000-4000-8000-000000000001','authenticated','authenticated','recipe-req@example.invalid','',now(),now());
insert into public.profiles(id,username,onboarding_completed)
values ('f9d00000-0000-4000-8000-000000000001','recipe_requester',true);

insert into public.items(id,category_id,name,normalized_name,status,created_by,requested_category_label,external_source,external_id,official_url,external_refreshed_at)
select 'f9d30000-0000-4000-8000-000000000001',c.id,'쪽파김치 담그는 법','쪽파김치담그는법','pending',
  'f9d00000-0000-4000-8000-000000000001','파김치','youtube_video','PPPPPPPPPPP','https://www.youtube.com/watch?v=PPPPPPPPPPP',now()
from public.categories c where c.slug='pending-product';
insert into public.item_channels(item_id,channel,target_url,is_primary)
values ('f9d30000-0000-4000-8000-000000000001','recipe','https://www.youtube.com/watch?v=PPPPPPPPPPP',true);
insert into public.categories(id,parent_id,name,slug,status,is_visible,is_pickable)
select 'f9d10000-0000-4000-8000-000000000001',g.id,'테스트 파김치','test-pa-kimchi','open',true,true
from public.categories g where g.slug='food-kimchi-sides';

update public.items
set category_id='f9d10000-0000-4000-8000-000000000001', status='active'
where id='f9d30000-0000-4000-8000-000000000001';

select ok(
  not exists(
    select 1 from public.picks
    where user_id='f9d00000-0000-4000-8000-000000000001'
      and item_id='f9d30000-0000-4000-8000-000000000001'
      and status in ('active','needs_review')
  ),
  'approving a recipe request does not auto-create the requester''s recipe Pick'
);
select ok(
  not exists(
    select 1 from public.pending_item_picks
    where item_id='f9d30000-0000-4000-8000-000000000001'
  ),
  'the current recipe request flow stores no legacy Pick intent'
);

select * from finish();
rollback;
