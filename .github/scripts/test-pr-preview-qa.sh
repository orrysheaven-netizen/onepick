#!/usr/bin/env bash
set -euo pipefail

workflow=".github/workflows/pr-preview-qa.yml"
test -f "$workflow"

grep -Fq "pull_request:" "$workflow"
if grep -Fq "pull_request_target:" "$workflow"; then
  echo "preview QA must not use pull_request_target" >&2
  exit 1
fi
grep -Fq 'github.event.pull_request.head.repo.full_name == github.repository' "$workflow"
grep -Fq 'ref: ${{ github.event.pull_request.base.sha }}' "$workflow"
grep -Fq 'persist-credentials: false' "$workflow"
grep -Fq 'QA_MODE: pr' "$workflow"
grep -Fq 'deployment.json' "$workflow"
grep -Fq 'EXPECTED_SHA' "$workflow"
grep -Fq '<!-- onepick-pr-preview-qa -->' "$workflow"
grep -Fq 'pull-requests: write' "$workflow"
if grep -Eq '\bsecrets\.' "$workflow"; then
  echo "preview QA must not read repository/environment secrets" >&2
  exit 1
fi

echo "PR preview QA workflow contract checks passed."
