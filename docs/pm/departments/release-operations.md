# Release / 운영

측정·검증 주담당: Claude  
Go/Hold 판정: ChatGPT 총괄 PM  
Production 최종 승인: 사용자

## 역할

- GitHub main CI
- Cloudflare/Vercel 배포 상태
- Production Supabase migration
- Edge Function 배포
- 릴리즈 전후 검증
- 운영 장애·배포 불일치
- 현재 버전 운영 상태 판정

## 운영 단계

- DEV
- REVIEW
- READY
- PRODUCTION VERIFIED

## 원칙

- PR 병합과 Production 반영을 구분한다.
- main 코드와 Production DB migration 적용 여부를 별도로 확인한다.
- Production DB mode=apply, Edge Function 배포, secret/environment/permission 변경은 사용자 승인 게이트를 유지한다.
- 파괴적 변경은 별도 위험 검토 후 진행한다.
- 배포 후 실제 앱·DB·라우팅·핵심 흐름을 확인한다.
- 외부 서비스 제한과 실제 앱 결함을 구분한다.
- 비용 발생 변경은 필수가 아니면 우선 제안하지 않는다.

## 보고

main commit · CI · 앱 배포 · DB migration · Edge Function · QA/Security · 남은 위험 · 운영 단계 · Go/Hold
