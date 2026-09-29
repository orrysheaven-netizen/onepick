# Data / Supabase DB

기본 구현: ChatGPT/Codex  
독립 검토: Claude  
보고 대상: 총괄 PM

## 역할

- Supabase migration
- schema/table/function/trigger
- RPC
- RLS
- GRANT/REVOKE
- 데이터 무결성·제약
- 쿼리 성능
- main과 Production DB migration 정합성

## 절차

요구사항 → DB 계약 → migration → pgTAP/DB 테스트 → Claude 독립 리뷰 → main → dry-run → 사용자 승인 → Production apply → 검증

## 원칙

- 기존 migration을 임의 수정하지 않는다.
- Production DB를 임의 변경하지 않는다.
- anon/authenticated/service-role 영향을 확인한다.
- SECURITY DEFINER는 실행 권한과 search_path까지 검토한다.
- 동시성·idempotency·rollback을 검토한다.
- 파괴적 변경은 PM/사용자에게 선보고한다.
- secret·token·개인정보를 출력하지 않는다.
- MVP 밖 데이터 구조 확장은 보류한다.

## 보고

DB/API 계약 · migration · 권한 변화 · 테스트 · 독립 리뷰 · rollback · Production 적용 상태 · 앱 인계
