"""Read a worker journal/result; stage an immutable report without network/model calls.

Hash consistency is not proof of authorship. Trusted worker/controller ACLs are a
deployment prerequisite. Model prose is never copied into the public report.
"""
import argparse
from contextlib import closing
import json
from pathlib import Path
import re
import sqlite3

from adapter import LIMIT, MODEL, GateError, digest, encode, read_json, require, validate
from report_outbox import Outbox, report_id

# Deliverable links: this repository's PR/issue pages or one of their comments only.
LINK = re.compile(r'https://github\.com/orrysheaven-netizen/onepick/(?:pull|issues)/[0-9]{1,7}'
                  r'(?:#issuecomment-[0-9]{1,12})?')
MAX_LINKS = 5

STATES = {'pm-review', 'failed', 'cancelled', 'timed-out', 'auth-blocked',
          'limit-blocked', 'unknown-outcome'}


def assemble(spool, request, expected_head, kind, links=()):
    require(kind in {'synthetic', 'worker-record'}, 'invalid-record-kind')
    links = list(links)
    require(len(links) <= MAX_LINKS and len(set(links)) == len(links) and
            all(isinstance(link, str) and LINK.fullmatch(link) for link in links), 'invalid-artifact-link')
    request_hash = validate(request)
    require(request['base_sha'] == expected_head, 'unexpected-source-head')
    root = Path(spool).resolve(strict=True)
    journal = root / 'journal.sqlite3'
    require(journal.is_file() and not journal.is_symlink(), 'journal-missing-or-unsafe')
    # Read-only SQLite: missing files cannot initialize/reset a real worker ledger.
    with closing(sqlite3.connect(journal.as_uri() + '?mode=ro', uri=True)) as db:
        row = db.execute('SELECT request_hash,receipt,state,approval FROM jobs WHERE task=?',
                         (request['task_id'],)).fetchone()
    require(row is not None and row[0] == request_hash, 'journal-request-mismatch')
    require(len(row[1].encode('utf-8')) <= LIMIT, 'receipt-too-large')
    receipt = json.loads(row[1])
    require(receipt.get('state') == row[2] and receipt.get('approval_id') == row[3],
            'journal-receipt-mismatch')
    for field in ('task_id', 'repository', 'base_sha', 'responsible_lead', 'executor'):
        require(receipt.get(field) == request[field], 'receipt-scope-mismatch')
    require(receipt.get('version') == 1 and receipt.get('request_sha256') == request_hash,
            'receipt-request-mismatch')
    require(receipt.get('model_calls_reserved') == 1 and
            receipt.get('retry_allowed') is False and
            receipt.get('pm_decision') == 'pending', 'unsupported-worker-receipt')
    state = receipt.get('state')
    require(state in STATES, 'worker-not-reportable')
    reason = receipt.get('reason')
    require(isinstance(reason, str) and re.fullmatch(r'[a-z0-9-]{1,100}', reason),
            'invalid-receipt-reason')
    require(type(receipt.get('model_started')) is bool, 'invalid-start-state')
    task = request['task_id']
    receipt_hash = digest(encode(receipt))
    artifacts = [f'worker-receipt:{task}; sha256:{receipt_hash}',
                 f'source-head:{expected_head}; request-sha256:{request_hash}']
    checks = ['Request schema and materials hashes validated; journal and receipt scope matched.',
              'Pinned source head only; no new code commit or current remote head inferred.',
              'Task tests/CI NOT RUN by this static worker; model claims are not test evidence.']
    if state == 'pm-review':
        require(receipt.get('model_started') is True and receipt.get('exit_code') == 0 and
                receipt.get('actual_model') == MODEL and
                receipt.get('independent_review') == 'pending', 'invalid-collected-receipt')
        output = root / (task + '.result.txt')
        require(isinstance(receipt.get('output'), str) and not output.is_symlink() and
                Path(receipt['output']).resolve() == output.resolve() and
                output.resolve().parent == root, 'unsafe-result-path')
        with output.open('rb') as stream:
            data = stream.read(LIMIT + 1)
        require(0 < len(data) <= LIMIT and digest(data) == receipt.get('output_sha256'),
                'result-hash-mismatch')
        artifacts.append(f'worker-result:{task}.result.txt; sha256:{digest(data)}')
        checks.append('Result bytes/hash verified; CLI collection is not independent review or acceptance.')
    else:
        require(receipt.get('output') is None and 'output_sha256' not in receipt,
                'unexpected-failure-output')
        checks.append(f'Worker stopped with state={state}; reason={reason}; no successful result inferred.')
    # Links are operator-supplied references, not evidence that the linked work passed.
    artifacts += [f'link:{link}' for link in links]
    label = 'SYNTHETIC' if kind == 'synthetic' else 'WORKER RECORD (local integrity checked)'
    report = dict(version=1, repository=request['repository'], task_id=task,
                  source_id=('synthetic-' if kind == 'synthetic' else 'worker-') + request_hash,
                  head=expected_head, responsible_lead=request['responsible_lead'],
                  executor=request['executor'], artifacts=artifacts, verification=checks,
                  summary=f'{label}: state={state}, reason={reason}. Not task completion or user approval.',
                  remaining=['Model prose remains local/untrusted and is not transmitted in this report.',
                             'Independent review, task acceptance and CI remain unverified.',
                             'Local hashes do not authenticate author; trusted worker/controller ACLs required.',
                             'No GitHub publication, queue action, model call or PM acknowledgement performed.'])
    if kind == 'synthetic':
        report['remaining'].insert(0, 'SYNTHETIC fixture only; not evidence of a real Claude run or completed work.')
    report_id(report)
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--spool', required=True)
    parser.add_argument('--request', required=True)
    parser.add_argument('--expected-head', required=True)
    parser.add_argument('--kind', choices=['synthetic', 'worker-record'], required=True)
    parser.add_argument('--outbox', required=True)
    parser.add_argument('--artifact-link', action='append', default=[],
                        help=f'PR/issue(/comment) URL in this repository; up to {MAX_LINKS}')
    args = parser.parse_args()
    try:
        report = assemble(args.spool, read_json(args.request)[0], args.expected_head, args.kind,
                          args.artifact_link)
        outbox = Outbox(args.outbox)
        event = outbox.stage(report)
        print(json.dumps({'event_id': event, 'report': report, 'state': 'report-stored'}, ensure_ascii=False))
    except (GateError, OSError, ValueError, TypeError, KeyError, sqlite3.Error) as error:
        print(json.dumps({'state': 'blocked', 'reason': str(error) if isinstance(error, GateError) else 'local-record-error'}))
        return 1
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
