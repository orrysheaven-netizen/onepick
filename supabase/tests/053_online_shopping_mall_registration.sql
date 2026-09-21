-- 쇼핑몰 원픽 등록 절차를 실제 역할·실제 카테고리로 끝까지 실행한다.
-- docs/life-service-entry-direction.md 참조.
--
-- 다른 흐름 검사와 다른 점 하나: 이 파일은 픽스처 카테고리를 만들지 않고
-- 20260921212000이 만든 **진짜 `online-shopping-mall` 카테고리**를 쓴다. 새로 연
-- 카테고리가 아이템이 0개인 상태에서 실제로 등록까지 통과하는지는 플래그를
-- 보는 것만으로는 알 수 없다. 카탈로그 소스가 없으면 중복 가드가 꺼지고,
-- category_accepts_picks가 막으면 요청 자체가 안 되고, 취향 매핑이 붙어
-- 있으면 AI 평가에 섞인다 — 셋 다 등록을 해봐야 드러난다.
--
-- 절차: 일반 사용자가 아이템을 요청 → 관리자가 승인 → 사용자가 원픽 등록.
-- 그다음 이 PR의 계약을 확인한다. 등록된 원픽은 프로필에는 있지만 AI 취향
-- 평가 재료에는 없어야 한다.
--
-- 멈춘 오프라인 말단이 사용자 경로에서도 막히는지 함께 확인한다. 플래그가
-- 아니라 실제 호출로 봐야 status='paused'가 하는 일을 확인한 것이 된다.
--
-- 기존 계정·카테고리·아이템·원픽을 쓰거나 바꾸지 않으며 전부 롤백한다.
begin;
create extension if not exists pgtap with schema extensions;
select plan(1);
set local plpgsql.check_asserts = on;

select lives_ok($test$
do $flow$
declare
  v_user constant uuid := 'f8400000-0000-4000-8000-000000000001';
  v_admin constant uuid := 'f8400000-0000-4000-8000-000000000002';
  v_mall uuid;
  v_garage uuid;
  v_item public.items%rowtype;
  v_rows integer;
  v_taste_rows integer;
  v_composition jsonb;
begin
  select id into v_mall from public.categories where slug = 'online-shopping-mall';
  assert v_mall is not null, '쇼핑몰 카테고리가 있어야 한다';
  select id into v_garage from public.categories where slug = 'auto-repair';
  assert v_garage is not null, '정비소 카테고리가 트리에 남아 있어야 한다';

  insert into auth.users(id,aud,role,email,encrypted_password,created_at,updated_at) values
    (v_user,'authenticated','authenticated','qa-mall-user@example.invalid','',now(),now()),
    (v_admin,'authenticated','authenticated','qa-mall-admin@example.invalid','',now(),now());
  insert into public.profiles(id,username,onboarding_completed) values
    (v_user,'qa_mall_user',true),(v_admin,'qa_mall_admin',true);
  insert into private.admin_users(user_id) values(v_admin);

  set local role authenticated;
  perform set_config('request.jwt.claims','{"aal":"aal2"}',true);

  -- 1. 일반 사용자가 쇼핑몰 아이템을 요청한다 ---------------------------
  perform set_config('request.jwt.claim.sub',v_user::text,true);
  assert not public.current_user_is_admin(), '요청자는 일반 사용자여야 한다';

  v_item := public.submit_item(v_mall,'테스트몰');
  assert v_item.status='pending', '요청은 승인 대기로 시작한다';
  assert v_item.category_id=v_mall, '요청은 쇼핑몰 카테고리에 붙는다';
  assert (select count(*)=0 from public.picks where user_id=v_user),
    '요청만으로는 원픽이 생기지 않는다';

  -- 승인 전에는 고를 수 없다.
  begin
    perform public.register_pick(v_mall,v_item.id,'테스트몰','승인 전 선택');
    assert false, '승인 대기 아이템은 선택될 수 없다';
  exception when sqlstate 'P0001' then
    assert sqlerrm='ITEM_NOT_ELIGIBLE', '예상한 미승인 거절이 아니다: '||sqlerrm;
  end;

  -- 2. 멈춘 오프라인 말단은 요청 자체가 막힌다 ---------------------------
  -- status='paused'가 사용자 경로에서 실제로 하는 일.
  begin
    perform public.submit_item(v_garage,'테스트정비소');
    assert false, '멈춘 카테고리에는 아이템을 요청할 수 없어야 한다';
  exception when sqlstate 'P0001' then
    assert sqlerrm='CATEGORY_NOT_PICKABLE', '예상한 멈춤 거절이 아니다: '||sqlerrm;
  end;

  -- 3. 관리자가 승인한다 -------------------------------------------------
  perform set_config('request.jwt.claim.sub',v_admin::text,true);
  assert public.current_user_is_admin(), '승인자는 관리자여야 한다';
  update public.items set status='active' where id=v_item.id and status='pending';
  get diagnostics v_rows = row_count;
  assert v_rows=1, '관리자 승인이 정확히 한 건을 바꿔야 한다';

  -- 4. 사용자가 원픽으로 등록한다 ----------------------------------------
  perform set_config('request.jwt.claim.sub',v_user::text,true);
  perform public.register_pick(v_mall,v_item.id,'테스트몰','여기서만 사서 반품 한 번도 안 막혔다');
  assert (select count(*)=1 from public.picks
          where user_id=v_user and category_id=v_mall and status='active'),
    '쇼핑몰 원픽이 하나 저장돼야 한다';
  assert (select one_line_review='여기서만 사서 반품 한 번도 안 막혔다'
          from public.picks where user_id=v_user and category_id=v_mall and status='active'),
    '한줄평이 그대로 저장돼야 한다';

  -- 5. 이 PR의 계약: 프로필에는 있고 AI 취향 재료에는 없다 ---------------
  select count(*) into v_taste_rows from public.profile_taste_picks(v_user);
  assert v_taste_rows=0,
    '쇼핑몰 원픽은 AI 취향 평가 재료에 들어가서는 안 된다 (실제: '||v_taste_rows||')';

  v_composition := public.profile_taste_composition(v_user);
  assert (v_composition->>'total_pick_count')::int = 1,
    '취향 구성의 전체 원픽 수에는 잡혀야 한다';
  assert (v_composition->>'mapped_pick_count')::int = 0,
    '취향 구성의 분모에는 잡히지 않아야 한다';
  assert (v_composition->>'unmapped_pick_count')::int = 1,
    '미분류로 잡혀야 한다';
  assert (v_composition->'dimensions') = '[]'::jsonb,
    '취향 차원이 하나도 만들어지지 않아야 한다';
end;
$flow$;
$test$, '쇼핑몰: 아이템 요청 → 관리자 승인 → 원픽 등록. 멈춘 오프라인은 요청 거절, 등록된 원픽은 AI 취향 재료에서 제외');

select * from finish();
rollback;
