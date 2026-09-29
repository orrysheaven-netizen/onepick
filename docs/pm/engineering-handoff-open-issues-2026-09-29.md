# 열린 이슈 인계 정보 점검 — 2026-09-29

현재 상태 주의: 아래는 최초 감사 시점의 23건 기록이다. 이후 #573은 main 병합, #486은 마지막 시험 실패로 4/4 소진 및 blocked 유지, #571도 blocked 유지다. 실행 판단에는 이 스냅샷 대신 최신 API와 [대안 설계의 승인·검증 조건](engineering-local-runner-design-2026-09-29.md)을 확인한다. 이 표를 근거로 #486을 재실행하지 않는다.

[착수 점검 및 검증 계획](engineering-handoff-readiness-2026-09-29.md)의 부록. GitHub 열린 이슈 23건의 스냅샷이다. 이 표는 이슈 수정·담당 재배정·실행 라벨 적용이 아니다. 선행/산출물은 본문과 점검 결과를 요약하며, 미확인은 실행 가능을 뜻하지 않는다. 분류안은 확정 배정과 구분한다. 모든 이슈의 GitHub assignee는 비어 있었다.

| 이슈 | 책임 부서 | 실행기/담당 | 실제 상태 라벨 | 선행/차단 확인 | 산출물/증거 |
| --- | --- | --- | --- | --- | --- |
| [#176](https://github.com/orrysheaven-netizen/onepick/issues/176) 미결 결정 3건 (Claude 세션 보관 전 기록) | PM + 해당 부서 | none — 사용자 결정 대기 | 미표기 | 남은 로그인/홍보 결정의 현행성 확인 | 체크리스트·#134/#160 참조; 자동 실행 불가 |
| [#211](https://github.com/orrysheaven-netizen/onepick/issues/211) feat(place): bootstrap first measured SBIZ Seoul sample | Data/DB (분류안) | 미확정 | 미표기 | 공식 데이터 접근·품질 게이트·운영 쓰기 승인 | 샘플/품질 보고/승격 검증; 완료 증거 미확인 |
| [#223](https://github.com/orrysheaven-netizen/onepick/issues/223) [자동화 계획] QA·운영 자동화 | QA/Release/PM | 항목별 담당 | 미표기 | docs/pm/routines.md의 중단/유지 기준 | 자동화 계획·여러 PR; 단일 실행으로 취급 불가 |
| [#296](https://github.com/orrysheaven-netizen/onepick/issues/296) [AI Ops] OnePick 작업·인계 대시보드 | PM/운영 | 대시보드 workflow | 미표기 | 이슈 owner/state 데이터 | 자동 생성 작업량/인계 표; 실행 티켓 아님 |
| [#303](https://github.com/orrysheaven-netizen/onepick/issues/303) [Brand] OnePick 브랜드 아이덴티티 v1 적용 | UX/Engineering (분류안) | 미확정 | 미표기 | PR #309 실제 최신 상태·기기 검증 확인 | 브랜드 구현 문서·#309; 본문 상태는 과거 기록 |
| [#448](https://github.com/orrysheaven-netizen/onepick/issues/448) [Social UI] 09-27 사용자 결정 반영: 시간·이전 원픽 제거, 현재 원픽 깃발, 홈 기본 탭, 7일 메뉴 랭킹 | Engineering | 기존 Codex active — 중복 금지 | owner:codex, state:active | 담당 진행/기존 PR 및 정책 확인 | 본문 #542/#446 등 참조; 최종 완료 미확인 |
| [#475](https://github.com/orrysheaven-netizen/onepick/issues/475) [UX] E 입력 보존·가입 의도 유지 | UX/Engineering | Codex (blocked) | owner:codex, state:blocked | 본문 Claude A+D; 최신 MVP 범위와 재대조 | PR #473 계획 참조; 구현 완료 미확인 |
| [#486](https://github.com/orrysheaven-netizen/onepick/issues/486) [AI Ops Smoke Test] Claude handoff authentication | Release/Engineering | Claude OAuth (blocked) | state:blocked, owner:claude | #573 검토·승인·main 반영 | run 36551860181 실패; 3/4회 사용 |
| [#492](https://github.com/orrysheaven-netizen/onepick/issues/492) [UI Stabilization] 기존 화면 디자인 통일 — 신규 화면 추가 중단 | UX/Engineering | 기존 Claude 인계; Figma 직접 편집 불가 | handoff:claude | 사용자 정책; #552 및 기존 PR 확인 | 기존 화면 통일 결과; 현행 완료 범위 확인 필요 |
| [#497](https://github.com/orrysheaven-netizen/onepick/issues/497) [Security QA] 2026-09-29 | QA/Security | Claude 측정/리뷰 | 미표기 | 기존 #464; 정책 판단 필요한 항목 분리 | 본문 Security 리포트; 현재 main 재검증 별도 |
| [#499](https://github.com/orrysheaven-netizen/onepick/issues/499) [Daily QA] 2026-09-29 | QA + 항목별 부서 | 항목별 담당 | owner:codex | 기존 #466/#448 등 구현과 중복 확인 | 본문 측정 리포트; 최신 재검증은 별도 |
| [#533](https://github.com/orrysheaven-netizen/onepick/issues/533) [MVP] 팔로우 보류에 맞춘 grouped notification 서버 필터 | Data/DB (분류안) | 미확정 | 미표기 | 기존 구현/병합 여부 확인; DB 적용 승인 | notification 필터 migration·pgTAP; 산출물 확인 필요 |
| [#552](https://github.com/orrysheaven-netizen/onepick/issues/552) [Figma 리뷰] UI 안정화 — Foundations 통일 점검 리포트 (클로드 UI/UX) | UX | ChatGPT 직접 Figma 작업 | handoff:codex, state:handoff | 사용자 결정 항목 분리; #492 중복 확인 | docs/figma-ui-review.md 및 스냅샷 링크 존재 |
| [#553](https://github.com/orrysheaven-netizen/onepick/issues/553) [PM] OnePick 총괄 PM 운영·우선순위 대시보드 | PM | none — 대시보드 | 미표기 | #557 및 담당 보고 | 현재 우선순위/완료 판정 |
| [#557](https://github.com/orrysheaven-netizen/onepick/issues/557) [PM Baseline] 2026-09-29 OnePick 현재 기준선 점검 | PM | none — 취합용 | 미표기 | #558~#563 담당 보고 AND | 최종 기준선 판정 대기 |
| [#558](https://github.com/orrysheaven-netizen/onepick/issues/558) [Baseline/Product] MVP 범위·정책 자체 점검 | Product | ChatGPT 담당 세션 | owner:codex | #555 병합; 최신 사용자 결정 | #557 정책 점검 보고 대기 |
| [#559](https://github.com/orrysheaven-netizen/onepick/issues/559) [Baseline/UX] Figma·앱 UX 정합성 자체 점검 | UX | ChatGPT 직접 Figma 점검 | owner:codex, state:ready | #555 병합; 현행 Product 기준 | #557 Figma/앱 차이 보고 대기 |
| [#560](https://github.com/orrysheaven-netizen/onepick/issues/560) [Baseline/Engineering] 최신 main 핵심 흐름 자체 점검 | Engineering | Claude OAuth (실패) | state:blocked, owner:claude | #486 실행기 복구; 기존 실패 원인 확인 | run 36572237481 실패; 자체 점검 완료 아님 |
| [#561](https://github.com/orrysheaven-netizen/onepick/issues/561) [Baseline/Data] main·Production DB 정합성 자체 점검 | Data/DB | Codex 로컬 세션 | owner:codex, state:ready | #555 병합; 운영 DB 읽기 권한 확인 | #557 DB 정합성 보고 대기 |
| [#562](https://github.com/orrysheaven-netizen/onepick/issues/562) [Baseline/QA] 최신 main 독립 재검증 | QA/Security | Claude OAuth (blocked) | state:blocked, owner:claude | #555 병합; #486 성공; 자체 점검 보고 확인 | #557 독립 재검증 보고 대기 |
| [#563](https://github.com/orrysheaven-netizen/onepick/issues/563) [Baseline/Release] 배포·운영 정합성 검증 | Release | Claude OAuth (blocked) | state:blocked, owner:claude | #555 병합; #486 성공; 담당 보고 확인 | #557 운영 검증 보고 대기 |
| [#570](https://github.com/orrysheaven-netizen/onepick/issues/570) [qa-alert] Deployment mismatch | Release (분류안) | 미확정 | 미표기 | 최신 배포 불일치 재현·#563 확인 | 본문 run 36561873775; 해소 증거 미확인 |
| [#571](https://github.com/orrysheaven-netizen/onepick/issues/571) [AI Ops] PM 지시 게시 즉시 담당 AI 실행 | Engineering | Claude OAuth (blocked) | state:blocked, owner:claude | #573 병합 + #486 성공 + PM 확인 | 구현 PR·검증·실제 후속 인계 증거 없음 |

누락/오래된 정보의 정규화는 후속 작업이다. 본문 링크를 자동으로 선행관계로 바꾸지 않으며, 단일 이슈에 여러 작업/결정이 섞인 경우 담당자가 실행 단위를 먼저 분리한다. 새 실행 라벨을 추가한 건수: 0. 기존 owner/active/handoff 변경: 0.
