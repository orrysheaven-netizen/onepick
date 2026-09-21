begin;
with seed(parent_slug,name,slug,sort_order) as (
 values
 ('food-meat','삼겹살','pork-belly',1),('food-meat','스테이크','steak',2),('food-meat','닭가슴살','chicken-breast',3),('food-meat','족발','jokbal',4),('food-meat','육회','yukhoe',5),
 ('food-seafood','연어','salmon',1),('food-seafood','새우','shrimp',2),('food-seafood','장어','eel',3),('food-seafood','굴','oyster',4),('food-seafood','전복','abalone',5),('food-seafood','대게','snow-crab',6),
 ('food-seaweed-dried','미역','wakame',2),('food-seaweed-dried','멸치','dried-anchovy',3),('food-seaweed-dried','황태','dried-pollock',4),('food-seaweed-dried','쥐포','filefish-jerky',5),
 ('food-fruit','사과','apple-fruit',1),('food-fruit','딸기','strawberry',2),('food-fruit','복숭아','peach',3),('food-fruit','망고','mango',4),('food-fruit','수박','watermelon',5),('food-fruit','샤인머스캣','shine-muscat',6),
 ('food-vegetables','고구마','sweet-potato',1),('food-vegetables','감자','potato',2),('food-vegetables','토마토','tomato',3),('food-vegetables','옥수수','corn',4),('food-vegetables','버섯','mushroom',5),
 ('food-grains','쌀','rice',1),('food-grains','잡곡','mixed-grains',2),('food-grains','오트밀','oatmeal',3),('food-grains','떡','rice-cake',4),('food-grains','그래놀라','granola',5),
 ('food-kimchi-sides','젓갈','jeotgal',2),('food-kimchi-sides','장아찌','jangajji',3),
 ('food-convenience','밀키트','meal-kit',1),('food-convenience','만두','dumpling',2),('food-convenience','피자','pizza',3),('food-convenience','떡볶이','tteokbokki',4),('food-convenience','국/탕','soup-stew',5),('food-convenience','볶음밥','fried-rice',6),
 ('food-noodles','파스타','pasta',2),('food-noodles','냉면','naengmyeon',3),('food-noodles','우동','udon',4),('food-noodles','쌀국수','rice-noodles',5),
 ('food-snacks-desserts','초콜릿','chocolate',3),('food-snacks-desserts','젤리','jelly',4),('food-snacks-desserts','쿠키','cookie',5),('food-snacks-desserts','케이크','cake',6),('food-snacks-desserts','약과','yakgwa',7),
 ('food-bakery','식빵','bread-loaf',1),('food-bakery','베이글','bagel',2),('food-bakery','크루아상','croissant',3),('food-bakery','소금빵','salt-bread',4),('food-bakery','바게트','baguette',5),
 ('food-drinks-coffee','원두','coffee-beans',1),('food-drinks-coffee','캡슐커피','coffee-capsule',2),('food-drinks-coffee','드립백','drip-bag-coffee',3),('food-drinks-coffee','차','tea',4),('food-drinks-coffee','탄산수','sparkling-water',5),('food-drinks-coffee','생수','bottled-water',6),('food-drinks-coffee','단백질음료','protein-drink',7),('food-drinks-coffee','주스','juice',8),
 ('food-sauces-seasonings','간장','soy-sauce',1),('food-sauces-seasonings','고추장','gochujang',2),('food-sauces-seasonings','된장','doenjang',3),('food-sauces-seasonings','참기름','sesame-oil',4),('food-sauces-seasonings','올리브오일','olive-oil',5),('food-sauces-seasonings','핫소스','hot-sauce',6),('food-sauces-seasonings','소금','salt',7),('food-sauces-seasonings','파스타소스','pasta-sauce',8)
)
insert into public.categories(parent_id,name,slug,status,is_visible,is_pickable,sort_order)
select p.id,s.name,s.slug,'open',true,true,s.sort_order
from seed s join public.categories p on p.slug=s.parent_slug
on conflict(slug) do update set
 parent_id=excluded.parent_id,name=excluded.name,status='open',
 is_visible=true,is_pickable=true,sort_order=excluded.sort_order,updated_at=now();

insert into public.category_catalog_sources(category_id,mode,provider,edge_function_slug,external_source,is_enabled,notes)
select c.id,'internal',null,null,null,true,'Internal catalog; product-first registration with category classification.'
from public.categories c
where c.slug in (
'pork-belly','steak','chicken-breast','jokbal','yukhoe','salmon','shrimp','eel','oyster','abalone','snow-crab','wakame','dried-anchovy','dried-pollock','filefish-jerky',
'apple-fruit','strawberry','peach','mango','watermelon','shine-muscat','sweet-potato','potato','tomato','corn','mushroom','rice','mixed-grains','oatmeal','rice-cake','granola',
'jeotgal','jangajji','meal-kit','dumpling','pizza','tteokbokki','soup-stew','fried-rice','pasta','naengmyeon','udon','rice-noodles','chocolate','jelly','cookie','cake','yakgwa',
'bread-loaf','bagel','croissant','salt-bread','baguette','coffee-beans','coffee-capsule','drip-bag-coffee','tea','sparkling-water','bottled-water','protein-drink','juice',
'soy-sauce','gochujang','doenjang','sesame-oil','olive-oil','hot-sauce','salt','pasta-sauce')
on conflict(category_id) do update set mode='internal',provider=null,edge_function_slug=null,external_source=null,is_enabled=true,updated_at=now();
commit;
