begin;
create extension if not exists pgtap with schema extensions;
select plan(1);
set local plpgsql.check_asserts = on;
select lives_ok($test$
do $flow$
#variable_conflict use_variable
declare
  good_cat uuid := gen_random_uuid(); closed_cat uuid := gen_random_uuid();
  by_alias uuid := gen_random_uuid(); by_name uuid := gen_random_uuid(); hidden_alias uuid := gen_random_uuid();
  -- The alias token shares no trigram with either item name, so these rows are
  -- reachable only through item_aliases. search_items collects its candidates
  -- from the name index and the alias index separately; if the alias half ever
  -- stops being a superset of the alias tests that rank the row, these vanish.
  token text := 'aliasonly'||replace(gen_random_uuid()::text,'-','');
  stem text := 'zzquokka'||replace(gen_random_uuid()::text,'-','');
  n integer; found_id uuid;
begin
  insert into public.categories(id,name,slug,status,is_visible,is_pickable) values
    (good_cat,'Candidate visible','cand-'||good_cat,'open',true,true),
    (closed_cat,'Candidate closed','cand-'||closed_cat,'open',true,true);
  insert into public.items(id,category_id,name,normalized_name,status) values
    (by_alias,good_cat,stem||'알파',stem||'알파','active'),
    (by_name,good_cat,token||'이름',token||'이름','active'),
    (hidden_alias,closed_cat,stem||'베타',stem||'베타','active');
  insert into public.item_aliases(item_id,alias,normalized_alias) values
    (by_alias,token,token),
    (hidden_alias,token,token);
  update public.categories set status='closed' where id=closed_cat;

  perform set_config('request.jwt.claim.sub','',true);
  set local role anon;

  select count(*) into n from public.search_items(token,null,50) where id=by_alias;
  assert n=1, 'An exact alias match is found even when the item name shares nothing with the query';
  select count(*) into n from public.search_items(substr(token,1,14),null,50) where id=by_alias;
  assert n=1, 'An alias prefix match is found';
  select count(*) into n from public.search_items(substr(token,6,16),null,50) where id=by_alias;
  assert n=1, 'An alias substring match is found';
  -- Two extra characters: the alias no longer contains the query, so this row
  -- can only survive through the trigram similarity branch.
  select count(*) into n from public.search_items(token||'xy',null,50) where id=by_alias;
  assert n=1, 'An alias reachable only by similarity is still a candidate';

  select id into found_id from public.search_items(token,null,1);
  assert found_id=by_alias, 'An exact alias still outranks a name that merely contains the query';
  select count(*) into n from public.search_items(token,null,50) where id=by_name;
  assert n=1, 'A name match is unaffected by the alias candidates';

  select count(*) into n from public.search_items(token,null,50) where id=hidden_alias;
  assert n=0, 'Category visibility is applied to alias-only candidates too';
  select count(*) into n from public.search_items(token,array[good_cat],50) where id=by_alias;
  assert n=1, 'A category-scoped search keeps its alias-only candidates';
  select count(*) into n from public.search_items(token,array[closed_cat],50);
  assert n=0, 'A caller-supplied closed category cannot reveal alias-only candidates';

  update public.items set status='pending' where id=by_alias;
  select count(*) into n from public.search_items(token,null,50) where id=by_alias;
  assert n=0, 'Item eligibility is applied to alias-only candidates too';
  update public.items set status='discontinued' where id=by_alias;
  select count(*) into n from public.search_items(token,null,50) where id=by_alias;
  assert n=1, 'Discontinued items stay searchable through their aliases';
  reset role;
end;
$flow$;
$test$, 'Item search reaches rows through their aliases and applies every visibility rule to them');
select * from finish();
rollback;
