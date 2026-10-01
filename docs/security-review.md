# Security review — 2026-09-17

## Verified in this pass

- Dependency audit status was refreshed on 2026-09-25: `mobile/` reports 14 moderate advisories (1 affecting deployment/runtime code and 13 build/development-only in the Security QA classification), while `tools/qa/` reports 0 advisories. This is a point-in-time dependency check, not a full security assessment.
- Follow-up plan: keep the runtime-affecting advisory prioritized for a compatible dependency update and regression test; handle build-only advisories through normal dependency updates without forcing breaking major upgrades solely to make the audit count zero. Re-run both audits after dependency changes and record any accepted residual risk.
- Auth return, auth session and safety regression scripts passed. They cover malformed return parameters, session races, logout/cache cleanup and block/report validation.
- Web export succeeded. Export validation passed for 10 direct routes, 2 assets, callback query and SPA fallback.
- Earlier rollback-only database lifecycle checks are recorded in `two-user-validation.md`. They do not substitute for browser/account testing.

## Change

Added Cloudflare Pages static response headers: nosniff, frame embedding denial, restricted base/object sources and strict-origin-when-cross-origin referrer policy. The CSP intentionally does not yet restrict scripts, styles or network destinations; it is not a complete XSS defense.

Reference: https://developers.cloudflare.com/pages/configuration/headers/

The export contains the updated `_headers` file. Local `serve` does not apply these Cloudflare rules. No hosted deployment or live response-header verification was performed. Verify headers and Kakao login on the actual HTTPS deployment before release; Pages Functions need their own response headers if added later.

## Remaining release checks

- Verify administrator MFA enforcement and recovery on the deployed service.
- Comment/report quotas were subsequently applied and verified below. Local migrations also contain daily item submission limits and an image import quota; high-concurrency load testing remains outstanding.
- Supabase's previous advisor check reported leaked-password protection disabled. Review if password login is enabled; Kakao login alone does not validate this setting.
- Native login persistence currently uses AsyncStorage. Review secure credential storage before a native release. Web localStorage sessions still require XSS prevention.
- Validate backup restoration and deployed HTTPS/security headers.

No remote database schema, auth settings or access policies were changed in this pass. The pending uncategorized-request migration remains unapplied and is excluded from this change.

## Follow-up: community writes (2026-09-17)

Applied `20260917110856_limit_comment_and_report_writes.sql` to onepick-dev. Successful comment creation and body changes share a per-account quota of 10 writes per minute; new reports allow 10 per hour. Windows start with the first successful write, rather than at a calendar minute/hour boundary. Failed writes roll back the quota too. Deleting content does not reset it. Limits are per account, not per IP; they do not prevent account-farming or general network flooding.

The private quota table has two rows at most per account and cascades on account deletion. Clients have no table or function permissions. The trigger validates the signed-in actor, uses an empty search path, and leaves existing ownership/moderation rules in place. A conditional atomic upsert serializes writes to the same account/action. The advisor reports a no-policy INFO for this intentionally inaccessible private table; no client policy should be added merely to silence it.

Rollback-only SQL assertions passed before and after deployment: the 11th comment/report is rejected, edits consume the comment quota, unchanged bodies do not, another user has a separate quota, duplicates remain rejected, deletion cannot restore quota, clients cannot read/reset counters, and an expired window allows new writes. No concurrent-session load test was run. Fixture accounts/content were rolled back.

The report UI now guards rapid repeated taps synchronously and prevents resetting an in-flight submission. Comments/reports display a specific wait-and-retry message when the server returns RATE_LIMITED. Type checking, safety and interaction regression scripts, and web export passed.

Read-only inspection confirms the deployed administrator check uses the private allowlist, but does not require MFA assurance. MFA enrollment/recovery and enforcement remain a separate release task; no administrator login settings were changed. Leaked-password protection remains disabled. The unrelated uncategorized-request migration remains unapplied.

## PM review queue 판정 신원 (L6, 2026-10-01)

Reference: #604 (Security QA 2026-10-01, L6, Low, 참고).

`.github/workflows/ai-pm-review-queue.yml`은 `PM_REVIEW_DONE`을 **저장소 소유자 계정**이 쓴 줄만 인정하고, handoff App bot이 쓴 판정은 거부한다. 그러나 소유자 계정은 사용자, ChatGPT PM, 수동 Codex/Claude 세션이 함께 쓴다. 프롬프트 인젝션이 성공한 수동 세션이 `PM_REVIEW_DONE: decision=continue`를 남기면 "PM 판정"으로 기록될 수 있고, 이 신원은 실제 PM과 구분되지 않는다.

**판정: 현재 MVP에서 수용한다 (코드 변경·신규 비용 없음).** 전용 PM 계정/App은 도입하지 않는다.

- **영향 범위:** 기록은 댓글과 `state:blocked` 등 라벨뿐이다. 이 workflow에는 PR 코드 checkout·실행, 병합, 배포, 시크릿 사용 경로가 없다(Security QA #604에서 확인). 최악의 결과는 "오인된 PM 승인 기록"이다.
- **승인 게이트는 그대로다.** `PM_REVIEW_DONE`은 routing/상태 기록이며 main merge, Production DB apply/deploy, secret/permission 변경의 사용자 직접 승인을 대체하지 않는다. `decision=user-approval`은 전달 표시일 뿐이다. 이 내용은 `docs/pm/README.md`의 "L6 — 계정 단위 신뢰 한계 수용"에 규칙으로 적었다.
- **금지:** 어떤 자동화도 이 판정/marker를 병합·배포·시크릿 단계의 입력이나 승인 근거로 쓰지 않는다. 쓰려면 전용 PM identity(별도 계정 또는 App)와 보안 검토를 먼저 한다.
- **재검토 조건:** 판정 기록을 자동 단계의 입력으로 쓰려 할 때, 소유자 계정을 여러 사람/에이전트가 공유하게 될 때.
- **완료 기준 충족:** #604 L6의 완료 기준 중 "`docs/pm/README.md`·`docs/security-review.md`에 계정 단위 신뢰 수용 기록"을 이 문서화로 충족한다. 워크플로가 전용 신원만 인정하도록 바꾸는 선택지는 택하지 않았다.
