# Claude PR reviewer identity separation

This document prepares the move from the current Claude Code Routine review path,
which writes reviews as the connected human account, to a dedicated GitHub App
identity.

The change is intentionally staged. The existing review routine remains active
until the dedicated reviewer identity is proven. This work does not merge or
activate PR #247 and does not deploy to the production database.

## Why a separate App

The existing deployment App `onepick-deployment-automation` is not reused.
Deployment and code review are separate trust domains. The reviewer App receives
only the permissions required to read review context and write PR reviews.

GitHub requires `Pull requests: write` to create a PR review. The normal REST
merge endpoint requires `Contents: write`, which this reviewer App must not
have. The reviewer credential can therefore create reviews without holding the
content-write permission needed for the normal PR merge endpoint.

`Pull requests: write` can still modify some PR metadata, so the later Claude
review workflow must also restrict Claude's allowed GitHub tools to read/review
operations. Least privilege therefore has two layers: App/token permissions and
the workflow tool allowlist.

## Reviewer App profile

Create a private GitHub App named `onepick-claude-reviewer` and install it only
on `orrysheaven-netizen/onepick`.

Configuration:

| Setting | Value |
| --- | --- |
| Installation target | Only select repositories → `onepick` |
| User OAuth authorization | Not used |
| Webhook | Disabled unless a later design explicitly needs it |
| Metadata | Read |
| Contents | Read |
| Issues | Read |
| Pull requests | Write |
| Actions | Read |
| Checks | Read |
| Commit statuses | Read |
| Workflows | No access |
| Administration | No access |
| Environments | No access |
| Secrets | No access |
| All other write/admin permissions | No access |

Do not add `Contents: write`.

## Actions configuration

Keep the gate disabled first.

Repository variables:

- `ONEPICK_CLAUDE_REVIEWER_ENABLED=false`
- `ONEPICK_CLAUDE_REVIEWER_CLIENT_ID=<GitHub App client ID>`

Repository Actions secret:

- `ONEPICK_CLAUDE_REVIEWER_PRIVATE_KEY=<GitHub App private key PEM>`

The private key must never be committed, pasted into an issue or PR, or written
to an Actions log.

After the App is installed and the variable/secret are present, change
`ONEPICK_CLAUDE_REVIEWER_ENABLED` to `true` and run **Claude Reviewer Identity
Probe** manually with an ordinary open PR number. Do not use the database
deployment Draft PR #247 for the probe.

## What the probe verifies

`.github/workflows/claude-reviewer-identity-probe.yml`:

1. Creates a short-lived installation token using explicitly requested
   permissions.
2. Because no `owner` or `repositories` override is supplied, the token action
   scopes that token to the current repository.
3. Verifies through `/installation/repositories` that the issued token can see
   exactly one repository and that it is `orrysheaven-netizen/onepick`.
4. Submits a GitHub review with the hard-coded event `COMMENT`.
5. Fails unless the review author is `<app-slug>[bot]` and the state is
   `COMMENTED`.

The probe does not checkout source code and the workflow-level
`GITHUB_TOKEN` has no repository permissions.

The workflow cannot safely introspect every permission configured on the GitHub
App installation itself. The App settings page must therefore also be checked
against the profile above when the App is created. Runtime token permissions are
explicitly narrowed by `actions/create-github-app-token`.

## Promotion criteria

Do not replace the existing Claude Routine until all of the following are
observed on GitHub:

- The App installation page shows only the `onepick` repository.
- The App permission page matches the profile above, with no write/admin
  permission other than Pull requests.
- The probe token sees exactly one repository: `orrysheaven-netizen/onepick`.
- The probe review is authored by `onepick-claude-reviewer[bot]`.
- The review state is `COMMENTED`, never `APPROVED`.
- Contents remains read-only.
- PR #247 remains Draft and no database deployment is triggered.

After those checks, the next change can move the scheduled Claude PR review
execution to this App identity. If GitHub Actions is used for that stage, pin the
Claude Code Action to a reviewed commit and allow only PR view/diff/comment
tools; do not grant file-edit, git-push, workflow-dispatch, approval, or merge
tools.
