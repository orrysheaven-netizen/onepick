# OnePick 현재 상태

기준일: 2026-09-29

## PM 판정

기존 기능 개발 묶음은 일단락되었으며, 현재는 **조직 전환 및 기준선 재확인 단계**다.

## 현재 실행 정책

- 신규 기능 작업: 중단
- 기존 완료 기능의 중복 수정: 금지
- 허용 작업: 상태 확인, 문서 정합성, QA 재검증, 운영 정합성 확인, superseded 정리
- 다음 개발 착수: PM 기준선 점검 후

## 기준선에서 확인할 영역

| 영역 | 확인 기준 |
| --- | --- |
| Product | 최신 사용자 결정과 현재 MVP 범위 |
| Figma | 현행 MVP 화면과 Foundations |
| Engineering | 최신 main |
| Data/DB | main migration + Production migration history |
| QA/Security | 최신 main 재측정 결과 |
| Release | 실제 tester/production 반영 상태 |
| Documentation | 최신 결정을 가리키는 단일 기준 존재 여부 |

## 상태 표기

- **확정**: 현재 기준으로 유지
- **보완**: 기능 방향은 맞지만 수정 필요
- **보류**: 현재 MVP 밖
- **폐기/superseded**: 최신 기준으로 대체
- **PM 결정 필요**: 부서가 독자 판단하지 않음

세부 작업 목록은 이 문서에 쌓지 않고 GitHub Issue로 관리한다.
