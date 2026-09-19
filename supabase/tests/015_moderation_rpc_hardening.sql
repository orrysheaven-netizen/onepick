begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(11);

select ok(
  to_regprocedure('public.user_is_suspended(uuid)') is null,
  'Suspension helper is not exposed as a public RPC'
);
select ok(
  to_regprocedure('private.user_is_suspended(uuid)') is not null,
  'Suspension helper remains available to RLS through the private schema'
);
select is(
  (select count(*)::int
   from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public'
     and p.proname in ('admin_users','admin_user_moderation','admin_set_user_suspension')
     and p.prosecdef),
  0,
  'Public admin RPC wrappers are SECURITY INVOKER'
);
select ok(
  not has_function_privilege('anon','public.admin_users(text)','EXECUTE'),
  'Anonymous callers cannot execute admin_users'
);
select ok(
  not has_function_privilege('anon','public.admin_user_moderation(uuid)','EXECUTE'),
  'Anonymous callers cannot execute admin_user_moderation'
);
select ok(
  not has_function_privilege('anon','public.admin_set_user_suspension(uuid,boolean,text)','EXECUTE'),
  'Anonymous callers cannot execute admin_set_user_suspension'
);
select ok(
  has_function_privilege('authenticated','public.admin_users(text)','EXECUTE')
  and has_function_privilege('authenticated','public.admin_user_moderation(uuid)','EXECUTE')
  and has_function_privilege('authenticated','public.admin_set_user_suspension(uuid,boolean,text)','EXECUTE'),
  'Signed-in admins retain access to the public admin RPC contract'
);

insert into auth.users(id,aud,role,created_at,updated_at)
values('d1515151-1515-4515-8515-151515151515','authenticated','authenticated',now(),now());
insert into public.profiles(id,username,onboarding_completed)
values('d1515151-1515-4515-8515-151515151515','suspended_fixture',true);
insert into public.categories(id,name,slug,status,is_visible,is_pickable,sort_order)
values('d2525252-2525-4525-8525-252525252525','Suspension fixture','suspension-fixture','open',true,true,9999);
insert into public.items(id,category_id,name,normalized_name,status)
values('d3535353-3535-4535-8535-353535353535','d2525252-2525-4525-8525-252525252525','Suspended item','suspendeditem','active');
insert into public.picks(id,user_id,category_id,item_id,one_line_review,status,started_at)
values('d4545454-4545-4545-8545-454545454545','d1515151-1515-4515-8515-151515151515',
       'd2525252-2525-4525-8525-252525252525','d3535353-3535-4535-8535-353535353535',
       'Suspended fixture','active',now()+interval '1 day');
insert into private.user_moderation(user_id,reason)
values('d1515151-1515-4515-8515-151515151515','test suspension');
update public.home_settings set minimum_pick_count=1 where id;

set local role anon;
select is(
  (select count(*)::int from public.profiles where id='d1515151-1515-4515-8515-151515151515'),
  0,
  'Suspended profiles remain hidden from anonymous reads after moving the helper private'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','d1515151-1515-4515-8515-151515151515',true);

select ok(
  not exists(
    select 1
    from public.home_showcase_page(null,null) h,
         lateral jsonb_array_elements(h.items) j
    where (j->>'item_id')::uuid='d3535353-3535-4535-8535-353535353535'
  ),
  'Home aggregate excludes a suspended viewer own Pick'
);
select ok(
  not exists(
    select 1 from public.category_top_items('d2525252-2525-4525-8525-252525252525')
    where item_id='d3535353-3535-4535-8535-353535353535'
  ),
  'Category ranking excludes suspended users'
);
select throws_ok(
  $$select * from public.admin_users('')$$,
  '42501',
  null,
  'Ordinary authenticated users still fail the private MFA admin check'
);

select * from finish();
rollback;
