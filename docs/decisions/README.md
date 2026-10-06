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
