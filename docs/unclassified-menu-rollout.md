# 미분류 메뉴 등록 적용·복구 (#836 / #839)

## 동작 결정

2026-10-08 사용자의 ‘바로 등록’ 지시에 따라 메뉴 목록/AI 응답을 기다리지 않아도
사진·한줄평 단계로 진행한다. 다음을 누른 시점에 분류가 확정되지 않았으면
입력한 메뉴명으로 owner-only needs_review 원픽을 저장한다. 느린 네트워크에서는
기존 분류가 있는 메뉴도 이 경로로 들어갈 수 있다. 늦게 온 AI 결과가 이미 확정한
등록 내용을 바꾸지는 않는다. 즉시 진행과 즉시 공개는 별개이며, 분류 검토 전에는 비공개다.
빈 메뉴명은 기존대로 허용하지 않는다.

원픽 해제는 한줄평·사진·요청 이력을 삭제하지 않는다. 미분류 항목은 pending으로
남겨 재등록 시 재사용한다. 현재 needs_review 원픽이 없으면 관리자 분류/공개는
PICK_NOT_FOUND로 거절한다. 요청자가 명시적으로 다시 등록해야 승인할 수 있다.
등록·해제·분류는 사용자 잠금을 같은 순서로 사용한다. 관리자 목록의 보존된 항목은
공개되지 않으며 필요하면 기존 거절 동작으로 정리한다.

## 적용 순서와 중단 조건

독립 리뷰와 사용자 운영 승인을 받은 뒤 진행한다. 운영 DB 변경은 아직 실행하지 않았다.

1. DB migration·pgTAP만 별도 PR로 분리하여 선행 병합한다. 현재 database-deploy는
   main만 실행하므로 PR 브랜치 apply나 보호 규칙 변경으로 순서를 우회하지 않는다.
2. Deploy Database Migrations의 dry-run에서 **전체** 대기 migration 목록을 검토한다.
   dry-run은 목록 확인이며 실행 시간/잠금 측정이 아니다. 승인 범위 밖 migration이
   있으면 중단한다.
3. 운영 규모 복제 환경에서 인덱스 재생성 시간을 측정한다. 트래픽이 낮은 적용 시간을
   정하고 운영 승인 후 apply한다. 이 migration의 lock_timeout=5s,
   statement_timeout=30s를 넘으면 트랜잭션 전체를 롤백하며 자동 재시도하지 않는다.
4. migration 동기화와 RPC 존재/권한 확인 후에만 앱 변경을 병합·배포한다.
   최종 승인과 배포 전 DB 선행 PR 분리/적용은 미완료 게이트다.

인덱스 재생성은 비동시 방식이므로 picks 쓰기를 일시 차단할 수 있다. pending-product
UUID가 술어에 들어가므로 해당 카테고리는 삭제·재생성하지 않는다. 이를 변경해야 하면
새 migration에서 인덱스까지 함께 갱신해야 한다.

## 복구

apply 실패: 트랜잭션으로 기존 인덱스/함수가 유지된다. 원인을 확인하고 앱 배포를 보류한다.

apply 성공 후 오류: 앱을 이전 배포로 되돌리고, 승인된 별도 복구 migration에서 아래 두
EXECUTE 권한을 회수하여 새 미분류 등록을 중단한다. 기존 요청·사진·원픽·매장 매핑은
보존한다. remove_pick_by_id와 분류 함수는 삭제하지 않아 기록 관리 경로를 유지한다.

```sql
begin;
revoke execute on function public.register_unclassified_menu_pick(text,text,uuid,text,text,text,text,text,uuid)
  from authenticated, service_role;
revoke execute on function private.register_unclassified_menu_pick_impl(text,text,uuid,text,text,text,text,text,uuid)
  from authenticated, service_role;
commit;
```

이전 앱의 미분류 카테고리 단위 해제는 여러 요청을 함께 해제할 수 있다. 기존 요청이
있는 운영 환경에서는 앱 전체 롤백보다 등록 RPC 중단 및 전진 수정이 우선이다.

구 인덱스로의 단순 원복은 동일 사용자의 미분류 원픽이 여러 개일 때 실패한다.
데이터를 지워서 제약을 맞추지 않는다. 다음 쿼리가 0행일 때만 별도 승인·검증된
복구 migration에서 원래 인덱스 정의를 복원할 수 있다. private 테이블 DROP은
매장 연결 정보를 잃으므로 일반 장애 복구에서 수행하지 않는다.

```sql
select user_id, category_id, coalesce(channel, '') as channel, count(*)
from public.picks
where status in ('active', 'needs_review')
group by user_id, category_id, coalesce(channel, '')
having count(*) > 1;
```
