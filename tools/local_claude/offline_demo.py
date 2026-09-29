"""Persist one synthetic fake-CLI receipt for PM inspection. Never invokes Claude."""
import argparse
import json
from pathlib import Path
from adapter import Journal, Worker, export_report
from test_adapter import FakeCLI, fixture

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--directory', required=True)
args = parser.parse_args()
root = Path(args.directory).resolve()
root.mkdir(parents=True, exist_ok=True)
request, approval = fixture('offline-demo-571')
journal = Journal(root / 'spool')
cli = FakeCLI(root)
receipt = Worker(journal, cli, lambda: None).run(request, approval)
report = export_report(journal, request['task_id'], root)
print(json.dumps({'mode': 'offline-fake-cli', 'real_model_calls': 0,
                  'fake_process_calls': cli.calls, 'state': receipt['state'], 'report': report}))
