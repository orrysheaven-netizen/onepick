begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

insert into auth.users(id,aud,role,email,encrypted_password,created_at,updated_at)
values ('f9300000-0000-4000-8000-000000000001','authenticated','authenticated',
  'youtube-quota@example.invalid','',now(),now());

select ok(
  not has_function_privilege('anon','public.consume_youtube_catalog_search(uuid)','execute'),
  'anonymous callers cannot consume YouTube search quota directly'
);
select ok(
  not has_function_privilege('authenticated','public.consume_youtube_catalog_search(uuid)','execute'),
  'authenticated clients cannot bypass the Edge Function quota contract'
);
select ok(
  not has_table_privilege('authenticated','private.youtube_catalog_search_limits','select'),
  'clients cannot inspect YouTube quota counters'
);

set local role service_role;
select ok(
  (select bool_and(public.consume_youtube_catalog_search('f9300000-0000-4000-8000-000000000001'))
   from generate_series(1,30)),
  'first thirty provider searches in an hour are allowed'
);
select ok(
  not public.consume_youtube_catalog_search('f9300000-0000-4000-8000-000000000001'),
  'thirty-first provider search is denied'
);
reset role;

update private.youtube_catalog_search_limits
set window_start=clock_timestamp()-interval '2 hours'
where user_id='f9300000-0000-4000-8000-000000000001';

set local role service_role;
select ok(
  public.consume_youtube_catalog_search('f9300000-0000-4000-8000-000000000001'),
  'quota resets after one hour'
);
reset role;

select * from finish();
rollback;
