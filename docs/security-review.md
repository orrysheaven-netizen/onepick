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

## Dependency advisory: node-forge build-tool chain (L8, 2026-10-03)

Reference: #686 (Security QA 2026-10-03, L8, Low).

`mobile/package-lock.json` resolves `node-forge@1.4.0` only through the Expo tool chain:
`expo@57.0.22 -> @expo/cli@57.0.24 -> @expo/code-signing-certificates@0.0.6 -> node-forge`,
and directly from `@expo/cli`. The app does not declare `node-forge` as a runtime dependency.

The current High advisory (CVE-2026-85393 / GHSA-86w9-cpqp-85rv) includes 1.4.0, while 1.4.0 is also the current npm release. There is therefore no released npm version to upgrade to as of this review.

**Temporary MVP handling:** keep the affected package confined to the existing Expo build/development tool chain; do not add direct application use of `node-forge` or its RSA verification APIs. Do not pin an unreviewed Git commit or introduce a new dependency solely to silence the audit. Re-run `npm audit` when Expo/node-forge publishes a patched release and take the compatible upgrade through the normal dependency/regression-test path.

This is a time-bounded build-tool residual-risk record, not approval to ignore future patched versions. Reopen immediately if the dependency becomes part of shipped application runtime code, the advisory scope changes, or an upstream fixed npm release becomes available.

## 공개 상품 첫 사진 관리자 검수 (L4, 2026-10-02)

Reference: #640 (Security QA 2026-10-02, L4, Low). 사용자 결정: 위험 수용(#665)이 아니라 검수 방식으로 변경.

- **원칙.** 승인된 대표사진이 없는 공개(active/discontinued) 상품에 사용자가 처음 올린 사진은 관리자(AAL2) 검수를 거친다. 승인 전에는 올린 본인에게만 보이고(내 프로필·상품 상세), 다른 사용자에게는 보이지 않는다.
- **구현.** `20261002210000_review_first_item_photos.sql`. 사진은 `items`가 아니라 `item_photo_candidates`(본인 행만 RLS select, 쓰기는 RPC만)에 저장된다. 이 사진으로 새로 만든 원픽은 `needs_review`(기존 picks RLS상 본인만 보임)로 두고, 승인하면 상품 대표사진이 되면서 그 상품을 기다리던 `needs_review` 원픽이 `active`로 바뀐다. 거절하면 사진만 빠지고 원픽은 `needs_review`로 남아 다시 올릴 수 있다. 새 상품 요청(pending item)은 기존대로 요청 전체(사진 포함)가 검수된다.
- **승인 RPC.** `admin_review_item_photo_candidate`는 `is_admin_mfa()`(AAL2) 필수, 상품 행 → 후보 행 순서로 잠근다(사용자 쓰기 경로와 같은 순서). 같은 결정을 반복하면 기존 행을 그대로 돌려주고(idempotent), 이미 처리된 후보·대표사진이 이미 있는 상품·비공개 상품·파일이 맞지 않는 후보는 거부한다. 서로 다른 두 후보의 동시 승인은 상품 행 잠금으로 직렬화되어 두 번째가 `PHOTO_CANDIDATE_NOT_PENDING`으로 끝난다. 사용자가 사진을 다시 올리면 기존 pending 후보는 `superseded`가 되고 새 사진은 새 후보 id로 저장된다. 따라서 관리자가 본 id를 승인하면 그 id의 사진만 반영되고, 교체된 옛 id 승인은 `PHOTO_CANDIDATE_NOT_PENDING`으로 실패한다(교체와 승인이 동시에 와도 같은 상품 행 잠금으로 직렬화).
- **Storage는 그대로다.** `item-photos` 버킷은 public을 유지한다(사용자 결정). 승인 전 제한은 앱/API 노출 기준이며, Storage URL 자체의 비공개는 보장하지 않는다(경로는 추측하기 어려운 업로드 경로). pending 후보 파일은 소유자 삭제 정책(`is_unused_item_photo`)과 일일 정리(`stale_item_photo_paths`) 대상에서 빠지고, 반려·대체된 후보 파일은 다시 정리 대상이 된다.
- **Production 적용은 별도 사용자 승인 게이트다.**

## Dependency advisory: braces build-tool chain (L9, 2026-10-04)

Reference: #703 (Security QA 2026-10-04, L9, Low).
Advisory: https://github.com/advisories/GHSA-vfj7-8cjw-p6xm (CVE-2026-93687).

### Compatible update verification

At `main@d0fae5d2a817fbbdfd3918180f549e52e1384b62`, `mobile/package-lock.json`
resolves `braces@3.0.3` and `micromatch@4.0.8`; micromatch requires
`braces: ^3.0.3`. `mobile/package.json` has no overrides. The existing range
already permits a compatible 3.0.x patch, so a major Expo/React Native change
is not needed to accept a future patch.

However, the npm registry on 2026-10-04 reports `latest: 3.0.3`, and its
published version list contains no 3.0.4 or later release.
`npm view braces@3.0.4 version` returns E404 ("No match found for version 3.0.4").
The upstream package manifest also remains 3.0.3, and the GitHub advisory
lists no patched version. An override cannot supply an unpublished patch.
Do not add a non-resolving override, fabricate a lock entry, pin an unreviewed
Git commit/fork, or apply the breaking Expo/React Native downgrade proposed
by audit merely to reduce the advisory count.

Verification sources:
- https://registry.npmjs.org/braces
- https://github.com/micromatch/braces/blob/master/package.json
- https://github.com/advisories/GHSA-vfj7-8cjw-p6xm

### Temporary MVP residual-risk handling

Accept this **build/development-only residual risk** until a reviewed,
compatible patched npm release is available. The affected path is
`micromatch -> braces` in Metro/Expo file matching and bundling; #703 traces
the propagated findings through React Native and Expo. The advisory concerns
stack exhaustion from deeply nested brace patterns. Exposure is developer/CI
Node processes processing malicious glob patterns, potentially interrupting
a build or file watcher. This does not make the upstream High advisory
harmless; the project-level Low classification reflects the confined exposure.

No shipped app-runtime use was identified in #703: the web export,
Cloudflare Pages Functions and Supabase Edge Functions are outside the
reported path. This runtime assessment relies on #703's inspection, not a
new full bundle analysis. Do not introduce direct application use of braces
or route untrusted user input into build-tool glob configuration. Existing
repository-controlled build inputs and CI trust boundaries remain in place.

**Re-review:** during subsequent dependency audits and immediately when
braces publishes a patched npm release, the advisory changes, untrusted
patterns reach the tool chain, or braces becomes shipped runtime code.
Then update only the compatible transitive dependency (lock refresh first;
a narrow override only if required), run npm audit, typecheck/regressions
and web export checks, and verify the required CI results before merge.

This record satisfies #703 L9's documented-risk alternative; it does not
claim the vulnerability is patched or the audit is clean. No dependency,
application, workflow, DB permission or Production change is made.
