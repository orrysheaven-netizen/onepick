import copy
import json
import os
from pathlib import Path
import sys
import tempfile
import threading
import time
import unittest
from unittest.mock import patch

from adapter import (ClaudeCLI, GateError, Journal, MODEL, Worker, authorize, clean_env,
                     digest, encode, export_report, invoke, terminate_tree, validate)

AUTH = {'loggedIn': True, 'authMethod': 'claude.ai', 'apiProvider': 'firstParty', 'subscriptionType': 'max'}


def fixture(task='fixture-571'):
    request = {'version': 1, 'task_id': task, 'repository': 'orrysheaven-netizen/onepick',
               'base_sha': 'a' * 40, 'responsible_lead': 'Engineering', 'executor': 'claude-local-oauth',
               'instruction': 'Review this synthetic fixture only.', 'scope': 'static-review-no-tools',
               'materials': [{'name': 'fixture.txt', 'text': 'synthetic', 'sha256': digest(b'synthetic')}]}
    approval = {'id': 'offline-' + task, 'task_id': task, 'request_sha256': validate(request),
                'repository': request['repository'], 'base_sha': request['base_sha'],
                'destination': 'Anthropic via official Claude CLI', 'scope': request['scope'],
                'model': MODEL, 'max_calls': 1, 'expires_at': time.time() + 60, 'revoked': False,
                'user_approval_ref': 'OFFLINE FIXTURE ONLY', 'billing_ref': 'OFFLINE FIXTURE ONLY',
                'extra_usage_off': True, 'auto_reload_off': True}
    return request, approval


class FakeCLI:
    def __init__(self, root, mode='success', auth=None, timeout=2):
        self.root, self.mode, self.timeout = root, mode, timeout
        self.auth_value = AUTH if auth is None else auth
        self.calls = 0

    def auth(self):
        return self.auth_value

    def review(self, prompt, cancelled):
        self.calls += 1
        return invoke([sys.executable, str(Path(__file__).with_name('fake_cli.py')), self.mode],
                      prompt, self.root, dict(os.environ), self.timeout, cancelled)


class AdapterTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.journal = Journal(self.root)
        self.request, self.approval = fixture()

    def tearDown(self):
        self.temp.cleanup()

    def run_worker(self, mode='success', **kwargs):
        transport = FakeCLI(self.root, mode, **kwargs)
        receipt = Worker(self.journal, transport, lambda: None).run(self.request, self.approval)
        return receipt, transport

    def test_success_is_pm_review_and_result_recoverable_without_model(self):
        receipt, cli = self.run_worker()
        self.assertEqual(receipt['state'], 'pm-review')
        self.assertEqual(cli.calls, 1)
        self.assertEqual(receipt, Journal(self.root).get(self.request['task_id']))
        output = Path(receipt['output']).read_bytes()
        self.assertEqual(digest(output), receipt['output_sha256'])
        self.assertIn(b'Offline fixture', output)
        self.assertEqual(receipt['delivery'], 'local-only')

    def test_duplicate_after_success_never_relaunches(self):
        self.run_worker()
        cli = FakeCLI(self.root)
        with self.assertRaisesRegex(GateError, 'duplicate'):
            Worker(Journal(self.root), cli, lambda: None).run(self.request, self.approval)
        self.assertEqual(cli.calls, 0)

    def test_export_is_idempotent_pm_readable_and_detects_tampering(self):
        receipt, cli = self.run_worker()
        outbox = self.root / 'outbox'
        outbox.mkdir()
        report = export_report(self.journal, self.request['task_id'], outbox)
        self.assertEqual(report, export_report(self.journal, self.request['task_id'], outbox))
        data = json.loads(Path(report).read_text(encoding='utf-8'))
        self.assertEqual(data['state'], 'pm-review')
        self.assertTrue(Path(data['output']).is_file())
        self.assertEqual(cli.calls, 1)
        Path(receipt['output']).write_text('tampered', encoding='utf-8')
        with self.assertRaisesRegex(GateError, 'output-changed'):
            export_report(self.journal, self.request['task_id'], outbox)

    def test_missing_journal_does_not_silently_reset_budget(self):
        with self.assertRaisesRegex(GateError, 'journal-missing'):
            Journal(self.root / 'missing', create=False)

    def test_uncertain_termination_keeps_worker_blocked(self):
        cli = FakeCLI(self.root)
        with patch.object(cli, 'review', return_value={'code': None, 'stop': 'unknown-outcome', 'stdout': b'', 'stderr': b''}):
            receipt = Worker(self.journal, cli, lambda: None).run(self.request, self.approval)
        self.assertEqual(receipt['state'], 'unknown-outcome')
        request, approval = fixture('next')
        with self.assertRaisesRegex(GateError, 'worker-busy'):
            Worker(self.journal, cli, lambda: None).run(request, approval)

    def test_approval_cannot_be_reused_for_another_task(self):
        self.run_worker()
        request, approval = fixture('another')
        approval['id'] = self.approval['id']
        cli = FakeCLI(self.root)
        with self.assertRaisesRegex(GateError, 'duplicate'):
            Worker(self.journal, cli, lambda: None).run(request, approval)
        self.assertEqual(cli.calls, 0)

    def test_claim_race_only_one_winner_and_crash_stays_occupied(self):
        winners = []
        def claim():
            try:
                self.journal.claim(self.request, self.approval, validate(self.request))
                winners.append(True)
            except GateError:
                pass
        threads = [threading.Thread(target=claim) for _ in range(6)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()
        self.assertEqual(winners, [True])
        request, approval = fixture('other-task')
        with self.assertRaisesRegex(GateError, 'worker-busy'):
            Journal(self.root).claim(request, approval, validate(request))

    def test_auth_failure_does_not_call_model(self):
        receipt, cli = self.run_worker(auth={**AUTH, 'loggedIn': False})
        self.assertEqual(receipt['state'], 'auth-blocked')
        self.assertFalse(receipt['model_started'])
        self.assertEqual(cli.calls, 0)

    def test_cli_failures_and_malformed_result_stop_without_retry(self):
        for mode, state in [('auth', 'auth-blocked'), ('limit', 'limit-blocked'),
                            ('failure', 'failed'), ('malformed', 'failed'), ('wrong-model', 'failed')]:
            with self.subTest(mode=mode):
                self.request, self.approval = fixture(mode)
                receipt, cli = self.run_worker(mode)
                self.assertEqual(receipt['state'], state)
                self.assertEqual(cli.calls, 1)
                with self.assertRaises(GateError):
                    Worker(self.journal, cli, lambda: None).run(self.request, self.approval)
                self.assertEqual(cli.calls, 1)

    def test_timeout_and_output_limit_kill_and_stop(self):
        for mode, state in [('timeout', 'timed-out'), ('overflow', 'failed')]:
            self.request, self.approval = fixture(mode)
            receipt, cli = self.run_worker(mode, timeout=0.15 if mode == 'timeout' else 2)
            self.assertEqual(receipt['state'], state)
            self.assertEqual(receipt['reason'], 'timed-out' if mode == 'timeout' else 'output-limit')
            self.assertIsNotNone(receipt['exit_code'])
            self.assertEqual(cli.calls, 1)

    @unittest.skipUnless(os.name == 'nt', 'Windows taskkill race')
    def test_parent_exit_race_does_not_claim_tree_termination(self):
        from unittest.mock import Mock
        child = Mock(pid=123456)
        child.wait.return_value = 0  # parent exited, descendants are still unknown
        with patch('adapter.subprocess.run', return_value=Mock(returncode=1)):
            self.assertFalse(terminate_tree(child))

    def test_cancellation_stops_live_fake_process(self):
        timer = threading.Timer(0.2, lambda: self.journal.cancel(self.request['task_id']))
        timer.start()
        try:
            receipt, cli = self.run_worker('timeout')
        finally:
            timer.join()
        self.assertEqual(receipt['state'], 'cancelled')
        self.assertIsNotNone(receipt['exit_code'])
        self.assertEqual(cli.calls, 1)

    def test_revocation_during_process_stops_without_retry(self):
        start = time.monotonic()
        cli = FakeCLI(self.root, 'timeout')
        receipt = Worker(self.journal, cli, lambda: None,
                         lambda: time.monotonic() - start > 0.15).run(self.request, self.approval)
        self.assertEqual(receipt['state'], 'cancelled')
        self.assertEqual(cli.calls, 1)

    def test_pre_spawn_revocation_never_calls_model(self):
        calls = []
        def guard():
            calls.append(1)
            if len(calls) == 2:
                raise GateError('approval-revoked')
        cli = FakeCLI(self.root)
        receipt = Worker(self.journal, cli, guard).run(self.request, self.approval)
        self.assertEqual(receipt['state'], 'failed')
        self.assertEqual(cli.calls, 0)

    def test_crash_after_attempt_reservation_never_retries(self):
        cli = FakeCLI(self.root)
        with patch.object(cli, 'review', side_effect=OSError('private error')):
            with self.assertRaises(OSError):
                Worker(self.journal, cli, lambda: None).run(self.request, self.approval)
        receipt = self.journal.get(self.request['task_id'])
        self.assertEqual(receipt['state'], 'unknown-outcome')
        self.assertNotIn('private error', str(receipt))
        with self.assertRaises(GateError):
            Worker(self.journal, cli, lambda: None).run(self.request, self.approval)

    def test_scope_hash_secret_and_path_fail_closed(self):
        mutations = [lambda r: r.update(scope='implement'),
                     lambda r: r.update(base_sha='HEAD'),
                     lambda r: r.update(task_id='../escape'),
                     lambda r: r.update(executable='arbitrary'),
                     lambda r: r['materials'][0].update(text='changed'),
                     lambda r: r['materials'][0].update(name='.env'),
                     lambda r: r.update(instruction='sk-ant-testSecretValue')]
        for change in mutations:
            request = copy.deepcopy(self.request)
            change(request)
            with self.assertRaises(GateError):
                validate(request)
        for field, value in [('request_sha256', '0' * 64), ('max_calls', 2), ('expires_at', 0),
                             ('revoked', True), ('auto_reload_off', False), ('destination', 'another')]:
            approval = {**self.approval, field: value}
            with self.assertRaises(GateError):
                authorize(self.request, approval, validate(self.request))

    def test_live_args_no_shell_tools_or_fallback_and_filtered_environment(self):
        with patch.dict(os.environ, {'SYSTEMROOT': 'C:/Windows'}, clear=True):
            transport = ClaudeCLI({'cli_path': 'C:/approved/claude.exe', 'timeout_seconds': 30}, self.root)
            with patch.object(transport, 'command', return_value={}) as command:
                transport.review(b'payload', lambda: False)
                argv = command.call_args.args[0]
                self.assertIn('--safe-mode', argv)
                self.assertEqual(argv[argv.index('--tools') + 1], '')
                self.assertEqual(argv[argv.index('--max-turns') + 1], '1')
                self.assertNotIn('--fallback-model', argv)
        for key in ['ANTHROPIC_API_KEY', 'CLAUDE_CODE_OAUTH_TOKEN', 'GH_TOKEN', 'NODE_OPTIONS', 'HTTPS_PROXY']:
            with patch.dict(os.environ, {key: 'do-not-print'}, clear=True):
                with self.assertRaisesRegex(GateError, 'conflicting-environment'):
                    clean_env()


if __name__ == '__main__':
    unittest.main()
