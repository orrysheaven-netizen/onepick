begin;

-- Restaurant-first MVP taxonomy. Existing category UUIDs/slugs remain stable.
-- Broad empty leaves are only paused when they are still unused at apply time.

insert into public.categories(parent_id,name,slug,status,is_visible,is_pickable,sort_order)
select food.id,'국/탕/찌개/밥','food-soups-rice','open',true,false,100
from public.categories food
where food.slug='food'
on conflict(slug) do update set
  parent_id=excluded.parent_id,
  name=excluded.name,
  status='open',
  is_visible=true,
  is_pickable=false,
  sort_order=excluded.sort_order,
  updated_at=now();

with seed(parent_slug,name,slug,sort_order) as (
  values
  -- 고기 / 내장
  ('food-meat','대창','daechang',10),
  ('food-meat','막창','makchang',11),
  ('food-meat','염통','yeomtong',12),
  ('food-meat','양/특양','special-yang',13),
  ('food-meat','곱창전골','gopchang-jeongol',14),
  ('food-meat','목살','pork-neck',15),
  ('food-meat','항정살','pork-jowl',16),
  ('food-meat','가브리살','pork-gabrisal',17),
  ('food-meat','돼지갈비','pork-ribs',18),
  ('food-meat','소갈비','beef-ribs',19),
  ('food-meat','갈비살','beef-short-rib-meat',20),
  ('food-meat','한우구이','hanwoo-grill',21),
  ('food-meat','보쌈','bossam',22),
  ('food-meat','제육볶음','spicy-pork',23),
  ('food-meat','닭갈비','dakgalbi',24),
  ('food-meat','닭발','chicken-feet',25),
  ('food-meat','오리고기','duck-meat',26),
  ('food-meat','양꼬치','lamb-skewers',27),

  -- 면
  ('food-noodles','평양냉면','pyeongyang-naengmyeon',20),
  ('food-noodles','함흥냉면','hamheung-naengmyeon',21),
  ('food-noodles','밀면','milmyeon',22),
  ('food-noodles','칼국수','kalguksu',23),
  ('food-noodles','수제비','sujebi',24),
  ('food-noodles','잔치국수','janchi-guksu',25),
  ('food-noodles','비빔국수','bibim-guksu',26),
  ('food-noodles','막국수','makguksu',27),
  ('food-noodles','소바','soba',28),
  ('food-noodles','라멘','japanese-ramen',29),
  ('food-noodles','짜장면','jjajangmyeon',30),
  ('food-noodles','짬뽕','jjamppong',31),
  ('food-noodles','탄탄면','tantanmen',32),
  ('food-noodles','마라탕','malatang',33),
  ('food-noodles','마라샹궈','mala-xiangguo',34),

  -- 국 / 탕 / 찌개 / 밥
  ('food-soups-rice','돼지국밥','pork-gukbap',1),
  ('food-soups-rice','순대국','sundae-guk',2),
  ('food-soups-rice','설렁탕','seolleongtang',3),
  ('food-soups-rice','곰탕','gomtang',4),
  ('food-soups-rice','갈비탕','galbitang',5),
  ('food-soups-rice','해장국','haejangguk',6),
  ('food-soups-rice','감자탕','gamjatang',7),
  ('food-soups-rice','추어탕','chueotang',8),
  ('food-soups-rice','육개장','yukgaejang',9),
  ('food-soups-rice','삼계탕','samgyetang',10),
  ('food-soups-rice','김치찌개','kimchi-jjigae',11),
  ('food-soups-rice','된장찌개','doenjang-jjigae',12),
  ('food-soups-rice','청국장','cheonggukjang',13),
  ('food-soups-rice','부대찌개','budae-jjigae',14),
  ('food-soups-rice','닭볶음탕','dakbokkeumtang',15),
  ('food-soups-rice','매운탕','maeuntang',16),
  ('food-soups-rice','비빔밥','bibimbap',17),
  ('food-soups-rice','김밥','gimbap',18),
  ('food-soups-rice','오므라이스','omurice',19),
  ('food-soups-rice','카레','curry',20),
  ('food-soups-rice','덮밥','rice-bowl',21),

  -- 해산물
  ('food-seafood','초밥','sushi',10),
  ('food-seafood','회','sashimi',11),
  ('food-seafood','물회','mulhoe',12),
  ('food-seafood','조개구이','grilled-shellfish',13),
  ('food-seafood','조개찜','steamed-shellfish',14),
  ('food-seafood','아귀찜','agujjim',15),
  ('food-seafood','낙지','nakji',16),
  ('food-seafood','쭈꾸미','jjukkumi',17),
  ('food-seafood','꽃게','blue-crab',18),
  ('food-seafood','양념게장','spicy-marinated-crab',19),
  ('food-seafood','생선구이','grilled-fish',20),

  -- 분식 / 간편식
  ('food-convenience','순대','sundae',20),
  ('food-convenience','튀김','fried-snacks',21),
  ('food-convenience','핫도그','hotdog',22),
  ('food-convenience','토스트','toast',23),
  ('food-convenience','햄버거','burger',24),
  ('food-convenience','치킨','fried-chicken',25),

  -- 빵 / 디저트
  ('food-bakery','도넛','donut',20),
  ('food-bakery','휘낭시에','financier',21),
  ('food-bakery','마들렌','madeleine',22),
  ('food-bakery','타르트','tart',23),
  ('food-snacks-desserts','푸딩','pudding',20),
  ('food-snacks-desserts','빙수','bingsu',21)
)
insert into public.categories(parent_id,name,slug,status,is_visible,is_pickable,sort_order)
select p.id,s.name,s.slug,'open',true,true,s.sort_order
from seed s
join public.categories p on p.slug=s.parent_slug
on conflict(slug) do update set
  parent_id=excluded.parent_id,
  name=excluded.name,
  status='open',
  is_visible=true,
  is_pickable=true,
  sort_order=excluded.sort_order,
  updated_at=now();

-- Replace only still-empty broad leaves. If real usage appeared before apply,
-- leave them untouched rather than rewriting live user data.
update public.categories c
set status='paused', is_visible=false, is_pickable=false, updated_at=now()
where c.slug in ('naengmyeon','soup-stew')
  and not exists (select 1 from public.items i where i.category_id=c.id)
  and not exists (select 1 from public.picks p where p.category_id=c.id);

insert into public.category_catalog_sources(
  category_id,mode,provider,edge_function_slug,external_source,is_enabled,notes
)
select c.id,'internal',null,null,null,true,
       'Restaurant-first internal taxonomy; online/offline can share the same leaf category.'
from public.categories c
where c.slug in ('daechang','makchang','yeomtong','special-yang','gopchang-jeongol','pork-neck','pork-jowl','pork-gabrisal','pork-ribs','beef-ribs','beef-short-rib-meat','hanwoo-grill','bossam','spicy-pork','dakgalbi','chicken-feet','duck-meat','lamb-skewers','pyeongyang-naengmyeon','hamheung-naengmyeon','milmyeon','kalguksu','sujebi','janchi-guksu','bibim-guksu','makguksu','soba','japanese-ramen','jjajangmyeon','jjamppong','tantanmen','malatang','mala-xiangguo','pork-gukbap','sundae-guk','seolleongtang','gomtang','galbitang','haejangguk','gamjatang','chueotang','yukgaejang','samgyetang','kimchi-jjigae','doenjang-jjigae','cheonggukjang','budae-jjigae','dakbokkeumtang','maeuntang','bibimbap','gimbap','omurice','curry','rice-bowl','sushi','sashimi','mulhoe','grilled-shellfish','steamed-shellfish','agujjim','nakji','jjukkumi','blue-crab','spicy-marinated-crab','grilled-fish','sundae','fried-snacks','hotdog','toast','burger','fried-chicken','donut','financier','madeleine','tart','pudding','bingsu')
on conflict(category_id) do update set
  mode='internal',
  provider=null,
  edge_function_slug=null,
  external_source=null,
  is_enabled=true,
  notes=excluded.notes,
  updated_at=now();

with seed(category_slug,term,kind) as (
  values
  ('special-yang','특양','alias'),
  ('special-yang','양깃머리','tag'),
  ('beef-short-rib-meat','갈빗살','alias'),
  ('spicy-pork','제육','alias'),
  ('duck-meat','오리','alias'),

  ('pyeongyang-naengmyeon','평냉','alias'),
  ('hamheung-naengmyeon','함냉','alias'),
  ('soba','메밀소바','tag'),
  ('soba','메밀국수','alias'),
  ('japanese-ramen','일본라멘','alias'),
  ('japanese-ramen','일본식라면','tag'),
  ('jjajangmyeon','자장면','alias'),
  ('jjamppong','짬봉','alias'),
  ('tantanmen','탄탄멘','alias'),
  ('mala-xiangguo','마라향궈','alias'),

  ('pork-gukbap','국밥','tag'),
  ('sundae-guk','순댓국','alias'),
  ('sundae-guk','순대국밥','alias'),
  ('seolleongtang','설농탕','alias'),
  ('haejangguk','뼈해장국','tag'),
  ('gamjatang','뼈다귀감자탕','tag'),
  ('dakbokkeumtang','닭도리탕','alias'),
  ('bibimbap','돌솥비빔밥','tag'),
  ('curry','카레라이스','tag'),
  ('rice-bowl','돈부리','tag'),

  ('sushi','스시','alias'),
  ('sashimi','사시미','alias'),
  ('agujjim','아구찜','alias'),
  ('nakji','낙지볶음','tag'),
  ('jjukkumi','주꾸미','alias'),
  ('blue-crab','꽃게탕','tag'),

  ('fried-snacks','튀김류','tag'),
  ('hotdog','코리안핫도그','tag'),
  ('toast','길거리토스트','tag'),
  ('burger','버거','alias'),
  ('fried-chicken','통닭','alias'),

  ('donut','도너츠','alias'),
  ('donut','도나스','alias'),
  ('financier','피낭시에','alias'),
  ('bingsu','팥빙수','tag')
)
insert into public.category_search_terms(category_id,term,kind)
select c.id,s.term,s.kind
from seed s
join public.categories c on c.slug=s.category_slug
on conflict(category_id,lower(term)) do update set kind=excluded.kind;

commit;
