begin;
create extension if not exists pgtap with schema extensions;
select plan(1);
set local plpgsql.check_asserts = on;

select lives_ok($test$
do $flow$
declare
  v_parent uuid := gen_random_uuid();
  v_category uuid := gen_random_uuid();
  v_item uuid := gen_random_uuid();
  v_user uuid;
  v_latest_username text;
  v_latest_review text;
  v_latest_image text;
  v_result record;
  v_card jsonb;
begin
  update public.home_settings set minimum_pick_count = 3 where id;

  insert into public.categories(id, name, slug, status, is_visible, is_pickable)
    values(v_parent, 'Profile fixture parent', 'profile-parent-' || v_parent, 'open', true, false);
  insert into public.categories(id, name, slug, parent_id, status, is_visible, is_pickable)
    values(v_category, 'Profile fixture', 'profile-' || v_category, v_parent, 'open', true, true);
  insert into public.items(id, category_id, name, normalized_name, status)
    values(v_item, v_category, 'Profile product', 'profileproduct', 'active');

  for i in 1..3 loop
    v_user := gen_random_uuid();
    insert into auth.users(id, aud, role, created_at, updated_at)
      values(v_user, 'authenticated', 'authenticated', now(), now());
    insert into public.profiles(id, username, onboarding_completed)
      values(v_user, 'picker_' || i || '_' || substr(replace(v_user::text, '-', ''), 1, 8), true);
    insert into public.picks(user_id, category_id, item_id, one_line_review, status, started_at)
      values(v_user, v_category, v_item, '이유 ' || i, 'active', now() + interval '10 days' + i * interval '1 second');

    if i = 3 then
      select username, profile_image_url into v_latest_username, v_latest_image
      from public.profiles where id = v_user;
      v_latest_review := '이유 3';
    end if;
  end loop;

  set local role anon;
  select * into v_result from public.home_showcase_page();
  select value into v_card
  from jsonb_array_elements(v_result.items)
  where value->>'item_id' = v_item::text;

  assert v_card is not null, 'Qualified product appears on Home';
  assert v_card->>'latest_picker_username' = v_latest_username, 'Newest selector profile is returned';
  assert v_card->>'latest_pick_review' = v_latest_review, 'Newest selector review is returned';
  assert v_card->>'latest_picker_profile_image_url' is null, 'Dormant profile image remains null in Home';
  reset role;
end;
$flow$;
$test$, 'Home showcase includes the latest public picker profile and review');

select * from finish();
rollback;
