# OnePick Decision Lock

Locked Decisions are user-approved product/UX contracts. GPT, Claude, Codex, automation, and other AI workers may propose changes but cannot approve them.

## Authority

- Approval authority: the human repository owner / CODEOWNER only.
- `Changes-Decision: <ID>` is tracking metadata only. It is never proof of approval.
- Bug fixes, refactors, performance work, Figma synchronization, QA fixes, and regressions are not exceptions.
- If a task cannot preserve a locked contract, stop implementation and request a user decision.
- A temporary removal or disablement of a locked behavior is itself a contract change.

## Enforcement layers

1. `.github/CODEOWNERS` protects this control plane and executable contract tests.
2. The `Locked Contracts` required check executes active contracts.
3. Repository branch protection/ruleset must require Code Owner approval and the `Locked Contracts` check. AI identities must not be bypass actors.
4. New commits after approval must invalidate stale approval.

A repository setting is not considered enforced merely because this document says so. The human owner must verify the GitHub setting.

## Initial scope

Only four established contracts are registered. Three are immediately locked. `UX-SWIPE-001` is staged because the current main does not yet contain the approved restoration; it must be activated immediately after that restoration is merged and verified.


## Threat-model requirements

- Protect the entire `.github/` tree. Protecting only the canonical workflow file is insufficient because another workflow can attempt to publish a same-name check.
- Protect executable contract tests **and their direct dependencies/configuration**. A test that is unchanged can still be weakened by changing what it imports or the dependency version it executes with.
- GitHub App credentials used by repository workflows are privileged infrastructure. Handoff/reviewer Apps must not have repository administration permission and must not be branch/ruleset bypass actors.
- General PR approval is not Decision approval. A bot/App approval cannot substitute for required human Code Owner approval.
- Required-check identity must be configured by the human owner only after the canonical workflow has run on main; a matching text name alone is not an authorization signal.

## Human-owner settings required before enforcement is complete

Decision Lock is **not active** until the human owner verifies the repository settings require: pull requests, Code Owner review, stale-approval dismissal, approval from someone other than the last pusher, the canonical Locked Contracts check, no AI/App bypass actor, and no force-push path. Auto-merge must never bypass these requirements.
