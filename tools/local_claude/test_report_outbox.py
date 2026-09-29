import copy
import tempfile
import unittest
from unittest.mock import patch
from adapter import GateError
from report_outbox import Outbox


class FakePorts:
    """Fake remote store with response-loss injection, NOT a PM delivery receipt."""
    def __init__(self):
        self.remote = {}
        self.calls = []
        self.fail_once = None
        self.chat = True
        self.ack = True
        self.ready = True
        self.stale_ack = False

    def queue_ready(self):
        return self.ready

    def ensure(self, kind, event):
        self.calls.append(kind)
        self.remote.setdefault((kind, event), kind + '-fixture-receipt')
        if self.fail_once == kind:
            self.fail_once = None
            raise OSError('Response lost after write')
        return self.remote[(kind, event)]

    def ensure_report(self, event, report, digest):
        self.ensure('report', event)
        return 'https://github.com/fixture/report/' + event

    def ensure_review_label(self, event, report, url, label):
        assert ('report', event) in self.remote and url
        assert label == 'state:review'
        self.ensure('label', event)

    def ensure_queue_event(self, event, report, url):
        assert ('label', event) in self.remote
        return self.ensure('queue', event)

    def ensure_pm_notification(self, event, report, url):
        assert ('queue', event) in self.remote
        return self.ensure('notify', event) if self.chat else None

    def read_pm_ack(self, event, head, digest):
        return {'event_id': event, 'head': '0' * 40 if self.stale_ack else head,
                'report_sha256': digest, 'receipt_ref': 'FAKE-PM-ACK', 'decision': 'received'} if self.ack else None


class ReportTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.outbox = Outbox(self.temp.name)
        self.report = {'version': 1, 'repository': 'orrysheaven-netizen/onepick', 'task_id': 'task-571',
                       'source_id': 'attempt-1', 'head': 'a' * 40, 'responsible_lead': 'Engineering',
                       'executor': 'claude-local-oauth', 'summary': 'Fixture only',
                       'artifacts': ['local fixture receipt'], 'verification': ['fake CLI passed'],
                       'remaining': ['Not a real model call or real PM notification']}
        self.event = self.outbox.stage(self.report)
        self.ports = FakePorts()

    def tearDown(self):
        self.temp.cleanup()

    def retry(self):
        with patch('report_outbox.time.time', return_value=10**12):
            return self.outbox.deliver(self.event, self.ports)

    def test_report_label_event_notification_ack_order(self):
        result = self.outbox.deliver(self.event, self.ports)
        self.assertEqual(self.ports.calls, ['report', 'label', 'queue', 'notify'])
        self.assertEqual(result['state'], 'pm-acknowledged')
        self.assertEqual(result['pm_decision'], 'received')
        self.assertNotEqual(result['state'], 'complete')

    def test_duplicate_and_missing_report(self):
        self.assertEqual(self.event, self.outbox.stage(self.report))
        self.outbox.deliver(self.event, self.ports)
        self.outbox.deliver(self.event, self.ports)
        self.assertEqual(len(self.ports.calls), 4)
        with self.assertRaisesRegex(GateError, 'report-not-stored'):
            self.outbox.deliver('missing', self.ports)
        changed = copy.deepcopy(self.report)
        changed['summary'] = 'changed'
        with self.assertRaisesRegex(GateError, 'different-report'):
            self.outbox.stage(changed)

    def test_response_loss_reconciles_before_retry_without_duplicate_remote_writes(self):
        for step in ['report', 'label', 'queue', 'notify']:
            with self.subTest(step=step):
                self.ports = FakePorts()
                self.ports.fail_once = step
                report = {**self.report, 'source_id': step}
                self.event = self.outbox.stage(report)
                first = self.outbox.deliver(self.event, self.ports)
                self.assertEqual(first['state'], 'delivery-failed')
                if step == 'report':
                    self.assertEqual(self.ports.calls, ['report'])
                self.outbox = Outbox(self.temp.name)  # process restart
                result = self.retry()
                self.assertEqual(result['state'], 'pm-acknowledged')
                self.assertEqual(len(self.ports.remote), 4)

    def test_absent_bridge_never_claims_notification_or_acceptance(self):
        self.ports.chat = False
        result = self.outbox.deliver(self.event, self.ports)
        self.assertEqual(result['state'], 'pm-delivery-blocked')
        self.assertIsNone(result['notification_receipt'])
        self.assertIsNone(result['pm_ack'])

    def test_retry_cap_backoff_and_queue_gate(self):
        self.ports.ready = False
        with self.assertRaisesRegex(GateError, 'prerequisite'):
            self.outbox.deliver(self.event, self.ports)
        self.assertEqual(self.ports.calls, [])
        self.ports.ready = True
        self.ports.chat = False
        self.outbox.deliver(self.event, self.ports)
        with self.assertRaisesRegex(GateError, 'backoff'):
            self.outbox.deliver(self.event, self.ports)
        for now in [10**12, 10**12 + 31]:
            with patch('report_outbox.time.time', return_value=now):
                self.outbox.deliver(self.event, self.ports)
        with self.assertRaisesRegex(GateError, 'retry-limit'):
            self.retry()

    def test_notification_is_not_ack_and_stale_ack_rejected(self):
        self.ports.ack = False
        result = self.outbox.deliver(self.event, self.ports)
        self.assertEqual(result['state'], 'pm-notified')
        self.assertIsNone(result['pm_ack'])
        self.ports.ack = True
        self.ports.stale_ack = True
        self.assertEqual(self.retry()['state'], 'delivery-failed')


if __name__ == '__main__':
    unittest.main()
