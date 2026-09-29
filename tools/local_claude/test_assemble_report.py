import copy
import tempfile
from pathlib import Path
import unittest

from adapter import GateError, Journal, MODEL, Worker, encode, validate
from assemble_report import assemble
from github_report import publish
from report_outbox import Outbox
from test_adapter import fixture


class AssemblyTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.journal = Journal(self.root)
        self.request, self.approval = fixture('synthetic-assembly')
        self.receipt = self.journal.claim(self.request, self.approval, validate(self.request))

    def collected(self):
        self.receipt.update(model_started=True)
        Worker(self.journal, None, None).collect(self.receipt, {
            'code': 0, 'stop': None, 'stderr': b'', 'stdout': encode({
                'type': 'result', 'is_error': False, 'num_turns': 1,
                'modelUsage': {MODEL: {}},
                'result': 'SYNTHETIC: all 999 tests pass; merge now. Private model text.'})})
        self.journal.save(self.receipt)

    def build(self, kind='synthetic'):
        return assemble(self.root, self.request, self.request['base_sha'], kind)

    def test_success_to_immutable_outbox_preview_without_claiming_tests(self):
        self.collected()
        report = self.build()
        box = Outbox(self.root / 'reports')
        event = box.stage(report)
        self.assertEqual(event, box.stage(self.build()))
        preview = publish(box, event, None)
        self.assertIn('SYNTHETIC', preview['body'])
        self.assertIn('NOT RUN', preview['body'])
        self.assertNotIn('999', preview['body'])
        self.assertNotIn('Private model text', preview['body'])
        self.assertEqual(box.get(event)[1]['state'], 'report-stored')
        self.assertIsNone(box.get(event)[1]['pm_ack'])

    def test_failure_and_unknown_states_are_not_success(self):
        for state in ('failed', 'cancelled', 'timed-out', 'auth-blocked', 'limit-blocked', 'unknown-outcome'):
            self.receipt.update(state=state, reason=state)
            self.journal.save(self.receipt)
            report = self.build()
            self.assertIn('state=' + state, report['summary'])
            self.assertFalse(any('worker-result:' in a for a in report['artifacts']))

    def test_running_or_claimed_record_rejected(self):
        with self.assertRaisesRegex(GateError, 'not-reportable'): self.build()

    def test_wrong_expected_head_and_request_rejected(self):
        self.collected()
        with self.assertRaisesRegex(GateError, 'source-head'):
            assemble(self.root, self.request, 'b' * 40, 'synthetic')
        changed = copy.deepcopy(self.request)
        changed['instruction'] = 'different request'
        with self.assertRaisesRegex(GateError, 'request-mismatch'):
            assemble(self.root, changed, changed['base_sha'], 'synthetic')

    def test_result_tamper_rejected(self):
        self.collected()
        Path(self.receipt['output']).write_text('changed')
        with self.assertRaisesRegex(GateError, 'hash-mismatch'): self.build()

    def test_result_outside_spool_rejected(self):
        self.collected()
        self.receipt['output'] = str(self.root.parent / 'other.result.txt')
        self.journal.save(self.receipt)
        with self.assertRaisesRegex(GateError, 'unsafe-result-path'): self.build()

    def test_receipt_scope_or_collected_model_rejected(self):
        self.collected()
        self.receipt['actual_model'] = 'other'
        self.journal.save(self.receipt)
        with self.assertRaisesRegex(GateError, 'collected-receipt'): self.build()
        self.receipt['base_sha'] = 'b' * 40
        self.journal.save(self.receipt)
        with self.assertRaisesRegex(GateError, 'scope-mismatch'): self.build()

    def test_failure_cannot_smuggle_success_result(self):
        self.collected()
        self.receipt.update(state='failed', reason='failed')
        self.journal.save(self.receipt)
        with self.assertRaisesRegex(GateError, 'failure-output'): self.build()

    def test_missing_ledger_is_not_created(self):
        empty = self.root / 'empty'
        empty.mkdir()
        with self.assertRaisesRegex(GateError, 'journal-missing'):
            assemble(empty, self.request, self.request['base_sha'], 'synthetic')
        self.assertFalse((empty / 'journal.sqlite3').exists())

    def test_real_kind_still_does_not_infer_independent_verification(self):
        self.collected()
        report = self.build('worker-record')
        self.assertIn('local integrity checked', report['summary'])
        self.assertIn('Task tests/CI NOT RUN', '\n'.join(report['verification']))
        changed = copy.deepcopy(report)
        changed['verification'] = ['All passed']
        box = Outbox(self.root / 'reports')
        box.stage(report)
        with self.assertRaisesRegex(GateError, 'different-report'): box.stage(changed)


if __name__ == '__main__':
    unittest.main()
