"""Offline test fixture; never imports an SDK or opens a network connection."""
import json
import sys
import time

mode = sys.argv[1]
request = sys.stdin.buffer.read()
if mode == 'timeout':
    time.sleep(30)
elif mode == 'overflow':
    sys.stdout.write('x' * 2_000_000)
    sys.stdout.flush()
    # Keep the producer alive so the output-limit test actually verifies tree
    # termination, rather than racing a normal exit against taskkill.
    time.sleep(30)
elif mode == 'malformed':
    print('not JSON')
elif mode in {'auth', 'limit', 'failure'}:
    print(json.dumps({'type': 'result', 'is_error': True,
                      'result': {'auth': 'authentication required', 'limit': 'usage limit', 'failure': 'failed'}[mode]}))
    sys.exit(1)
else:
    model = 'unexpected' if mode == 'wrong-model' else 'claude-sonnet-5-5'
    print(json.dumps({'type': 'result', 'is_error': False, 'num_turns': 1,
                      'modelUsage': {model: {}}, 'result': 'Offline fixture review. No source transmitted.'}))
