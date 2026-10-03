begin;
create extension if not exists pgtap with schema extensions;
select plan(1);
set local plpgsql.check_asserts = on;
select lives_ok($test$
do $flow$
#variable_conflict use_variable
declare
  alice uuid := gen_random_uuid(); bob uuid := gen_random_uuid(); carol uuid := gen_random_uuid();
  admin uuid := gen_random_uuid(); suspended uuid := gen_random_uuid();
  grp uuid := gen_random_uuid(); menu uuid := gen_random_uuid(); m2 uuid := gen_random_uuid();
  m3 uuid := gen_random_uuid(); m4 uuid := gen_random_uuid(); m5 uuid := gen_random_uuid();
  bare uuid := gen_random_uuid(); bare2 uuid := gen_random_uuid(); photo_item uuid := gen_random_uuid();
  mine_pending uuid := gen_random_uuid(); hidden_item uuid := gen_random_uuid(); lost_item uuid := gen_random_uuid();
  swap_item uuid := gen_random_uuid(); id_a uuid; id_b uuid;
  res jsonb; v_item public.items%rowtype; v_pick public.picks%rowtype;
  v_cand public.item_photo_candidates%rowtype; c_alice uuid; c_bob uuid; c_carol uuid; c_new uuid;
  n integer; raised boolean; v_text text;
begin
  insert into auth.users(id,aud,role,created_at,updated_at)
    select id,'authenticated','authenticated',now(),now() from unnest(array[alice,bob,carol,admin,suspended]) id;
  insert into public.profiles(id,username,onboarding_completed)
    select id,'l4_'||substr(replace(id::text,'-',''),1,12),true from unnest(array[alice,bob,carol,admin,suspended]) id;
  insert into private.admin_users(user_id) values(admin);
  insert into private.user_moderation(user_id,reason,suspended_by) values(suspended,'L4 fixture',admin);

  insert into public.categories(id,parent_id,name,slug,status,is_visible,is_pickable)
    select grp,c.id,'L4 그룹','l4-group-'||substr(replace(grp::text,'-',''),1,8),'open',true,false
    from public.categories c where c.slug='food';
  insert into public.categories(id,parent_id,name,slug,status,is_visible,is_pickable)
    select m,grp,'L4 메뉴 '||i,'l4-menu-'||substr(replace(m::text,'-',''),1,8),'open',true,true
    from unnest(array[menu,m2,m3,m4,m5]) with ordinality t(m,i);

  insert into public.items(id,category_id,name,normalized_name,status,created_by,image_source_url) values
    (bare,menu,'L4 사진없음','l4사진없음','active',null,null),
    (bare2,m4,'L4 사진없음 둘','l4사진없음둘','active',null,null),
    (photo_item,m2,'L4 사진있음','l4사진있음','active',null,'https://img.example.com/l4.jpg'),
    (mine_pending,m3,'L4 내 요청','l4내요청','pending',alice,null),
    (hidden_item,m5,'L4 숨김예정','l4숨김예정','active',null,null),
    (lost_item,m5,'L4 파일분실','l4파일분실','active',null,null),
    (swap_item,m5,'L4 사진교체','l4사진교체','active',null,null);

  insert into storage.objects(bucket_id,name,owner_id,metadata,created_at)
  select 'item-photos', u.id::text||'/'||f.name, u.id::text,
         jsonb_build_object('mimetype','image/jpeg','size',f.size), now()-interval '2 days'
  from unnest(array[alice,bob,carol,suspended]) u(id)
  cross join (values ('a.jpg',1024),('a-t.jpg',100),('b.jpg',1024),('b-t.jpg',100),
                     ('c.jpg',1024),('c-t.jpg',100),('d.jpg',1024),('d-t.jpg',100),
                     ('e.jpg',1024),('e-t.jpg',100),
                     ('f.jpg',1024),('f-t.jpg',100)) f(name,size);

  assert not has_table_privilege('anon','public.item_photo_candidates','SELECT'), 'Guests cannot read candidates';
  assert not has_table_privilege('authenticated','public.item_photo_candidates','INSERT')
     and not has_table_privilege('authenticated','public.item_photo_candidates','UPDATE')
     and not has_table_privilege('authenticated','public.item_photo_candidates','DELETE'), 'No direct candidate writes';
  assert not has_function_privilege('anon','public.admin_review_item_photo_candidate(uuid,boolean)','execute')
     and not has_function_privilege('anon','public.admin_item_photo_candidates(integer)','execute'), 'Guests cannot review';

  -- ------------------------------------------------ alice: first photo on a bare product
  perform set_config('request.jwt.claim.sub',alice::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',alice,'role','authenticated','aal','aal1')::text,true);
  set local role authenticated;

  raised := false;
  begin
    perform public.register_item_pick(menu,'offline','사진 없이',bare);
  exception when others then raised := sqlerrm = 'PHOTO_REQUIRED'; end;
  assert raised, 'A bare product still needs a photo';

  res := public.register_item_pick(menu,'offline','사진 검수 대기',bare,
    p_image_path => alice::text||'/a.jpg', p_thumbnail_path => alice::text||'/a-t.jpg');
  assert (res->>'published')::boolean is false, 'A Pick on a candidate photo is not published';
  select * into v_pick from public.picks where id=(res->>'pick_id')::uuid;
  assert v_pick.status='needs_review', 'The Pick waits for the photo review';
  select * into v_item from public.items where id=bare;
  assert v_item.image_path is null and v_item.thumbnail_path is null, 'The product stays photo-less for everyone';
  select * into v_cand from public.item_photo_candidates where item_id=bare;
  assert v_cand.user_id=alice and v_cand.status='pending' and v_cand.image_path=alice::text||'/a.jpg', 'Alice sees her pending candidate';
  c_alice := v_cand.id;
  assert not private.is_unused_item_photo(alice::text||'/a.jpg') and not private.is_unused_item_photo(alice::text||'/a-t.jpg'),
    'Pending candidate files are protected from owner cleanup';

  -- Editing the same Pick keeps it waiting (no photo needed again, no publishing).
  res := public.register_item_pick(menu,'offline','이유 수정',bare,p_expected_previous_pick_id => v_pick.id);
  select * into v_pick from public.picks where id=v_pick.id;
  assert v_pick.status='needs_review' and v_pick.one_line_review='이유 수정', 'Same-Pick edit keeps needs_review';
  perform public.change_pick(menu,bare,'change_pick 수정',null,null,'offline');
  select * into v_pick from public.picks where id=v_pick.id;
  assert v_pick.status='needs_review' and v_pick.one_line_review='change_pick 수정', 'change_pick edit cannot publish a waiting Pick';

  -- A product that already has a photo works as before.
  res := public.register_item_pick(m2,'offline','사진 있는 제품',photo_item);
  assert (res->>'published')::boolean, 'A product with an approved photo publishes at once';

  -- My own pending request keeps its photo on the request itself.
  res := public.register_item_pick(m3,'offline','내 요청',mine_pending,
    p_image_path => alice::text||'/b.jpg', p_thumbnail_path => alice::text||'/b-t.jpg');
  select * into v_item from public.items where id=mine_pending;
  assert v_item.image_path=alice::text||'/b.jpg', 'A pending request is reviewed as a whole, photo included';
  select count(*) into n from public.item_photo_candidates where item_id=mine_pending;
  assert n=0, 'No candidate for my own pending request';
  reset role;

  -- ------------------------------------------------ bob and carol
  perform set_config('request.jwt.claim.sub',bob::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',bob,'role','authenticated','aal','aal1')::text,true);
  set local role authenticated;
  select count(*) into n from public.item_photo_candidates;
  assert n=0, 'Another member cannot read Alice''s candidate';
  select count(*) into n from public.picks where item_id=bare;
  assert n=0, 'Another member cannot see Alice''s waiting Pick';
  select count(*) into n from public.item_review_page(bare,null,null,null,20);
  assert n=0, 'The waiting Pick is not in the product reviews';

  raised := false;
  begin
    perform public.change_pick(menu,bare,'후보 없이',null,null,'offline');
  exception when others then raised := sqlerrm = 'PHOTO_REQUIRED'; end;
  assert raised, 'change_pick without an own candidate still needs a photo';
  perform public.attach_item_photo(bare,bob::text||'/a.jpg',bob::text||'/a-t.jpg');
  v_pick := public.change_pick(menu,bare,'밥 후보',null,null,'offline');
  assert v_pick.status='needs_review', 'change_pick on my candidate saves a waiting Pick';
  select id into c_bob from public.item_photo_candidates where item_id=bare;
  -- A second photo supersedes the member's own pending candidate (new id).
  perform public.attach_item_photo(bare,bob::text||'/b.jpg',bob::text||'/b-t.jpg');
  select count(*) into n from public.item_photo_candidates where item_id=bare and status='pending';
  assert n=1, 'One pending candidate per member and product';
  assert private.is_unused_item_photo(bob::text||'/a.jpg'), 'The replaced candidate photo can be cleaned up';
  reset role;

  perform set_config('request.jwt.claim.sub',carol::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',carol,'role','authenticated','aal','aal1')::text,true);
  set local role authenticated;
  perform public.register_pick(menu,bare,'L4 사진없음','캐럴 후보',carol::text||'/a.jpg',carol::text||'/a-t.jpg',null,'offline');
  select id into c_carol from public.item_photo_candidates where item_id=bare;
  reset role;

  -- Suspended members cannot add a photo candidate.
  perform set_config('request.jwt.claim.sub',suspended::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',suspended,'role','authenticated','aal','aal1')::text,true);
  set local role authenticated;
  raised := false;
  begin
    perform public.attach_item_photo(bare2,suspended::text||'/a.jpg',suspended::text||'/a-t.jpg');
  exception when others then raised := sqlerrm = 'ACCOUNT_SUSPENDED'; end;
  assert raised, 'Suspended members cannot submit a photo';
  reset role;

  -- ------------------------------------------------ cleanup
  select count(*) into n from public.stale_item_photo_paths(100) s
  where s.path in (alice::text||'/a.jpg',alice::text||'/a-t.jpg',bob::text||'/b.jpg',carol::text||'/a.jpg');
  assert n=0, 'Stale cleanup skips pending candidate files';
  select count(*) into n from public.stale_item_photo_paths(100) s where s.path=bob::text||'/a.jpg';
  assert n=1, 'Stale cleanup still collects a replaced candidate photo';

  -- ------------------------------------------------ admin gate
  perform set_config('request.jwt.claim.sub',admin::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',admin,'role','authenticated','aal','aal1')::text,true);
  set local role authenticated;
  raised := false;
  begin
    perform public.admin_review_item_photo_candidate(c_alice,true);
  exception when others then raised := sqlerrm = 'ADMIN_REQUIRED'; end;
  assert raised, 'An admin without AAL2 cannot approve';
  raised := false;
  begin
    perform public.admin_item_photo_candidates(10);
  exception when others then raised := sqlerrm = 'ADMIN_REQUIRED'; end;
  assert raised, 'An admin without AAL2 cannot list candidates';
  reset role;

  perform set_config('request.jwt.claim.sub',bob::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',bob,'role','authenticated','aal','aal2')::text,true);
  set local role authenticated;
  raised := false;
  begin
    perform public.admin_review_item_photo_candidate(c_bob,true);
  exception when others then raised := sqlerrm = 'ADMIN_REQUIRED'; end;
  assert raised, 'A member cannot approve their own photo, even with AAL2';
  reset role;

  -- ------------------------------------------------ approval
  perform set_config('request.jwt.claim.sub',admin::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',admin,'role','authenticated','aal','aal2')::text,true);
  set local role authenticated;
  select count(*) into n from public.admin_item_photo_candidates(200) c where c.item_id=bare;
  assert n=3, 'The admin queue lists every pending candidate of the product';

  v_cand := public.admin_review_item_photo_candidate(c_alice,true);
  assert v_cand.status='approved' and v_cand.reviewed_by=admin, 'Approval is recorded';
  reset role;
  select * into v_item from public.items where id=bare;
  assert v_item.image_path=alice::text||'/a.jpg' and v_item.thumbnail_path=alice::text||'/a-t.jpg', 'The approved photo becomes the product photo';
  select count(*) into n from public.item_photo_credits where item_id=bare and user_id=alice;
  assert n=1, 'The uploader, not the admin, is credited';
  select count(*) into n from public.item_photo_candidates where item_id=bare and status='superseded';
  assert n=3, 'Other pending candidates of the product are superseded (Bob''s replaced one already was)';
  select count(*) into n from public.item_photo_candidates where item_id=bare and status='pending';
  assert n=0, 'No pending candidate is left for the product';
  select count(*) into n from public.picks where item_id=bare and status='needs_review';
  assert n=0, 'Every Pick that waited for this product photo is published';
  select count(*) into n from public.picks where item_id=bare and status='active' and user_id in (alice,bob,carol);
  assert n=3, 'Alice, Bob and Carol''s Picks are active';
  select count(*) into n from public.stale_item_photo_paths(100) s where s.path in (bob::text||'/b.jpg',carol::text||'/a.jpg');
  assert n=2, 'Superseded candidate photos become collectable';

  -- Idempotency and settled candidates.
  perform set_config('request.jwt.claims',jsonb_build_object('sub',admin,'role','authenticated','aal','aal2')::text,true);
  set local role authenticated;
  v_cand := public.admin_review_item_photo_candidate(c_alice,true);
  assert v_cand.status='approved', 'Repeating an approval returns the approved row';
  raised := false;
  begin
    perform public.admin_review_item_photo_candidate(c_alice,false);
  exception when others then raised := sqlerrm = 'PHOTO_CANDIDATE_NOT_PENDING'; end;
  assert raised, 'An approved photo cannot be rejected afterwards';
  raised := false;
  begin
    perform public.admin_review_item_photo_candidate(c_carol,true);
  exception when others then raised := sqlerrm = 'PHOTO_CANDIDATE_NOT_PENDING'; end;
  assert raised, 'A superseded photo cannot be approved';
  raised := false;
  begin
    perform public.admin_review_item_photo_candidate(gen_random_uuid(),true);
  exception when others then raised := sqlerrm = 'PHOTO_CANDIDATE_NOT_FOUND'; end;
  assert raised, 'Unknown candidates are refused';
  raised := false;
  begin
    perform public.admin_review_item_photo_candidate(c_alice,null);
  exception when others then raised := sqlerrm = 'PHOTO_REVIEW_DECISION_REQUIRED'; end;
  assert raised, 'A decision is required';
  reset role;

  -- ------------------------------------------------ rejection keeps the Pick
  perform set_config('request.jwt.claim.sub',alice::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',alice,'role','authenticated','aal','aal1')::text,true);
  set local role authenticated;
  res := public.register_item_pick(m4,'offline','거절될 사진',bare2,
    p_image_path => alice::text||'/c.jpg', p_thumbnail_path => alice::text||'/c-t.jpg');
  select id into c_new from public.item_photo_candidates where item_id=bare2 and status='pending';
  reset role;

  perform set_config('request.jwt.claim.sub',admin::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',admin,'role','authenticated','aal','aal2')::text,true);
  set local role authenticated;
  v_cand := public.admin_review_item_photo_candidate(c_new,false);
  assert v_cand.status='rejected', 'Rejection is recorded';
  v_cand := public.admin_review_item_photo_candidate(c_new,false);
  assert v_cand.status='rejected', 'Repeating a rejection returns the rejected row';
  raised := false;
  begin
    perform public.admin_review_item_photo_candidate(c_new,true);
  exception when others then raised := sqlerrm = 'PHOTO_CANDIDATE_NOT_PENDING'; end;
  assert raised, 'A rejected photo cannot be approved afterwards';
  reset role;

  select * into v_pick from public.picks where id=(res->>'pick_id')::uuid;
  assert v_pick.status='needs_review', 'Rejection keeps the Pick (still waiting for a photo)';
  select * into v_item from public.items where id=bare2;
  assert v_item.image_path is null, 'A rejected photo never reaches the product';
  select count(*) into n from public.stale_item_photo_paths(100) s where s.path=alice::text||'/c.jpg';
  assert n=1, 'A rejected photo becomes collectable';

  perform set_config('request.jwt.claim.sub',alice::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',alice,'role','authenticated','aal','aal1')::text,true);
  set local role authenticated;
  assert private.is_unused_item_photo(alice::text||'/c.jpg'), 'The owner can remove a rejected photo';
  perform public.attach_item_photo(bare2,alice::text||'/d.jpg',alice::text||'/d-t.jpg');
  select id into c_new from public.item_photo_candidates where item_id=bare2 and status='pending';
  assert c_new is not null, 'After a rejection the member can send another photo';
  reset role;

  perform set_config('request.jwt.claim.sub',admin::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',admin,'role','authenticated','aal','aal2')::text,true);
  set local role authenticated;
  perform public.admin_review_item_photo_candidate(c_new,true);
  reset role;
  select * into v_pick from public.picks where id=(res->>'pick_id')::uuid;
  assert v_pick.status='active', 'Approving the new photo publishes the kept Pick';

  -- ------------------------------------------------ replacement never approves an unseen photo
  -- 1. The admin looks at Alice's photo A under id-A.
  perform set_config('request.jwt.claim.sub',alice::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',alice,'role','authenticated','aal','aal1')::text,true);
  set local role authenticated;
  perform public.attach_item_photo(swap_item,alice::text||'/e.jpg',alice::text||'/e-t.jpg');
  reset role;
  perform set_config('request.jwt.claim.sub',admin::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',admin,'role','authenticated','aal','aal2')::text,true);
  set local role authenticated;
  select c.candidate_id into id_a from public.admin_item_photo_candidates(200) c
  where c.item_id=swap_item and c.image_path=alice::text||'/e.jpg';
  assert id_a is not null, 'The admin sees photo A as id-A';
  reset role;

  -- 2. Alice replaces it with photo B.
  perform set_config('request.jwt.claim.sub',alice::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',alice,'role','authenticated','aal','aal1')::text,true);
  set local role authenticated;
  perform public.attach_item_photo(swap_item,alice::text||'/f.jpg',alice::text||'/f-t.jpg');
  reset role;

  -- 3. id-A is superseded and still points at photo A.
  select * into v_cand from public.item_photo_candidates where id=id_a;
  assert v_cand.status='superseded' and v_cand.image_path=alice::text||'/e.jpg',
    'A replacement supersedes id-A instead of rewriting it';
  -- 5. Photo B is a new candidate with its own id.
  select id into id_b from public.item_photo_candidates
  where item_id=swap_item and user_id=alice and status='pending';
  assert id_b is not null and id_b<>id_a, 'Photo B gets a new id-B';
  select image_path into v_text from public.item_photo_candidates where id=id_b;
  assert v_text=alice::text||'/f.jpg', 'id-B holds photo B';

  perform set_config('request.jwt.claim.sub',admin::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',admin,'role','authenticated','aal','aal2')::text,true);
  set local role authenticated;
  -- 4. Approving id-A (what the admin saw) fails and publishes nothing.
  raised := false;
  begin
    perform public.admin_review_item_photo_candidate(id_a,true);
  exception when others then raised := sqlerrm = 'PHOTO_CANDIDATE_NOT_PENDING'; end;
  assert raised, 'Approving the replaced id-A fails as not pending';
  select count(*) into n from public.admin_item_photo_candidates(200) c where c.item_id=swap_item;
  assert n=1, 'The queue shows only id-B for the product';
  reset role;
  select image_path into v_text from public.items where id=swap_item;
  assert v_text is null, 'A failed approval of id-A publishes neither A nor B';

  -- 6. Only id-B can be approved, and it publishes photo B.
  perform set_config('request.jwt.claims',jsonb_build_object('sub',admin,'role','authenticated','aal','aal2')::text,true);
  set local role authenticated;
  v_cand := public.admin_review_item_photo_candidate(id_b,true);
  assert v_cand.status='approved', 'id-B is approved';
  reset role;
  select image_path into v_text from public.items where id=swap_item;
  assert v_text=alice::text||'/f.jpg', 'The product shows exactly the reviewed photo B';
  select count(*) into n from public.stale_item_photo_paths(100) s where s.path=alice::text||'/e.jpg';
  assert n=1, 'Replaced photo A becomes collectable';

  -- ------------------------------------------------ approval guards
  perform set_config('request.jwt.claim.sub',bob::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',bob,'role','authenticated','aal','aal1')::text,true);
  set local role authenticated;
  perform public.attach_item_photo(hidden_item,bob::text||'/c.jpg',bob::text||'/c-t.jpg');
  perform public.attach_item_photo(lost_item,bob::text||'/d.jpg',bob::text||'/d-t.jpg');
  reset role;
  update public.items set status='hidden' where id=hidden_item;
  -- The stored file no longer matches (Storage rows cannot be deleted from SQL).
  update storage.objects set metadata=jsonb_set(metadata,'{mimetype}','"image/png"')
  where bucket_id='item-photos' and name=bob::text||'/d.jpg';

  perform set_config('request.jwt.claim.sub',admin::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',admin,'role','authenticated','aal','aal2')::text,true);
  set local role authenticated;
  raised := false;
  begin
    perform public.admin_review_item_photo_candidate(
      (select c.candidate_id from public.admin_item_photo_candidates(200) c where c.item_id=hidden_item),true);
  exception when others then raised := sqlerrm = 'ITEM_NOT_ELIGIBLE'; end;
  assert raised, 'A photo for a hidden product is not approved';
  raised := false;
  begin
    perform public.admin_review_item_photo_candidate(
      (select c.candidate_id from public.admin_item_photo_candidates(200) c where c.item_id=lost_item),true);
  exception when others then raised := sqlerrm = 'PHOTO_INVALID'; end;
  assert raised, 'A photo whose stored file is no longer a valid JPEG is not approved';
  reset role;
  select count(*) into n from public.items where id in (hidden_item,lost_item) and image_path is not null;
  assert n=0, 'Refused approvals change nothing';

  -- An admin replacement settles waiting candidates and publishes waiting Picks.
  perform set_config('request.jwt.claim.sub',carol::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',carol,'role','authenticated','aal','aal1')::text,true);
  set local role authenticated;
  perform public.register_pick(m5,lost_item,'L4 파일분실','교체 대기',carol::text||'/b.jpg',carol::text||'/b-t.jpg',null,'offline');
  reset role;
  perform set_config('request.jwt.claim.sub',admin::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',admin,'role','authenticated','aal','aal2')::text,true);
  set local role authenticated;
  perform public.admin_replace_item_photo(lost_item,null,null,'https://img.example.com/admin.jpg');
  reset role;
  select count(*) into n from public.item_photo_candidates where item_id=lost_item and status='pending';
  assert n=0, 'An admin replacement supersedes pending candidates';
  select status into v_text from public.picks where item_id=lost_item and user_id=carol;
  assert v_text='active', 'An admin replacement publishes the waiting Pick';
end;
$flow$;
$test$, 'L4: first photo on a published product waits for AAL2 admin review; Pick waits with it; approval/rejection/idempotency/cleanup');
select * from finish();
rollback;
