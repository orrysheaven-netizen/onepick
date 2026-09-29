import copy
import tempfile
import unittest
from unittest.mock import patch

from adapter import GateError, REPO
from github_report import ACTOR, PREFIX, TARGET, GitHub, publish
from report_outbox import Outbox


class FakeGitHub:
    def __init__(self):
        self.user = {'login': ACTOR, 'type': 'User'}
        self.pr = {'state': 'open', 'base': {'repo': {'full_name': REPO}},
                   'head': {'sha': 'a' * 40}, 'labels': []}
        self.comments = []
        self.writes = 0
        self.lose_response = False

    def call(self, path, body=None):
        if path == 'user':
            return self.user
        if path == f'{PREFIX}/pulls/{TARGET}':
            return self.pr
        if body is not None:
            assert path == f'{PREFIX}/issues/{TARGET}/comments'
            self.writes += 1
            c = {'id': 123, 'body': body['body'], 'user': dict(self.user),
                 'html_url': f'https://github.com/{REPO}/pull/{TARGET}#issuecomment-123'}
            self.comments.append(c)
            if self.lose_response:
                raise GateError('response-lost')
            return c
        if path.startswith(f'{PREFIX}/issues/comments/'):
            return self.comments[-1]
        page = int(path.split('page=')[-1])
        return self.comments[(page - 1) * 100:page * 100]


class PublishTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.box = Outbox(self.temp.name)
        self.report = dict(version=1, repository=REPO, task_id='fixture', source_id='source',
                           head='a' * 40, responsible_lead='Engineering', executor='fixture',
                           summary='Not actual completion @nobody ```', artifacts=['fixture'],
                           verification=['mock only'], remaining=['not live'])
        self.event = self.box.stage(self.report)
        self.api = FakeGitHub()

    def send(self):
        return publish(self.box, self.event, self.api, True)

    def again(self):
        with patch('github_report.time.time', return_value=10**12):
            return self.send()

    def test_preview_no_network(self):
        r = publish(self.box, self.event, None)
        self.assertEqual(r['state'], 'preview')
        self.assertIn('\\u0040nobody', r['body'])
        self.assertEqual(self.box.get(self.event)[1]['attempts'], 0)

    def test_publish_readback_then_duplicate_reconcile(self):
        self.assertEqual(self.send()['state'], 'report-published')
        self.assertEqual(self.again()['state'], 'report-published')
        self.assertEqual(self.api.writes, 1)
        self.assertIsNone(self.box.get(self.event)[1]['pm_ack'])

    def test_response_loss_restart_reconciles_without_repost(self):
        self.api.lose_response = True
        with self.assertRaises(GateError): self.send()
        self.box = Outbox(self.temp.name)
        self.assertEqual(self.again()['state'], 'report-published')
        self.assertEqual(self.api.writes, 1)

    def test_unknown_or_deleted_comment_never_reposts(self):
        self.send()
        self.api.comments.clear()
        with self.assertRaisesRegex(GateError, 'manual-reconciliation'): self.again()
        self.assertEqual(self.api.writes, 1)

    def test_crash_before_post_intent_is_not_reset(self):
        _, receipt = self.box.get(self.event)
        receipt['github_publication'] = {'post_intent': True}
        self.box.save(receipt)
        with self.assertRaisesRegex(GateError, 'manual-reconciliation'): self.send()
        self.assertEqual(self.api.writes, 0)

    def test_full_pagination_and_untrusted_marker(self):
        body = publish(self.box, self.event, None)['body']
        self.api.comments = [{'body': 'other'}] * 100 + [
            {'body': body, 'user': {'login': 'other', 'type': 'User'}, 'id': 1}]
        with self.assertRaisesRegex(GateError, 'author-mismatch'): self.send()
        self.assertEqual(self.api.writes, 0)

    def test_remote_content_tampering_rejected(self):
        self.send()
        self.api.comments[0]['body'] += 'changed'
        with self.assertRaisesRegex(GateError, 'content-mismatch'): self.again()
        self.assertEqual(self.api.writes, 1)

    def test_duplicate_remote_marker_rejected(self):
        self.send()
        self.api.comments.append(copy.deepcopy(self.api.comments[0]))
        with self.assertRaisesRegex(GateError, 'duplicate-remote'): self.again()

    def test_wrong_identity_no_post(self):
        self.api.user['type'] = 'Bot'
        with self.assertRaisesRegex(GateError, 'identity'): self.send()
        self.assertEqual(self.api.writes, 0)

    def test_stale_head_no_post(self):
        self.api.pr['head']['sha'] = 'b' * 40
        with self.assertRaisesRegex(GateError, 'stale'): self.send()
        self.assertEqual(self.api.writes, 0)

    def test_blocked_no_post(self):
        self.api.pr['labels'] = [{'name': 'state:blocked'}]
        with self.assertRaisesRegex(GateError, 'state-blocked'): self.send()
        self.assertEqual(self.api.writes, 0)

    def test_head_changes_during_scan(self):
        original = self.api.call
        def changed(path, body=None):
            result = original(path, body)
            if '?per_page=' in path:
                self.api.pr['head']['sha'] = 'b' * 40
            return result
        self.api.call = changed
        with self.assertRaisesRegex(GateError, 'changed-before-post'): self.send()
        self.assertEqual(self.api.writes, 0)

    def test_closed_or_wrong_repository_rejected(self):
        self.api.pr['state'] = 'closed'
        with self.assertRaisesRegex(GateError, 'not-open'): self.send()
        self.api.pr['state'] = 'open'
        self.api.pr['base']['repo']['full_name'] = 'other/repo'
        with self.assertRaisesRegex(GateError, 'repository'): self.again()
        self.assertEqual(self.api.writes, 0)

    def test_transport_uses_fixed_host_stdin_and_hides_errors(self):
        import sys
        import subprocess
        client = GitHub(sys.executable)  # injected fixture executable; never run
        with patch('github_report.subprocess.run') as run:
            run.return_value = subprocess.CompletedProcess([], 0, b'{"id":1}', b'')
            self.assertEqual(client.call('fixture', {'body': 'quote $()'}), {'id': 1})
            args, kwargs = run.call_args
            self.assertIn('github.com', args[0])
            self.assertEqual(args[0][-2:], ['--input', '-'])
            self.assertEqual(kwargs['input'], b'{"body":"quote $()"}')
            self.assertFalse(kwargs.get('shell', False))
            run.return_value = subprocess.CompletedProcess([], 1, b'', b'sensitive error')
            with self.assertRaisesRegex(GateError, '^github-request-failed$'):
                client.call('fixture')

    def test_backoff_limit_and_shared_lock(self):
        with self.box.lock():
            with self.assertRaisesRegex(GateError, 'busy'): self.send()
        self.send()
        with self.assertRaisesRegex(GateError, 'backoff'): self.send()
        for now in (10**12, 10**12 + 31):
            with patch('github_report.time.time', return_value=now): self.send()
        with self.assertRaisesRegex(GateError, 'attempt-limit'): self.again()


if __name__ == '__main__':
    unittest.main()
