import { logProfileAiServerPerformance, profileAiServerPerformanceEvent } from './performance.ts';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

Deno.test('server performance event contains only bounded non-content fields', () => {
  const event = profileAiServerPerformanceEvent({
    outcome: 'generated', tone: 'direct', authMs: 12.4, preflightMs: 33.6,
    providerMs: 20_001.8, saveMs: 41.2, totalMs: 20_090.5,
  });
  assert(Object.keys(event).sort().join(',') ===
    'authMs,event,outcome,preflightMs,providerMs,saveMs,tone,totalMs', 'Unexpected fields');
  assert(event.authMs === 12 && event.preflightMs === 34 && event.providerMs === 20002 &&
    event.saveMs === 41 && event.totalMs === 20091, 'Unexpected duration normalization');
});

Deno.test('server performance logger cannot serialize user content or arbitrary metadata', () => {
  let line = '';
  const secret = 'PRIVATE_REVIEW_TEXT_MUST_NOT_APPEAR';
  logProfileAiServerPerformance({
    outcome: 'failed', tone: null, authMs: -1, preflightMs: Number.NaN,
    providerMs: null, saveMs: null, totalMs: 999999,
    // @ts-expect-error deliberate adversarial extra data
    userId: secret, review: secret,
  }, (message) => { line = message; });
  assert(line.startsWith('AI_PROFILE_PERF '), 'Missing prefix');
  assert(!line.includes(secret), 'Private content leaked');
  const event = JSON.parse(line.slice('AI_PROFILE_PERF '.length));
  assert(event.totalMs === 120000 && event.authMs === null && event.preflightMs === null, 'Bounds failed');
});
