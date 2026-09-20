# First-user MVP pre-launch QA

## Purpose

Lock the first real-user journey into one release gate:

**Login → username → onboarding → 5 Picks → AI evaluation request → public profile → profile share**

This scenario is not a feature demo. It is the minimum journey that must remain usable before an MVP launch.

## Scope

Automated regression:

- first login without a profile is routed to username creation
- the initial `home` intent is preserved through username creation
- first username completion enters onboarding
- onboarding preserves `categoryId + onboarding=1` through Pick finder and choose
- a successful onboarding Pick records the `picked` action
- the fifth Pick invalidates cached AI eligibility
- refetched AI state can become `READY_FIRST`
- AI generation calls the generation service
- AI generation invalidates AI status and AI comment caches
- the owner profile opens `/u/[username]`
- the public profile exposes the share CTA
- the share payload contains the public profile URL and current Pick count

Executable check:

```bash
cd mobile
npm test
```

The scenario is covered by `scripts/test-first-user-prelaunch.cjs`.

## Manual release scenario

Use a newly created test identity that has never created a OnePick profile.

| Step | Tester action | Expected result | Release blocker |
| --- | --- | --- | --- |
| 1. Login | Open OnePick while signed out and continue with Kakao | OAuth completes once and returns to OnePick without losing the intended flow | P0 if login loops, errors, or returns to an unrelated screen |
| 2. Username | Enter an unused valid username | Username is saved once; duplicate/invalid input shows a clear error; successful save enters onboarding | P0 if profile creation fails or navigation is lost |
| 3. Onboarding | Start with the suggested category, then continue through categories | Each category can be picked or skipped; leaving does not erase prior Picks; saved Picks are not immediately repeated | P0 if the flow becomes stuck; P1 if progress/recovery is confusing |
| 4. Five Picks | Complete five different category Picks with one-line reviews | Profile shows 5 current Picks; taste composition reflects the current profile; the fifth save refreshes AI eligibility | P0 if a saved Pick disappears or overwrites the wrong category |
| 5. AI eligibility | Open the profile after the fifth Pick | Copy states that 5/5 Picks are complete and the AI evaluation CTA is enabled | P0 if 5 Picks still show an ineligible/stale state |
| 6. AI request | Press `AI 평가 보기` once | Loading state appears; one request is sent; result renders without duplicate generation | P0 if request cannot complete; P1 if recoverable error copy is unclear |
| 7. Public profile | Open `공개 프로필 보기` | Public route is `/u/<username>`; profile information, taste composition, AI visibility state, and category-grouped Picks render | P0 if direct public profile route fails |
| 8. Share | Press `프로필 공유하기` | Native/web share receives a public OnePick URL and current Pick count; opening the URL resolves to the same public profile | P0 if link is broken or opens another profile; P1 if share sheet itself fails but copy/link fallback exists |

## Evidence to capture

For one clean run, retain:

1. test username
2. timestamps for login, fifth Pick save, and AI request
3. screenshot after username completion
4. screenshot of 5/5 AI eligibility
5. screenshot of generated AI evaluation
6. copied/shared public profile URL
7. result of opening that URL in a new browser session

Do not use an administrator identity for this pass. The purpose is to reproduce the first normal user experience.

## Pass criteria

The release gate passes only when:

- all automated mobile regression checks pass
- the manual scenario reaches the shared public profile without a forced reload, route reset, or stale AI state
- the fifth Pick appears in the profile before AI generation
- the AI request produces one visible result
- the shared profile URL can be opened independently

## Failure handling

- **P0**: stop the pre-launch sign-off and fix before continuing.
- **P1**: record the issue and decide whether it materially blocks the first-user journey.
- Non-blocking visual polish can proceed separately and must not expand this scenario's functional scope.

## Out of scope for this gate

This scenario does not approve:

- Admin/MFA flows
- item moderation and approval
- account deletion
- long-term AI re-evaluation/cooldown behavior
- every external catalog provider
- notification delivery
- advanced profile editing

Those remain separate QA tracks. The goal here is one reliable first-user path from anonymous entry to a shareable OnePick profile.
