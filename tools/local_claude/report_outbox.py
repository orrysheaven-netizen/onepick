"""Local report outbox shared by team leads and the Claude result collector.

No live GitHub/queue/chat transport is configured. Ports MUST be supplied by a
reviewed controller after #567; fake ports prove the contract only. This is not
another GitHub source-event queue, and it cannot launch a model.
"""
import argparse
from contextlib import contextmanager
import json
import os
from pathlib import Path
import sqlite3
import time

from adapter import GateError, REPO, SECRET, digest, encode, exact, read_json, require


def report_id(report):
    exact(report, 'version repository task_id source_id head responsible_lead executor artifacts verification remaining summary')
    require(report['version'] == 1 and report['repository'] == REPO, 'invalid-report-repository')
    import re
    for key in ('task_id', 'source_id'):
        require(isinstance(report[key], str) and re.fullmatch(r'[a-z0-9][a-z0-9-]{0,79}', report[key]), 'invalid-report-id')
    require(isinstance(report['head'], str) and re.fullmatch(r'[a-f0-9]{40}', report['head']), 'invalid-report-head')
    for key in ('responsible_lead', 'executor', 'summary'):
        require(isinstance(report[key], str) and 0 < len(report[key]) <= 4000, 'invalid-report-text')
    for key in ('artifacts', 'verification', 'remaining'):
        require(isinstance(report[key], list) and len(report[key]) <= 30 and
                all(isinstance(item, str) and 0 < len(item) <= 2000 for item in report[key]), 'invalid-report-list')
    require(report['artifacts'] and report['verification'], 'report-evidence-required')
    require(not SECRET.search(encode(report).decode()), 'report-secret')
    return digest(encode([REPO, report['task_id'], report['source_id'], report['head']]))


class Outbox:
    def __init__(self, directory):
        self.root = Path(directory).resolve()
        self.root.mkdir(parents=True, exist_ok=True)
        self.db = self.root / 'reports.sqlite3'
        with self.connect() as db:
            db.execute('CREATE TABLE IF NOT EXISTS reports (id TEXT PRIMARY KEY, body TEXT NOT NULL, receipt TEXT NOT NULL)')

    @contextmanager
    def connect(self):
        db = sqlite3.connect(self.db, timeout=10)
        try:
            db.execute('PRAGMA synchronous=FULL')
            with db:
                yield db
        finally:
            db.close()

    @contextmanager
    def lock(self):
        # OS releases this lock on process death; attempt count survives separately.
        with (self.root / 'delivery.lock').open('a+b') as stream:
            if stream.tell() == 0:
                stream.write(b'0')
                stream.flush()
            stream.seek(0)
            try:
                if os.name == 'nt':
                    import msvcrt
                    msvcrt.locking(stream.fileno(), msvcrt.LK_NBLCK, 1)
                else:
                    import fcntl
                    fcntl.flock(stream, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except OSError:
                raise GateError('delivery-busy') from None
            try:
                yield
            finally:
                stream.seek(0)
                if os.name == 'nt':
                    msvcrt.locking(stream.fileno(), msvcrt.LK_UNLCK, 1)
                else:
                    fcntl.flock(stream, fcntl.LOCK_UN)

    def stage(self, report):
        event = report_id(report)
        body = encode(report).decode()
        receipt = {'event_id': event, 'task_id': report['task_id'], 'head': report['head'],
                   'report_sha256': digest(encode(report)), 'state': 'report-stored', 'attempts': 0,
                   'retry_after': 0, 'report_url': None, 'queue_receipt': None,
                   'notification_receipt': None, 'pm_ack': None, 'pm_decision': 'pending',
                   'blocker': 'live-transports-not-configured'}
        with self.connect() as db:
            db.execute('INSERT OR IGNORE INTO reports VALUES(?,?,?)', (event, body, encode(receipt).decode()))
            saved = db.execute('SELECT body FROM reports WHERE id=?', (event,)).fetchone()[0]
            require(saved == body, 'same-event-different-report')
        return event

    def get(self, event):
        with self.connect() as db:
            row = db.execute('SELECT body,receipt FROM reports WHERE id=?', (event,)).fetchone()
        require(row is not None, 'report-not-stored')
        return json.loads(row[0]), json.loads(row[1])

    def save(self, receipt):
        with self.connect() as db:
            db.execute('UPDATE reports SET receipt=? WHERE id=?', (encode(receipt).decode(), receipt['event_id']))

    def deliver(self, event, ports):
        """One bounded transport attempt, invoked by an event/operator, never polling.

        Ports.ensure_* must reconcile remote receipts by event+head+report hash
        before each write, paginate fully, reject stale/closed/blocked/other-active
        tasks, verify trusted receipts, and never accept a local boolean as proof.
        queue_ready() is a trusted deployment capability, not an issue field.
        No production implementation of these ports is shipped in this PR.
        """
        with self.lock():
            report, receipt = self.get(event)
            if receipt['state'] == 'pm-acknowledged':
                return receipt
            require(ports.queue_ready(), 'queue-prerequisite-blocked')
            require(receipt['attempts'] < 3, 'delivery-retry-limit')
            require(time.time() >= receipt['retry_after'], 'delivery-backoff')
            receipt['attempts'] += 1
            receipt['state'] = 'delivery-started'
            receipt['blocker'] = None
            self.save(receipt)  # attempt survives a hard crash before/after any remote write
            try:
                # Report publication must complete before any label/event operation.
                receipt['report_url'] = ports.ensure_report(event, report, receipt['report_sha256'])
                require(isinstance(receipt['report_url'], str) and receipt['report_url'].startswith('https://github.com/'), 'report-link-missing')
                receipt['state'] = 'report-published'
                self.save(receipt)
                ports.ensure_review_label(event, report, receipt['report_url'], 'state:review')
                receipt['state'] = 'review-labelled'
                self.save(receipt)
                # Reuse #567's future finalized contract; no new queue markers are invented here.
                receipt['queue_receipt'] = ports.ensure_queue_event(event, report, receipt['report_url'])
                require(receipt['queue_receipt'], 'queue-receipt-missing')
                receipt['state'] = 'event-received'
                self.save(receipt)
                receipt['notification_receipt'] = ports.ensure_pm_notification(event, report, receipt['report_url'])
                if not receipt['notification_receipt']:
                    receipt.update(state='pm-delivery-blocked', blocker='supported-PM-chat-ingress-missing')
                else:
                    receipt['state'] = 'pm-notified'
                    ack = ports.read_pm_ack(event, report['head'], receipt['report_sha256'])
                    if ack:
                        exact(ack, 'event_id head report_sha256 receipt_ref decision')
                        require(ack['event_id'] == event and ack['head'] == report['head'] and
                                ack['report_sha256'] == receipt['report_sha256'] and ack['receipt_ref'], 'ack-scope-mismatch')
                        require(ack['decision'] in {'received', 'revise', 'user-approval', 'accepted'}, 'invalid-pm-decision')
                        receipt.update(state='pm-acknowledged', pm_ack=ack['receipt_ref'], pm_decision=ack['decision'])
            except Exception:
                receipt.update(state='delivery-failed', blocker='transport-failure-or-invalid-receipt')
            receipt['retry_after'] = time.time() + 30
            self.save(receipt)
            return receipt


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--directory', required=True)
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument('--report', help='Stage immutable JSON report, no network/model calls')
    group.add_argument('--event', help='Read the saved report and delivery receipt')
    args = parser.parse_args()
    try:
        outbox = Outbox(args.directory)
        event = outbox.stage(read_json(args.report)[0]) if args.report else args.event
        report, receipt = outbox.get(event)
        print(json.dumps({'report': report, 'receipt': receipt}, ensure_ascii=False))
    except (GateError, OSError, ValueError, sqlite3.Error) as error:
        print(json.dumps({'state': 'blocked', 'reason': str(error) if isinstance(error, GateError) else 'local-format-or-io-error'}))
        return 1
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
