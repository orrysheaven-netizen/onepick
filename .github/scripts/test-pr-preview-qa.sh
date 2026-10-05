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

# Execute the actual inline workflow, not a copied alias/poll implementation.
# Fake curl and a logical clock keep these tests offline and do not wait 12 min.
python3 - <<'PYTEST'
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile
import textwrap
import unittest

workflow = Path('.github/workflows/pr-preview-qa.yml').read_text(encoding='utf-8')
SHA = 'a' * 40
BRANCH = 'feat/preview-test'


def step_script(name):
    sections = re.findall(
        r'^      - name: ' + re.escape(name) + r'\n(.*?)(?=^      - name:|\Z)',
        workflow, re.M | re.S,
    )
    assert len(sections) == 1, f'Expected one workflow step: {name}'
    return textwrap.dedent(sections[0].split('        run: |\n', 1)[1])


resolve = step_script('Resolve Cloudflare branch preview')
render = step_script('Render PR comment')
FAKE_CURL = r'''
output=''
saw_fail=false
while [ "$#" -gt 0 ]; do
    case "$1" in
        --output) output="$2"; shift 2 ;;
        --max-time) [ "$2" = 5 ] || exit 99; shift 2 ;;
        --write-out) [ "$2" = '%{http_code}' ] || exit 99; shift 2 ;;
        --fail) saw_fail=true; shift ;;
        --silent|--show-error) shift ;;
        https://*) [ "$1" = "$MOCK_URL" ] && [ "$#" = 1 ] || exit 99; shift ;;
        *) exit 99 ;;
    esac
done
[ "$saw_fail" = true ] && [ -n "$output" ] || exit 99
count=0
if [ -f "$MOCK_DIR/calls" ]; then read -r count < "$MOCK_DIR/calls"; fi
printf '%s\n' "$((count + 1))" > "$MOCK_DIR/calls"
index="$count"
if [ "$index" -gt "$MOCK_LAST_INDEX" ]; then index="$MOCK_LAST_INDEX"; fi
cat "$MOCK_DIR/$index.body" > "$output"
read -r status < "$MOCK_DIR/$index.http"
read -r code < "$MOCK_DIR/$index.exit"
printf '%s' "$status"
exit "$code"
'''


def manifest(branch=BRANCH, sha=SHA):
    return {'http': '200', 'body': json.dumps({'commitSha': sha, 'branch': branch})}


class PreviewWorkflowTests(unittest.TestCase):
    def probe(self, responses, branch=BRANCH, alias='feat-preview-test', advance=720):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            binaries = root / 'bin'
            binaries.mkdir()
            curl = binaries / 'curl'
            curl.write_text('#!/usr/bin/env bash\n' + FAKE_CURL)
            curl.chmod(0o755)
            for index, response in enumerate(responses):
                body = (bytes.fromhex(response['hex']) if 'hex' in response
                        else response.get('body', '').encode('utf-8'))
                (root / f'{index}.body').write_bytes(body)
                (root / f'{index}.http').write_text(response.get('http', '200') + '\n')
                (root / f'{index}.exit').write_text(str(response.get('exit', 0)) + '\n')
            env = dict(os.environ, HEAD_BRANCH=branch, EXPECTED_SHA=SHA, LC_ALL='C.UTF-8',
                       PROJECT_SUBDOMAIN='onepick-5cl', RUNNER_TEMP=directory,
                       GITHUB_OUTPUT=str(root / 'output'), MOCK_DIR=directory,
                       MOCK_URL=f'https://{alias}.onepick-5cl.pages.dev/deployment.json',
                       MOCK_SLEEP_ADVANCE=str(advance), MOCK_LAST_INDEX=str(len(responses) - 1),
                       PATH=str(binaries) + os.pathsep + os.environ['PATH'])
            env.pop('BASH_ENV', None)
            # Unsetting SECONDS removes Bash's wall-clock behavior in this test
            # shell only. Each sleep advances the logical clock deterministically.
            clock = ('unset SECONDS; SECONDS=0\n'
                     'sleep() { test "$1" = 10; SECONDS=$((SECONDS + MOCK_SLEEP_ADVANCE)); }\n')
            result = subprocess.run(['bash', '--noprofile', '--norc', '-c', clock + 'curl() {\n' + FAKE_CURL + '\n}\n' + resolve],
                                    cwd=root, env=env, text=True, capture_output=True, timeout=15)
            raw = (root / 'output').read_text() if (root / 'output').exists() else ''
            outputs = dict(line.split('=', 1) for line in raw.splitlines())
            calls = int((root / 'calls').read_text()) if (root / 'calls').exists() else 0
            self.assertFalse((root / 'injected').exists(), 'Branch name executed shell code')
            self.assertEqual(list(root.glob('preview-manifest.*')), [], 'Response file leaked')
            self.assertNotIn('DO_NOT_LOG_RESPONSE', result.stdout + result.stderr + raw)
            return result, outputs, calls

    def test_security_contract_and_bounds(self):
        permissions = re.search(r'^permissions:\n((?:  [^\n]+\n)+)', workflow, re.M).group(1)
        self.assertEqual(permissions, '  contents: read\n  pull-requests: write\n')
        self.assertEqual(len(re.findall(r'^\s*permissions:', workflow, re.M)), 1)
        self.assertIn('!github.event.pull_request.draft', workflow)
        self.assertIn('timeout-minutes: 30', workflow)
        self.assertIn('deadline=$((SECONDS + 720))', resolve)
        self.assertIn('--max-time 5', resolve)
        self.assertNotIn('${{', resolve, 'Untrusted expressions must enter through env')
        self.assertNotIn('export LC_ALL=C\n', resolve, 'Do not change UTF-8 characters into bytes')
        self.assertNotIn('GH_TOKEN', resolve)
        self.assertNotIn('BODY=', resolve)
        self.assertIn('PREVIEW_REASON: ${{ steps.preview.outputs.reason }}', workflow)
        for script in (resolve, render):
            subprocess.run(['bash', '-n'], input=script, text=True, check=True)

    def test_aliases_and_trailing_hyphens(self):
        cases = [
            ('feat/register-link-first', 'feat-register-link-first'),
            ('claude/comment-needs-pick-first', 'claude-comment-needs-pick-fi'),
            ('Feat/API_1.2', 'feat-api-1-2'),
            ('feat/api__1', 'feat-api--1'),
            ('a' * 28, 'a' * 28),
            ('a' * 27 + '-suffix', 'a' * 27),
            ('a' * 25 + '---suffix', 'a' * 25),
        ]
        for branch, alias in cases:
            with self.subTest(branch=branch):
                result, output, calls = self.probe([manifest(branch)], branch, alias)
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertEqual(output['url'], f'https://{alias}.onepick-5cl.pages.dev')
                self.assertEqual((output['ready'], output['reason'], calls), ('true', 'matched', 1))

    def test_preserves_existing_utf8_normalization(self):
        # Preserve the existing UTF-8 runner behavior; a C locale would replace
        # each UTF-8 byte rather than each character and derive another host.
        for branch, alias in [('feat/맛집-test', 'feat----test'), ('Feat/Äpi_1', 'feat--pi-1')]:
            with self.subTest(branch=branch):
                result, output, calls = self.probe([manifest(branch)], branch, alias)
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertEqual((output['ready'], calls), ('true', 1))

    def test_empty_alias_fails_before_network(self):
        for branch in ('', '___', '---'):
            with self.subTest(branch=branch):
                result, output, calls = self.probe([manifest(branch)], branch)
                self.assertNotEqual(result.returncode, 0)
                self.assertEqual((output, calls), ({}, 0))

    def test_branch_is_data_not_shell(self):
        branch = 'feat/$(touch${IFS}injected)'
        alias = 'feat---touch--ifs-injected'
        # The literal expected value catches changes in normalization too.
        result, output, calls = self.probe([manifest(branch)], branch, alias)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual((output['ready'], calls), ('true', 1))

    def test_wrong_commit_and_alias_collision_are_rejected(self):
        cases = [(manifest(sha='b' * 40), BRANCH, 'feat-preview-test', 'commit_mismatch'),
                 (manifest('a' * 28 + '/other'), 'a' * 28 + '/this', 'a' * 28, 'branch_mismatch')]
        for response, branch, alias, reason in cases:
            with self.subTest(reason=reason):
                result, output, calls = self.probe([response], branch, alias)
                self.assertEqual(result.returncode, 0)
                self.assertEqual((output['ready'], output['reason'], calls), ('false', reason, 1))

    def test_missing_branch_remains_compatible(self):
        for body in ({'commitSha': SHA}, {'commitSha': SHA, 'branch': None}):
            with self.subTest(body=body):
                result, output, _ = self.probe([{'body': json.dumps(body)}])
                self.assertEqual((result.returncode, output['ready']), (0, 'true'))

    def test_invalid_json_and_non_objects_do_not_crash_or_leak(self):
        cases = [('DO_NOT_LOG_RESPONSE<html>', 'invalid_json'),
                 ('null', 'invalid_manifest'), ('[]', 'invalid_manifest'),
                 ('"DO_NOT_LOG_RESPONSE"', 'invalid_manifest'), ('42', 'invalid_manifest'),
                 ('{}', 'commit_mismatch')]
        for body, reason in cases:
            with self.subTest(body=body):
                result, output, _ = self.probe([{'body': body}])
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertNotIn('Traceback', result.stderr)
                self.assertEqual((output['ready'], output['reason']), ('false', reason))
        result, output, _ = self.probe([{'hex': 'fffe'}])
        self.assertEqual((result.returncode, output['reason']), (0, 'invalid_json'))

    def test_http_and_transport_errors_are_distinguished(self):
        for status, code, reason in [('404', 22, 'http_404'), ('503', 22, 'http_503'),
                                     ('302', 0, 'http_302'), ('000', 6, 'curl_exit_6'),
                                     ('000', 28, 'curl_exit_28')]:
            with self.subTest(reason=reason):
                result, output, _ = self.probe([dict(manifest(), http=status, exit=code)])
                self.assertEqual(result.returncode, 0)
                self.assertEqual((output['ready'], output['reason']), ('false', reason))

    def test_manifest_retries_until_exact_commit(self):
        result, output, calls = self.probe([manifest(sha='b' * 40), manifest()], advance=10)
        self.assertEqual(result.returncode, 0)
        self.assertEqual((output['ready'], output['reason'], calls), ('true', 'matched', 2))

    def test_12_minute_deadline_without_real_sleep(self):
        result, output, calls = self.probe([{'http': '503', 'exit': 22}], advance=10)
        self.assertEqual(result.returncode, 0)
        self.assertEqual((output['ready'], output['attempts'], calls), ('false', '72', 72))
        self.assertIn('within 12 minutes', result.stdout)

    def test_skip_comment_is_not_a_pass_or_build_failure(self):
        with tempfile.TemporaryDirectory() as directory:
            env = dict(os.environ, EXPECTED_SHA=SHA, PREVIEW_URL='https://preview.example',
                       PREVIEW_READY='false', PREVIEW_REASON='commit_mismatch',
                       RUNNER_TEMP=directory, GITHUB_WORKSPACE=directory)
            env.pop('BASH_ENV', None)
            subprocess.run(['bash', '-c', render], env=env, check=True, capture_output=True)
            comment = (Path(directory) / 'preview-qa-comment.md').read_text()
            self.assertIn('skipped', comment)
            self.assertIn('Last probe: `commit_mismatch`', comment)
            self.assertIn('QA was not executed', comment)
            self.assertIn('Cloudflare build state is unverified', comment)
            self.assertNotIn('✅ pass', comment)


unittest.main(argv=['preview-workflow-tests'], verbosity=2)
PYTEST
