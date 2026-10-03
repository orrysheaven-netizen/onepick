# OnePick 현재 우선순위

기준일: 2026-10-03  
상태: **초기 MVP 핵심 계약 Production 정합화 완료 / 잔여 데이터·QA 운영 보완 단계**

## 현재 원칙

- 극초기 MVP 핵심 흐름 안정성을 신규 기능보다 우선한다.
- 이미 완료된 기능을 다시 구현하지 않고, superseded PR/이슈를 재사용하지 않는다.
- main 병합과 Production 반영을 분리한다. Production DB apply·secret/permission 변경·파괴적 데이터 작업은 사용자 승인 게이트를 유지한다.
- 별도 유료 API·추가 비용은 필수인 경우가 아니면 도입하지 않는다.
- P3 확장은 사용자가 별도로 우선 지시하지 않는 한 보류한다.

## P0 — 데이터 무결성 / 운영 확인

1. **Production 핵심 DB 계약 정합성 완료**
   - `20261002165000_guard_current_pick_last_photo` (#634) 적용·검증 완료.
   - `20261002193000_remove_approval_auto_pick` (#674) 적용·검증 완료.
   - `20261002210000_review_first_item_photos` (#690) 적용·검증 완료.
   - 첫 유효 사용자 사진은 관리자 검수 전 앱/API에서 업로더 본인에게만 노출하고, 승인 후 대표사진으로 공개한다.
   - 사용자 최신 결정에 따라 `item-photos` Storage는 public을 유지하며 URL 자체 비공개는 보장하지 않는다.
   - 과거 L4 위험 수용 문서 PR #665는 superseded로 종료됐다.

2. **기존 photo-less active Pick 8건 비파괴 보충** (#633)
   - Pick/한줄평/선택 기록은 유지한다.
   - 라면 4건 + IU 1건은 exact/high-confidence source 확보.
   - 게임 3건은 IGDB exact cover hash 미확정으로 보류.
   - source-policy 우회나 임의 이미지 자동 채택은 하지 않는다.
   - Production 사진 반영은 별도 승인 전 0건 유지.

3. **QA 운영 복구 및 최신 재측정** (#686, #687, #697)
   - Security QA: Critical/High/Medium 신규 없음. L4는 #690으로 해결, L5·L7은 Low 추적 유지.
   - Daily QA: #689로 매장 검색 cold/warm 및 Home endpoint별 호출 수 계측을 main에 추가. 다음 Daily QA 측정값으로 검색 Medium 종료 여부를 판정한다.
   - Deployment Consistency #676의 `SUPABASE_QA_ACCESS_TOKEN` 401은 해결 완료.
   - Hourly real-user error monitor #697은 기존 Production deploy token으로 read-only DB query를 호출해 HTTP 403이 발생. Draft #698에서 QA read-only token과 deploy token을 분리 중.
   - #698의 QA token 권한은 **Edge Functions: Read + Database: Read + Advisors: Read**만 사용하며 Read-write는 주지 않는다.

## P1 — 현재 MVP 흐름 안정화

- **Follow MVP**
  - 공개 프로필 Follow CTA: ON
  - 공개 팔로워/팔로잉 수·목록: ON
  - Home following feed: OFF
  - follow 변경 알림·설정·푸시: OFF
  - #648 → #655 → #657 canonical chain main 반영 완료.

- **원픽 사진 계약**
  - 신규/교체 Pick은 대표사진 필수.
  - current Pick item의 마지막 사진 제거 차단은 main + Production 반영 완료.
  - 기존 대표사진이 없는 공개 item의 첫 사용자 사진은 후보 상태로 관리자 검수 후 공개.
  - 거절 시 Pick은 유지하고 후보 사진만 제외한다.
  - 기존 photo-less current Pick 8건은 별도 비파괴 보충 대상으로 유지.

- **등록 요청 정책**
  - 승인/병합 이벤트가 legacy intent에서 새 Pick을 자동 생성하지 않는 계약은 main + Production 반영 완료.
  - modern `needs_review` Pick은 새 row 생성이 아니라 기존 row publish/move 계약을 유지.
  - 승인/검토 완료 후속 알림은 현재 MVP에서 노출하지 않는다.

- **CI / QA 계약**
  - unrelated Ready PR required-check 회귀 방지 main 반영 완료.
  - #689 계측 보강 main 반영 완료.
  - #698은 secret 재발급·read-only 검증 전 Draft 유지.

## P2 — 점검 후 보완

실제 근거가 있는 항목만 처리한다.

- Security Low L5: `cleanup-item-photos` 공개 호출은 bounded maintenance 경로이며, 별도 secret/header 계층 도입은 사용자 승인 없이는 하지 않는다.
- Security Low L7: DB deploy TLS/argv 비밀번호 개선은 Supabase CA 공급 방식과 CLI 계약 검증 없이 즉시 변경하지 않는다.
- Security L8: Expo 빌드 도구 체인의 `node-forge` advisory는 runtime 경로가 아니며 upstream patched release가 없어 residual-risk 문서화 완료(#688).
- Notion/운영 문서가 현재 main과 어긋날 경우 최신 GitHub 기준으로 최소 정합화한다.

## P3 — 보류 중인 확장

- 온라인/레시피 공개 롤아웃
- 추가 테마·카테고리 확장
- Home following feed / follow 알림
- 비필수 AI·추천 고도화
- 추가 유료 자동화·인프라
- `youtube-catalog` Production Edge drift (#683)
  - 전체 Edge 대조 결과 drift는 `youtube-catalog` 1개뿐.
  - DB의 승인 후 자동 Pick 제거 계약은 Production 반영 완료.
  - 현재 recipe 공개 롤아웃이 OFF이므로 MVP blocker는 아니며, 재노출 전에 사용자 승인 후 공식 Edge deploy가 필요.

사용자가 별도로 우선 지시하지 않는 한 P0~P2보다 P3를 먼저 시작하지 않는다.
