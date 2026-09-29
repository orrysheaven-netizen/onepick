"""Build one SYNTHETIC report for a pinned #578 head and print its publisher preview.

Offline rehearsal of worker receipt -> assemble -> outbox -> preview. Uses the fake
CLI fixture (never invokes Claude), never calls GitHub and never posts. The printed
command is for a separately approved operator run; this script does not execute it.
"""
import argparse
import json
from pathlib import Path
import re

from adapter import GateError, Journal, Worker, validate
from assemble_report import assemble
from github_report import TARGET, publish
from report_outbox import Outbox
from test_adapter import FakeCLI, fixture


def build(directory, head, links=()):
    root = Path(directory).resolve()
    # A fresh ledger only: never reuse or reset an existing worker journal/outbox.
    if root.exists() and any(root.iterdir()):
        raise GateError('preview-directory-not-empty')
    if not (isinstance(head, str) and re.fullmatch(r'[a-f0-9]{40}', head)):
        raise GateError('invalid-sha')
    root.mkdir(parents=True, exist_ok=True)
    request, approval = fixture(f'synthetic-report-{TARGET}-{head[:8]}')
    request['base_sha'] = head
    approval.update(base_sha=head, request_sha256=validate(request))
    journal = Journal(root / 'spool')
    cli = FakeCLI(root)
    receipt = Worker(journal, cli, lambda: None).run(request, approval)
    report = assemble(root / 'spool', request, head, 'synthetic', links)
    outbox = Outbox(root / 'outbox')
    event = outbox.stage(report)
    preview = publish(outbox, event, None)
    return {'mode': 'offline-synthetic', 'real_model_calls': 0, 'fake_process_calls': cli.calls,
            'worker_state': receipt['state'], 'event_id': event, 'target': TARGET, 'head': head,
            'outbox': str(outbox.root), 'preview_body': preview['body']}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--directory', required=True, help='New or empty local directory')
    parser.add_argument('--head', required=True, help=f'Current PR #{TARGET} head (40 hex)')
    parser.add_argument('--artifact-link', action='append', default=[])
    args = parser.parse_args()
    try:
        print(json.dumps(build(args.directory, args.head, args.artifact_link), ensure_ascii=False))
    except (GateError, OSError, ValueError) as error:
        print(json.dumps({'state': 'blocked', 'reason': str(error) if isinstance(error, GateError) else 'local-error'}))
        return 1
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
