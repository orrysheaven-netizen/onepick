"""Operator-only outbox publication to the approved PR #578 receiver boundary.

No queue/labels/model/chat actions. A durable POST intent is never cleared: after
an uncertain outcome we only reconcile, never automatically send another POST.
"""
import argparse
import json
import os
from pathlib import Path
import subprocess
import time

from adapter import GateError, REPO, digest, encode, require
from report_outbox import Outbox, report_id

TARGET = 578
ACTOR = 'orrysheaven-netizen'
PREFIX = f'repos/{REPO}'


class GitHub:
    def __init__(self, executable):
        self.executable = str(Path(executable).resolve(strict=True))

    def call(self, path, body=None):
        # Explicit host and no shell. Existing operator login only; never install,
        # retrieve, persist or print credentials. One CLI invocation, no retry loop.
        env = dict(os.environ, GH_PROMPT_DISABLED='1')
        command = [self.executable, 'api', '--hostname', 'github.com',
                   '--method', 'POST' if body is not None else 'GET', path]
        if body is not None:
            command += ['--input', '-']
        try:
            result = subprocess.run(command, input=encode(body) if body is not None else None,
                                    capture_output=True, timeout=45, env=env, check=False)
        except (OSError, subprocess.TimeoutExpired):
            raise GateError('github-transport-unknown') from None
        require(result.returncode == 0, 'github-request-failed')
        try:
            return json.loads(result.stdout)
        except (ValueError, UnicodeError):
            raise GateError('github-invalid-response') from None


def render(event, report):
    require(report_id(report) == event, 'event-mismatch')
    # JSON escapes markdown fences, mentions and HTML in all untrusted fields.
    data = json.dumps(report, ensure_ascii=False, indent=2)
    for char in ('`', '<', '>', '@'):
        data = data.replace(char, '\\u%04x' % ord(char))
    marker = f'<!-- onepick-report:{event} sha256:{digest(encode(report))} -->'
    # Label from the validated source_id namespace, never from free report text, so a
    # synthetic fixture is visibly a test on the first line the receiver reads.
    synthetic = report['source_id'].startswith('synthetic-')
    headline = ('ONEPICK_REPORT: SYNTHETIC/TEST automated operator publication\n'
                '[SYNTHETIC/TEST] 합성 시험 보고입니다. 실제 Claude 실행·작업 완료·승인이 아닙니다.\n\n'
                if synthetic else 'ONEPICK_REPORT: automated operator publication\n\n')
    body = (marker + '\n' + headline +
            'Authored automatically by the Engineering outbox using the existing '
            'operator account. Not a human-written approval or proof of task completion.\n'
            'Receiver boundary only; no PM-2 forwarding or execution request.\n\n'
            '```json\n' + data + '\n```')
    require(len(body.encode('utf-8')) <= 50000, 'comment-too-large')
    return body


def verify_comment(comment, body):
    require(comment.get('body') == body, 'remote-report-content-mismatch')
    require(comment.get('user', {}).get('login') == ACTOR and
            comment['user'].get('type') == 'User', 'remote-report-author-mismatch')
    cid = comment.get('id')
    require(type(cid) is int and cid > 0, 'invalid-comment-id')
    url = f'https://github.com/{REPO}/pull/{TARGET}#issuecomment-{cid}'
    require(comment.get('html_url') == url, 'invalid-comment-url')
    return url


def publish(outbox, event, api, allow_post=False):
    """One operator invocation; dry-run by default, no daemon or scheduled retries."""
    with outbox.lock():
        report, receipt = outbox.get(event)
        require(receipt['report_sha256'] == digest(encode(report)), 'stored-hash-mismatch')
        body = render(event, report)
        if not allow_post:
            return {'state': 'preview', 'target': TARGET, 'body': body, 'event_id': event}
        # Bind to exactly one target; never trust destination/commands in report data.
        saved = receipt.get('github_publication', {})
        require(saved.get('target', TARGET) == TARGET, 'publication-target-mismatch')
        require(saved.get('attempts', 0) < 3, 'publication-attempt-limit')
        require(time.time() >= saved.get('retry_after', 0), 'publication-backoff')
        saved.update(target=TARGET, attempts=saved.get('attempts', 0) + 1,
                     retry_after=time.time() + 30)
        receipt['github_publication'] = saved
        outbox.save(receipt)
        try:
            user = api.call('user')
            require(user.get('login') == ACTOR and user.get('type') == 'User', 'operator-identity-mismatch')
            pr = api.call(f'{PREFIX}/pulls/{TARGET}')
            require(pr.get('state') == 'open' and not pr.get('merged'), 'target-not-open')
            require(pr.get('base', {}).get('repo', {}).get('full_name') == REPO, 'target-repository-mismatch')
            require(pr.get('head', {}).get('sha') == report['head'], 'stale-report-head')
            require(not {'state:blocked', 'state:active'}.intersection(
                item['name'] for item in pr.get('labels', [])), 'target-state-blocked')
            matches = []
            needle = f'<!-- onepick-report:{event} '
            for page in range(1, 102):
                comments = api.call(f'{PREFIX}/issues/{TARGET}/comments?per_page=100&page={page}')
                require(isinstance(comments, list), 'invalid-comments-page')
                matches += [c for c in comments if needle in c.get('body', '')]
                if len(comments) < 100:
                    break
            else:
                raise GateError('comment-scan-limit')  # incomplete scan cannot authorize POST
            require(len(matches) <= 1, 'duplicate-remote-reports')
            if matches:
                comment = matches[0]
            else:
                require(not saved.get('post_intent') and not receipt.get('report_url'),
                        'publication-unknown-manual-reconciliation-required')
                # Recheck after pagination; GitHub has no atomic head-bound comment
                # POST, so a subsequent remote head race remains a documented limit.
                current = api.call(f'{PREFIX}/pulls/{TARGET}')
                require(current.get('head', {}).get('sha') == report['head'] and
                        current.get('state') == 'open' and not current.get('merged') and
                        not {'state:blocked', 'state:active'}.intersection(
                            item['name'] for item in current.get('labels', [])),
                        'target-changed-before-post')
                saved['post_intent'] = True
                saved['state'] = 'post-intent'
                outbox.save(receipt)  # durable before crossing the write boundary
                created = api.call(f'{PREFIX}/issues/{TARGET}/comments', {'body': body})
                verify_comment(created, body)
                comment = api.call(f'{PREFIX}/issues/comments/{created["id"]}')
            url = verify_comment(comment, body)
            receipt.update(report_url=url, state='report-published',
                           blocker='receiver-ack-transport-not-configured')
            saved.update(state='verified', author=ACTOR, comment_id=comment['id'], url=url)
        except (GateError, KeyError, TypeError, ValueError):
            saved['state'] = 'reconciliation-required' if saved.get('post_intent') else 'blocked'
            # Do not leak remote output or promote to queue/PM acknowledgement.
            receipt['blocker'] = 'github-publication-needs-operator-review'
            outbox.save(receipt)
            raise
        outbox.save(receipt)
        return receipt


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--directory', required=True)
    parser.add_argument('--event', required=True)
    parser.add_argument('--publish', action='store_true', help='Explicitly permit one POST after checks')
    parser.add_argument('--gh', default='C:/Program Files/GitHub CLI/gh.exe')
    args = parser.parse_args()
    try:
        result = publish(Outbox(args.directory), args.event,
                         GitHub(args.gh) if args.publish else None, args.publish)
        print(json.dumps(result, ensure_ascii=False))
    except (GateError, OSError, ValueError, KeyError, TypeError) as error:
        print(json.dumps({'state': 'blocked', 'reason': str(error) if isinstance(error, GateError) else 'local-or-response-error'}))
        return 1
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
