begin;
select plan(9);

-- Reuse the first open pickable menu leaf and two authenticated fixture users.
select lives_ok($$
  alter table public.picks disable trigger picks_limit_changes
$$,'disable rate limit trigger for deterministic channel test');

do $$
declare
  v_user uuid;
  v_cat uuid;
  v_offline uuid;
  v_online uuid;
  v_recipe uuid;
begin
  select id into v_user from public.profiles order by created_at limit 1;
  select c.id into v_cat
  from public.categories c
  where public.category_is_open_leaf(c.id)
    and c.slug <> 'recipe'
  order by c.created_at
  limit 1;
  if v_user is null or v_cat is null then
    raise exception 'fixture missing';
  end if;

  insert into public.items(category_id,name,normalized_name,status,external_source,external_id)
  values
    (v_cat,'channel-test-offline','channeltestoffline','active','test_channel','offline-'||v_cat),
    (v_cat,'channel-test-online','channeltestonline','active','test_channel','online-'||v_cat),
    (v_cat,'channel-test-recipe','channeltestrecipe','active','test_channel','recipe-'||v_cat);

  select id into v_offline from public.items where external_source='test_channel' and external_id='offline-'||v_cat;
  select id into v_online from public.items where external_source='test_channel' and external_id='online-'||v_cat;
  select id into v_recipe from public.items where external_source='test_channel' and external_id='recipe-'||v_cat;

  insert into public.item_channels(item_id,channel,is_primary) values
    (v_offline,'offline',true),(v_online,'online',true),(v_recipe,'recipe',true);

  perform set_config('request.jwt.claim.sub',v_user::text,true);
  perform private.change_pick_impl(v_cat,v_offline,'매장','', '', 'offline');
  perform private.change_pick_impl(v_cat,v_online,'온라인','', '', 'online');
  perform private.change_pick_impl(v_cat,v_recipe,'레시피','', '', 'recipe');
end $$;

select is(
  (select count(*)::int from public.picks p
   join public.items i on i.id=p.item_id
   where i.external_source='test_channel' and p.status='active'),
  3,'same menu can hold offline/online/recipe current picks');

select results_eq(
  $$select channel from public.picks p join public.items i on i.id=p.item_id
    where i.external_source='test_channel' and p.status='active' order by channel$$,
  $$values ('offline'::text),('online'::text),('recipe'::text)$$,
  'three channels are distinct');

do $$
declare
  v_user uuid;
  v_cat uuid;
  v_old uuid;
  v_new uuid;
begin
  select id into v_user from public.profiles order by created_at limit 1;
  select category_id into v_cat from public.items where external_source='test_channel' limit 1;
  select id into v_old from public.items where external_source='test_channel' and external_id='recipe-'||v_cat;

  insert into public.items(category_id,name,normalized_name,status,external_source,external_id)
  values(v_cat,'channel-test-recipe-2','channeltestrecipe2','active','test_channel','recipe2-'||v_cat)
  returning id into v_new;
  insert into public.item_channels(item_id,channel,is_primary) values(v_new,'recipe',true);

  perform set_config('request.jwt.claim.sub',v_user::text,true);
  perform private.change_pick_impl(v_cat,v_new,'새 레시피','', '', 'recipe');
end $$;

select is(
  (select count(*)::int from public.picks p join public.items i on i.id=p.item_id
   where i.external_source='test_channel' and p.status='active'),
  3,'re-registering recipe keeps three active channels');

select is(
  (select count(*)::int from public.picks p join public.items i on i.id=p.item_id
   where i.external_source='test_channel' and p.channel='recipe' and p.status='replaced'),
  1,'same-channel recipe pick is replaced');

select is(
  (select count(*)::int from public.picks p join public.items i on i.id=p.item_id
   where i.external_source='test_channel' and p.channel in ('offline','online') and p.status='active'),
  2,'recipe replacement leaves offline and online untouched');

select throws_ok(
  $$select private.change_pick_impl(
      (select category_id from public.items where external_source='test_channel' limit 1),
      (select id from public.items where external_source='test_channel' and external_id like 'offline-%' limit 1),
      'bad','', '', 'recipe')$$,
  'P0001','ITEM_CHANNEL_MISMATCH','item must support requested channel');

select ok(
  not exists(select 1 from public.picks where channel not in ('offline','online','recipe') and channel is not null),
  'backfill only uses supported channel values');

select lives_ok($$
  alter table public.picks enable trigger picks_limit_changes
$$,'restore rate limit trigger');

select * from finish();
rollback;
