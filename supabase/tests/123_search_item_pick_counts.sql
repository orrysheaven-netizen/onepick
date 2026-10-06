begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

select has_function('public', 'search_item_pick_counts', array['uuid[]'],
  'search_item_pick_counts(uuid[]) exists');
select function_lang_is('public', 'search_item_pick_counts', array['uuid[]'], 'sql');
select volatility_is('public', 'search_item_pick_counts', array['uuid[]'], 'stable');
select isnt_definer('public', 'search_item_pick_counts', array['uuid[]'],
  'search aggregate is security invoker');

select ok(has_function_privilege('anon', 'public.search_item_pick_counts(uuid[])', 'EXECUTE'),
  'anon can execute public search aggregate');
select ok(has_function_privilege('authenticated', 'public.search_item_pick_counts(uuid[])', 'EXECUTE'),
  'authenticated can execute public search aggregate');
select ok(has_function_privilege('service_role', 'public.search_item_pick_counts(uuid[])', 'EXECUTE'),
  'service role can execute public search aggregate');

select is(
  (select count(*) from public.search_item_pick_counts(array[]::uuid[])),
  0::bigint,
  'empty item list returns no rows'
);


create temp table sipc_ids(key text primary key, id uuid not null) on commit drop;
insert into sipc_ids values
  ('u1','f1230000-0000-4000-8000-000000000001'),
  ('u2','f1230000-0000-4000-8000-000000000002'),
  ('u3','f1230000-0000-4000-8000-000000000003'),
  ('u4','f1230000-0000-4000-8000-000000000004'),
  ('item','f1232000-0000-4000-8000-000000000001'),
  ('hidden','f1232000-0000-4000-8000-000000000002');

insert into auth.users(id,aud,role,email,encrypted_password,created_at,updated_at)
select id,'authenticated','authenticated',key||'@sipc.invalid','',now(),now()
from sipc_ids where key like 'u%';
insert into public.profiles(id,username,onboarding_completed)
select id,'sipc_'||key,true from sipc_ids where key like 'u%';

insert into public.items(id,category_id,name,normalized_name,status)
select i.id, c.id, v.name, v.name, v.status
from (values ('item','SIPC visible','active'),('hidden','SIPC hidden','hidden')) v(ikey,name,status)
join sipc_ids i on i.key=v.ikey
cross join lateral (
  select c.id
  from public.categories c
  left join public.categories parent on parent.id = c.parent_id
  left join public.categories gp on gp.id = parent.parent_id
  where c.is_pickable and c.status='open'
    and 'food' in (c.slug, parent.slug, gp.slug)
  limit 1
) c;

insert into public.picks(user_id,category_id,item_id,channel,one_line_review,status)
select u.id, i.category_id, i.id, 'offline', 'sipc', v.status
from (values
  ('u1','item','active'),
  ('u2','item','active'),
  ('u3','item','active'),
  ('u4','hidden','active')
) v(ukey,ikey,status)
join sipc_ids u on u.key=v.ukey
join sipc_ids x on x.key=v.ikey
join public.items i on i.id=x.id;

insert into private.user_moderation(user_id, reason)
select id, 'SIPC suspended fixture' from sipc_ids where key='u3';

set local role anon;

select is(
  (select pick_count from public.search_item_pick_counts(
    array['f1232000-0000-4000-8000-000000000001'::uuid]
  )),
  2::bigint,
  'anon aggregate counts active visible-item users and excludes suspended users'
);

select ok(
  not exists (
    select 1 from public.search_item_pick_counts(
      array['f1232000-0000-4000-8000-000000000002'::uuid]
    )
  ),
  'hidden item Picks are excluded'
);

reset role;

select * from finish();
rollback;
