begin;
create extension if not exists pgtap with schema extensions;
select plan(1);
set local plpgsql.check_asserts = on;
select lives_ok($test$
do $flow$
#variable_conflict use_variable
declare
  owner uuid := gen_random_uuid(); guest uuid := gen_random_uuid(); banned uuid := gen_random_uuid();
  cats uuid[] := array(select gen_random_uuid() from generate_series(1,5));
  goods uuid[] := array(select gen_random_uuid() from generate_series(1,5));
  shown uuid[] := array(select gen_random_uuid() from generate_series(1,3));
  hidden_item_pick uuid := gen_random_uuid(); hidden_cat_pick uuid := gen_random_uuid();
  pending_pick uuid := gen_random_uuid(); banned_pick uuid := gen_random_uuid();
  actor uuid; stamp timestamptz := now() + interval '1 day';
  v_username text; v_count integer; v_summary text; v_keywords text[]; v_picks jsonb;
  v_category text; v_item text; v_review text; n integer;
begin
  insert into auth.users(id,aud,role,created_at,updated_at)
    select id,'authenticated','authenticated',now(),now() from unnest(array[owner,guest,banned]) id;
  insert into public.profiles(id,username,onboarding_completed) values
    (owner,'preview_owner',true),(guest,'preview_guest',true),(banned,'preview_banned',true);
  -- Register everything against open categories first, then hide two of them.
  -- The existing category-write guard must not be disabled to build fixtures.
  insert into public.categories(id,name,slug,status,is_visible,is_pickable) values
    (cats[1],'Preview one','prev-'||cats[1],'open',true,true),
    (cats[2],'Preview two','prev-'||cats[2],'open',true,true),
    (cats[3],'Preview three','prev-'||cats[3],'open',true,true),
    (cats[4],'Preview hidden item','prev-'||cats[4],'open',true,true),
    (cats[5],'Preview hidden category','prev-'||cats[5],'open',true,true);
  insert into public.items(id,category_id,name,normalized_name,status) values
    (goods[1],cats[1],'Preview ramen','preview ramen','active'),
    (goods[2],cats[2],'Preview movie','preview movie','active'),
    (goods[3],cats[3],'Preview snack','preview snack','active'),
    (goods[4],cats[4],'Preview hidden item','preview hidden item','active'),
    (goods[5],cats[5],'Preview hidden category item','preview hidden category item','active');
  insert into public.picks(id,user_id,category_id,item_id,one_line_review,status,started_at) values
    (shown[1],owner,cats[1],goods[1],'국물이 제일 진해요','active',stamp),
    (shown[2],owner,cats[2],goods[2],'다시 봐도 좋아요','active',stamp+interval '1 minute'),
    (shown[3],owner,cats[3],goods[3],'식감이 오래 가요','active',stamp+interval '2 minutes'),
    (hidden_item_pick,owner,cats[4],goods[4],'숨겨진 상품','active',stamp+interval '3 minutes'),
    (hidden_cat_pick,owner,cats[5],goods[5],'숨겨진 카테고리','active',stamp+interval '4 minutes'),
    (pending_pick,guest,cats[1],goods[1],'검토 대기 중','needs_review',stamp),
    (banned_pick,banned,cats[2],goods[2],'정지된 계정','active',stamp);
  update public.items set status='hidden' where id=goods[4];
  update public.categories set is_visible=false where id=cats[5];
  insert into private.user_moderation(user_id,reason) values(banned,'Synthetic link preview test');

  select id into actor from public.system_actors where slug='onepick_ai';
  insert into public.profile_ai_reviews(
    profile_id,actor_id,summary,body,keywords,source_fingerprint,model_name,prompt_version,is_visible)
  values (owner,actor,'고른 이유가 한결같아요','해석 본문',
    array['담백함','오래 쓰는 것','무채색'],'preview-fingerprint','test-model','taste-vtest',false);

  perform set_config('request.jwt.claim.sub','',true);
  set local role anon;

  select f.username,f.pick_count,f.ai_summary,f.ai_keywords,f.picks
    into v_username,v_count,v_summary,v_keywords,v_picks
    from public.link_preview_profile('preview_owner') f;
  assert v_username='preview_owner', 'A shared profile link resolves for a signed-out reader';
  assert v_count=3, 'A hidden item and a hidden category stay out of the previewed count';
  assert v_summary is null and v_keywords is null,
    'A generated but unpublished AI review never reaches a link preview';
  assert jsonb_array_length(v_picks)=3, 'The card carries at most three Picks';
  assert v_picks->0->>'itemName'='Preview snack' and v_picks->0->>'oneLineReview'='식감이 오래 가요',
    'The most recent Pick leads the card, with its own reason';
  assert v_picks->0->>'categoryName'='Preview three', 'Each line names the category it belongs to';
  assert v_picks::text not like '%hidden%', 'Nothing hidden from the feed leaks through a preview';

  select f.pick_count into n from public.link_preview_profile('  PREVIEW_OWNER  ') f;
  assert n=3, 'A pasted link may arrive with different case or padding';
  select count(*) into n from public.link_preview_profile('preview_nobody') f;
  assert n=0, 'An unknown username has no preview to leak';
  select count(*) into n from public.link_preview_profile('preview_banned') f;
  assert n=0, 'A suspended account has no link preview';

  reset role;
  update public.profile_ai_reviews set is_visible=true where profile_id=owner;
  set local role anon;
  select f.ai_summary,f.ai_keywords into v_summary,v_keywords
    from public.link_preview_profile('preview_owner') f;
  assert v_summary='고른 이유가 한결같아요', 'A published AI review is part of the card';
  assert array_length(v_keywords,1)=3, 'All three keywords travel with it';

  select f.username,f.category_name,f.item_name,f.one_line_review
    into v_username,v_category,v_item,v_review from public.link_preview_pick(shown[1]) f;
  assert v_username='preview_owner' and v_category='Preview one' and v_item='Preview ramen'
    and v_review='국물이 제일 진해요', 'A shared Pick link previews the author, the choice and the reason';

  select count(*) into n from public.link_preview_pick(pending_pick) f;
  assert n=0, 'A Pick awaiting review is not shareable';
  select count(*) into n from public.link_preview_pick(banned_pick) f;
  assert n=0, 'A suspended author has no shareable Pick';
  select count(*) into n from public.link_preview_pick(hidden_item_pick) f;
  assert n=0, 'A hidden item has no shareable Pick';
  select count(*) into n from public.link_preview_pick(hidden_cat_pick) f;
  assert n=0, 'A hidden category has no shareable Pick';
  select count(*) into n from public.link_preview_pick(gen_random_uuid()) f;
  assert n=0, 'An unknown id resolves to nothing rather than an error';

  reset role;
  assert not (select prosecdef from pg_proc where oid='public.link_preview_profile(text)'::regprocedure),
    'No security-definer RLS bypass';
  assert not (select prosecdef from pg_proc where oid='public.link_preview_pick(uuid)'::regprocedure),
    'No security-definer RLS bypass';
  assert has_function_privilege('anon','public.link_preview_profile(text)','execute')
    and has_function_privilege('anon','public.link_preview_pick(uuid)','execute'),
    'The edge renderer reads these as a guest';
end;
$flow$;
$test$, 'Link previews: public Picks and published AI review only, with suspension, hidden item and hidden category excluded');
select * from finish();
rollback;
