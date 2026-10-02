begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
set local plpgsql.check_asserts = on;

select lives_ok($test$
do $flow$
declare
  alice uuid := gen_random_uuid();
  bob uuid := gen_random_uuid();
  admin uuid := gen_random_uuid();
  cat_member uuid := gen_random_uuid();
  cat_admin uuid := gen_random_uuid();
  cat_legacy uuid := gen_random_uuid();
  member_item uuid := gen_random_uuid();
  admin_item uuid := gen_random_uuid();
  free_item uuid := gen_random_uuid();
  legacy_item uuid := gen_random_uuid();
  member_pick uuid := gen_random_uuid();
  admin_pick uuid := gen_random_uuid();
  legacy_pick uuid := gen_random_uuid();
  raised boolean;
  v_item public.items%rowtype;
begin
  insert into auth.users(id,aud,role,created_at,updated_at)
  select id,'authenticated','authenticated',now(),now()
  from unnest(array[alice,bob,admin]) id;

  insert into public.profiles(id,username,onboarding_completed)
  select id,'lp_'||substr(replace(id::text,'-',''),1,10),true
  from unnest(array[alice,bob,admin]) id;

  insert into private.admin_users(user_id) values(admin);

  insert into public.categories(id,name,slug,status,is_visible,is_pickable,sort_order) values
    (cat_member,'Last photo member','last-photo-member-'||substr(replace(cat_member::text,'-',''),1,8),'open',true,true,1),
    (cat_admin,'Last photo admin','last-photo-admin-'||substr(replace(cat_admin::text,'-',''),1,8),'open',true,true,2),
    (cat_legacy,'Last photo legacy','last-photo-legacy-'||substr(replace(cat_legacy::text,'-',''),1,8),'open',true,true,3);

  insert into public.items(
    id,category_id,name,normalized_name,status,created_by,image_source_url
  ) values
    (member_item,cat_member,'Member pending','memberpending','pending',alice,'https://example.com/member-old.jpg'),
    (admin_item,cat_admin,'Admin current','admincurrent','active',null,'https://example.com/admin-old.jpg'),
    (free_item,cat_member,'No current Pick','nocurrentpick','active',null,'https://example.com/free-old.jpg'),
    (legacy_item,cat_legacy,'Legacy photo-less','legacyphotoless','active',null,'   ');

  insert into public.picks(
    id,user_id,category_id,item_id,channel,one_line_review,status,started_at
  ) values
    (member_pick,alice,cat_member,member_item,null,'검토 중','needs_review',now()),
    (admin_pick,bob,cat_admin,admin_item,null,'현재 원픽','active',now()),
    (legacy_pick,bob,cat_legacy,legacy_item,null,'레거시','active',now());

  insert into storage.objects(bucket_id,name,owner_id,metadata) values
    ('item-photos',alice::text||'/replacement.jpg',alice::text,'{"mimetype":"image/jpeg","size":1000}'::jsonb),
    ('item-photos',alice::text||'/replacement-thumb.jpg',alice::text,'{"mimetype":"image/jpeg","size":100}'::jsonb);

  -- Request owner cannot remove the last photo while the needs_review Pick exists.
  perform set_config('request.jwt.claim.sub',alice::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',alice,'role','authenticated','aal','aal1')::text,true);
  set local role authenticated;

  raised := false;
  begin
    perform public.revise_item_request(member_item, p_remove_photo => true);
  exception when others then
    raised := sqlerrm = 'PHOTO_REQUIRED';
  end;
  assert raised, 'needs_review Pick blocks requester last-photo removal';
  assert (select image_source_url='https://example.com/member-old.jpg' from public.items where id=member_item),
    'failed requester removal preserves the representative photo';

  v_item := public.revise_item_request(
    member_item,
    p_image_path => alice::text||'/replacement.jpg',
    p_thumbnail_path => alice::text||'/replacement-thumb.jpg'
  );
  assert v_item.image_path=alice::text||'/replacement.jpg'
     and v_item.thumbnail_path=alice::text||'/replacement-thumb.jpg',
    'requester can replace a photo while the needs_review Pick exists';
  reset role;

  -- AAL2 admin follows the same invariant for active Picks.
  perform set_config('request.jwt.claim.sub',admin::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',admin,'role','authenticated','aal','aal2')::text,true);
  set local role authenticated;

  raised := false;
  begin
    perform public.admin_replace_item_photo(admin_item,null,null,null);
  exception when others then
    raised := sqlerrm = 'PHOTO_REQUIRED';
  end;
  assert raised, 'active Pick blocks admin last-photo removal';
  assert (select image_source_url='https://example.com/admin-old.jpg' from public.items where id=admin_item),
    'failed admin removal preserves the representative photo';

  v_item := public.admin_replace_item_photo(
    admin_item,null,null,'https://example.com/admin-new.jpg'
  );
  assert v_item.image_source_url='https://example.com/admin-new.jpg',
    'admin can replace the representative photo while an active Pick exists';

  v_item := public.admin_replace_item_photo(free_item,null,null,null);
  assert v_item.image_path is null
     and v_item.thumbnail_path is null
     and v_item.image_source_url is null,
    'admin can remove a photo when the item has no current Pick';

  -- A merge that would move the waiting Pick to that now-photo-less item is
  -- rejected. admin_merge_pending_item already row-locks the target, so this
  -- also serializes with concurrent photo replacement/removal.
  raised := false;
  begin
    perform public.admin_merge_pending_item(member_item,free_item);
  exception when others then
    raised := sqlerrm = 'PHOTO_REQUIRED';
  end;
  assert raised, 'pending Pick cannot merge into a photo-less target';
  assert (select status='pending' from public.items where id=member_item),
    'failed merge leaves the source request pending';

  v_item := public.admin_replace_item_photo(legacy_item,null,null,null);
  assert v_item.image_path is null
     and v_item.thumbnail_path is null
     and v_item.image_source_url is null,
    'legacy photo-less current Pick can normalize blank photo metadata to NULL';
  reset role;

  assert (select status='needs_review' from public.picks where id=member_pick),
    'request revision/failed merge never changes the waiting Pick';
  assert (select status='active' from public.picks where id=admin_pick),
    'admin photo moderation never changes the active Pick';
  assert (select status='active' from public.picks where id=legacy_pick),
    'legacy photo metadata normalization never changes the active Pick';
end;
$flow$;
$test$, 'last-photo guard blocks only current-Pick removals and permits replacements/no-Pick removal');

select ok(
  (select prosecdef from pg_proc where oid='private.change_pick_impl(uuid,uuid,text,text,text,text)'::regprocedure),
  'change_pick implementation stays SECURITY DEFINER'
);
select ok(
  (select 'search_path=""'=any(proconfig)
   from pg_proc where oid='private.change_pick_impl(uuid,uuid,text,text,text,text)'::regprocedure),
  'change_pick implementation keeps empty search_path'
);
select ok(
  pg_get_functiondef('private.change_pick_impl(uuid,uuid,text,text,text,text)'::regprocedure)
    ~ E'from public\\.items[[:space:]]+where id=p_item_id[[:space:]]+for update',
  'change_pick locks the target item row before checking its photo'
);
select ok(
  exists (
    select 1
    from pg_trigger t
    join pg_class c on c.oid=t.tgrelid
    join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relname='items'
      and t.tgname='items_guard_current_pick_photo_removal'
      and not t.tgisinternal
  ),
  'items has the current-Pick last-photo removal trigger'
);
select ok(
  exists (
    select 1
    from pg_trigger t
    join pg_class c on c.oid=t.tgrelid
    join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relname='items'
      and t.tgname='items_guard_pending_pick_merge_target_photo'
      and not t.tgisinternal
  ),
  'items has the pending-merge target-photo trigger'
);
select ok(
  (select prosecdef from pg_proc where oid='private.guard_current_pick_item_photo_removal()'::regprocedure),
  'last-photo trigger function is SECURITY DEFINER'
);
select ok(
  (select 'search_path=""'=any(proconfig)
   from pg_proc where oid='private.guard_current_pick_item_photo_removal()'::regprocedure),
  'last-photo trigger function keeps empty search_path'
);
select ok(
  not has_function_privilege('anon','private.guard_current_pick_item_photo_removal()','execute'),
  'anon cannot execute the last-photo trigger function'
);
select ok(
  (select prosecdef from pg_proc where oid='private.guard_pending_pick_merge_target_photo()'::regprocedure),
  'merge-target trigger function is SECURITY DEFINER'
);
select ok(
  (select 'search_path=""'=any(proconfig)
   from pg_proc where oid='private.guard_pending_pick_merge_target_photo()'::regprocedure),
  'merge-target trigger function keeps empty search_path'
);
select ok(
  not has_function_privilege('anon','private.guard_pending_pick_merge_target_photo()','execute'),
  'anon cannot execute the merge-target trigger function'
);

select ok(
  (select prosecdef from pg_proc where oid='private.revise_item_request_impl(uuid,text,text,text,text,boolean)'::regprocedure),
  'request revision implementation stays SECURITY DEFINER'
);
select ok(
  (select 'search_path=""'=any(proconfig)
   from pg_proc where oid='private.revise_item_request_impl(uuid,text,text,text,text,boolean)'::regprocedure),
  'request revision implementation keeps empty search_path'
);
select ok(
  (select prosecdef from pg_proc where oid='public.admin_replace_item_photo(uuid,text,text,text)'::regprocedure),
  'admin photo replacement stays SECURITY DEFINER'
);
select ok(
  (select 'search_path=""'=any(proconfig)
   from pg_proc where oid='public.admin_replace_item_photo(uuid,text,text,text)'::regprocedure),
  'admin photo replacement keeps empty search_path'
);
select ok(
  has_function_privilege('authenticated','public.admin_replace_item_photo(uuid,text,text,text)','execute'),
  'authenticated keeps execute on admin_replace_item_photo'
);
select ok(
  not has_function_privilege('anon','public.admin_replace_item_photo(uuid,text,text,text)','execute'),
  'anon cannot execute admin_replace_item_photo'
);
select ok(
  has_function_privilege('authenticated','private.revise_item_request_impl(uuid,text,text,text,text,boolean)','execute'),
  'authenticated keeps execute on revise_item_request_impl'
);
select ok(
  not has_function_privilege('anon','private.revise_item_request_impl(uuid,text,text,text,text,boolean)','execute'),
  'anon cannot execute revise_item_request_impl'
);

select * from finish();
rollback;
